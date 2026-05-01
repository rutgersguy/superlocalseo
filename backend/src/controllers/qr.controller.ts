import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';

function makeShortCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function redirectUrl(shortCode: string): string {
  return `${config.publicUrl}/api/qr/r/${shortCode}`;
}

const createSchema = z.object({
  name: z.string().min(1).max(255),
  targetUrl: z.string().url(),
  locationId: z.string().uuid().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const qrCodes = await db('qr_codes')
      .leftJoin('locations', 'qr_codes.location_id', 'locations.id')
      .where({ 'qr_codes.client_id': req.clientId })
      .orderBy('qr_codes.created_at', 'desc')
      .select(
        'qr_codes.id',
        'qr_codes.name',
        'qr_codes.target_url',
        'qr_codes.short_code',
        'qr_codes.scan_count',
        'qr_codes.last_scanned_at',
        'qr_codes.created_at',
        'locations.name as location_name',
      );

    ok(res, {
      qrCodes: qrCodes.map((q) => ({
        id: q.id,
        name: q.name,
        targetUrl: q.target_url,
        shortCode: q.short_code,
        scanCount: q.scan_count,
        lastScannedAt: q.last_scanned_at,
        createdAt: q.created_at,
        locationName: q.location_name ?? null,
        qrUrl: redirectUrl(q.short_code as string),
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }

    if (parsed.data.locationId) {
      const loc = await db('locations').where({ id: parsed.data.locationId, client_id: req.clientId }).first();
      if (!loc) {
        err(res, 'Location not found', 404, 'NOT_FOUND');
        return;
      }
    }

    let shortCode = makeShortCode();
    // Retry on collision (astronomically unlikely but safe)
    for (let i = 0; i < 5; i++) {
      const exists = await db('qr_codes').where({ short_code: shortCode }).first();
      if (!exists) break;
      shortCode = makeShortCode();
    }

    const [qr] = await db('qr_codes')
      .insert({
        client_id: req.clientId,
        location_id: parsed.data.locationId ?? null,
        name: parsed.data.name,
        target_url: parsed.data.targetUrl,
        short_code: shortCode,
      })
      .returning('*');

    ok(res, {
      qrCode: {
        id: qr.id,
        name: qr.name,
        targetUrl: qr.target_url,
        shortCode: qr.short_code,
        scanCount: 0,
        qrUrl: redirectUrl(qr.short_code as string),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deleted = await db('qr_codes')
      .where({ id: req.params.id, client_id: req.clientId })
      .delete();

    if (!deleted) {
      err(res, 'QR code not found', 404, 'NOT_FOUND');
      return;
    }
    ok(res, { deleted: true });
  } catch (e) {
    next(e);
  }
}

export async function image(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const qr = await db('qr_codes')
      .where({ id: req.params.id, client_id: req.clientId })
      .first();

    if (!qr) {
      err(res, 'QR code not found', 404, 'NOT_FOUND');
      return;
    }

    const url = redirectUrl(qr.short_code as string);
    const png = await QRCode.toBuffer(url, { type: 'png', width: 400, margin: 2 });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${qr.short_code}.png"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (e) {
    next(e);
  }
}

// Public redirect endpoint — no auth, increments scan count
export async function redirect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.params;

    const qr = await db('qr_codes').where({ short_code: code }).first();
    if (!qr) {
      res.status(404).send('Not found');
      return;
    }

    await db('qr_codes')
      .where({ id: qr.id })
      .update({
        scan_count: db.raw('scan_count + 1'),
        last_scanned_at: new Date(),
      })
      .catch((e) => logger.warn('scan_count update failed', { error: (e as Error).message }));

    res.redirect(302, qr.target_url as string);
  } catch (e) {
    next(e);
  }
}
