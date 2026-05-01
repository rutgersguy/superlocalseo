import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { ok, noContent, notFound, err } from '../utils/response';
import { sendTeamInviteEmail } from '../services/email.service';

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'viewer']).default('viewer'),
});

const INVITE_TTL_HOURS = 48;

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const members = await db('team_members')
      .leftJoin('users', 'team_members.user_id', 'users.id')
      .where('team_members.client_id', req.clientId)
      .select(
        'team_members.id',
        'team_members.email',
        'team_members.role',
        'team_members.accepted_at as acceptedAt',
        'team_members.invite_expires_at as inviteExpiresAt',
        'team_members.created_at as createdAt',
        'users.id as userId',
      )
      .orderBy('team_members.created_at', 'asc');

    // Also include the account owner
    const ownerUser = await db('users')
      .join('clients', 'clients.user_id', 'users.id')
      .where('clients.id', req.clientId)
      .select('users.id', 'users.email')
      .first();

    const result = {
      owner: ownerUser ? { userId: ownerUser.id, email: ownerUser.email, role: 'owner' } : null,
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role,
        userId: m.userId ?? null,
        accepted: !!m.acceptedAt,
        pending: !m.acceptedAt,
        expired: !m.acceptedAt && m.inviteExpiresAt && new Date(m.inviteExpiresAt) < new Date(),
      })),
    };

    ok(res, result);
  } catch (e) {
    next(e);
  }
}

export async function invite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, role } = inviteSchema.parse(req.body);

    // Can't invite yourself
    const inviterEmail = await db('users').where({ id: req.userId }).first().then((u) => u?.email);
    if (email.toLowerCase() === inviterEmail?.toLowerCase()) {
      err(res, 'You cannot invite yourself', 400, 'INVALID_INVITE');
      return;
    }

    // Can't invite existing active member
    const existing = await db('team_members')
      .where({ client_id: req.clientId, email: email.toLowerCase() })
      .whereNotNull('accepted_at')
      .first();
    if (existing) {
      err(res, 'This person is already a team member', 409, 'ALREADY_MEMBER');
      return;
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    // Upsert — replace any existing pending invite for this email+client
    await db('team_members')
      .where({ client_id: req.clientId, email: email.toLowerCase() })
      .whereNull('accepted_at')
      .delete();

    const [member] = await db('team_members').insert({
      client_id: req.clientId,
      email: email.toLowerCase(),
      role,
      invited_by: req.userId,
      invite_token: token,
      invite_expires_at: expiresAt,
    }).returning('*');

    const businessName = req.client.business_name as string;
    await sendTeamInviteEmail(email, token, businessName, role).catch(() => {});

    ok(res, {
      id: member.id,
      email: member.email,
      role: member.role,
      pending: true,
    });
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { memberId } = req.params;

    const member = await db('team_members')
      .where({ id: memberId, client_id: req.clientId })
      .first();

    if (!member) {
      notFound(res, 'Member not found');
      return;
    }

    await db('team_members').where({ id: memberId }).delete();
    noContent(res);
  } catch (e) {
    next(e);
  }
}

export async function accept(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = z.object({ token: z.string() }).parse(req.query);

    const member = await db('team_members')
      .where({ invite_token: token })
      .whereNull('accepted_at')
      .first();

    if (!member) {
      err(res, 'Invalid or expired invite link', 400, 'INVALID_TOKEN');
      return;
    }

    if (new Date(member.invite_expires_at) < new Date()) {
      err(res, 'This invite link has expired', 400, 'INVITE_EXPIRED');
      return;
    }

    ok(res, {
      memberId: member.id,
      clientId: member.client_id,
      email: member.email,
      role: member.role,
    });
  } catch (e) {
    next(e);
  }
}

export async function acceptConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password, name } = z.object({
      token: z.string(),
      password: z.string().min(8).optional(),
      name: z.string().optional(),
    }).parse(req.body);

    const member = await db('team_members')
      .where({ invite_token: token })
      .whereNull('accepted_at')
      .first();

    if (!member || new Date(member.invite_expires_at) < new Date()) {
      err(res, 'Invalid or expired invite', 400, 'INVALID_TOKEN');
      return;
    }

    // Find or create user
    let user = await db('users').where({ email: member.email }).first();

    if (!user) {
      if (!password) {
        err(res, 'Password required for new accounts', 400, 'PASSWORD_REQUIRED');
        return;
      }
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(password, 12);
      const { createCustomer } = await import('../services/stripe.service');
      const stripeId = await createCustomer(member.email, name ?? member.email);
      const [newUser] = await db('users').insert({
        email: member.email,
        password_hash: hash,
        role: 'client',
        stripe_customer_id: stripeId,
        email_verified: true,
      }).returning('*');
      user = newUser;
    }

    await db('team_members').where({ id: member.id }).update({
      user_id: user.id,
      accepted_at: new Date(),
      invite_token: null,
      updated_at: new Date(),
    });

    // Issue tokens so they're logged in immediately
    const { issueTokens } = await import('../services/auth.service');
    const { accessToken, refreshToken } = await issueTokens(user.id, user.role);

    const { setRefreshCookie } = await import('../controllers/auth.controller');
    setRefreshCookie(res, refreshToken);

    ok(res, { accessToken });
  } catch (e) {
    next(e);
  }
}
