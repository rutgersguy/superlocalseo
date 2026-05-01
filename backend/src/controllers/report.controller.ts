import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { reportsQueue } from '../jobs/queue';
import { ok, notFound, err } from '../utils/response';

// ─── list ──────────────────────────────────────────────────────────────────────

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await db('reports')
      .where('client_id', req.clientId)
      .select(
        'id',
        'period_month as periodMonth',
        'period_year as periodYear',
        'status',
        'generated_at as generatedAt',
        'sent_at as sentAt',
        'email_recipient as emailRecipient',
      )
      .orderBy('period_year', 'desc')
      .orderBy('period_month', 'desc') as Array<{
      id: string;
      periodMonth: number;
      periodYear: number;
      status: string;
      generatedAt: string | null;
      sentAt: string | null;
      emailRecipient: string | null;
    }>;

    ok(res, rows);
  } catch (e) {
    next(e);
  }
}

// ─── download ─────────────────────────────────────────────────────────────────

export async function download(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const report = await db('reports')
      .where({ id })
      .first() as {
      id: string;
      client_id: string;
      file_path: string | null;
      status: string;
      period_month: number;
      period_year: number;
    } | undefined;

    if (!report) {
      notFound(res, 'Report not found');
      return;
    }

    if (report.client_id !== req.clientId) {
      notFound(res, 'Report not found');
      return;
    }

    if (!report.file_path) {
      err(res, 'Report file is not yet available', 422);
      return;
    }

    // Check file exists
    try {
      await fs.promises.access(report.file_path, fs.constants.R_OK);
    } catch {
      notFound(res, 'Report file not found on disk');
      return;
    }

    const monthStr = String(report.period_month).padStart(2, '0');
    const filename = `SEO-Report-${report.period_year}-${monthStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(report.file_path);
    stream.on('error', (streamErr) => {
      if (!res.headersSent) {
        next(streamErr);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
}

// ─── view (inline) ───────────────────────────────────────────────────────────

export async function view(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const report = await db('reports')
      .where({ id })
      .first() as {
      id: string;
      client_id: string;
      file_path: string | null;
      status: string;
      period_month: number;
      period_year: number;
    } | undefined;

    if (!report) {
      notFound(res, 'Report not found');
      return;
    }

    if (report.client_id !== req.clientId) {
      notFound(res, 'Report not found');
      return;
    }

    if (!report.file_path) {
      err(res, 'Report file is not yet available', 422);
      return;
    }

    // Check file exists
    try {
      await fs.promises.access(report.file_path, fs.constants.R_OK);
    } catch {
      notFound(res, 'Report file not found on disk');
      return;
    }

    const monthStr = String(report.period_month).padStart(2, '0');
    const filename = `SEO-Report-${report.period_year}-${monthStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    const stream = fs.createReadStream(report.file_path);
    stream.on('error', (streamErr) => {
      if (!res.headersSent) {
        next(streamErr);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
}

// ─── generate ────────────────────────────────────────────────────────────────────

export async function generate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      clientId?: string;
      month?: number;
      year?: number;
    };

    const clientId = body.clientId ?? req.clientId;

    // Default to previous month
    const now = new Date();
    const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const month = body.month ?? defaultMonth;
    const year = body.year ?? defaultYear;

    if (month < 1 || month > 12) {
      err(res, 'month must be between 1 and 12', 400);
      return;
    }

    if (year < 2020 || year > now.getFullYear() + 1) {
      err(res, 'year is out of acceptable range', 400);
      return;
    }

    const job = await reportsQueue.add('generate-report', {
      clientId,
      month,
      year,
    });

    ok(res, { queued: true, jobId: job.id });
  } catch (e) {
    next(e);
  }
}
