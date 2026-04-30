import { Resend } from 'resend';
import { config } from '../config';
import { logger } from '../utils/logger';

const resend = new Resend(config.resend.apiKey);

const from = `${config.resend.fromName} <${config.resend.fromEmail}>`;

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${config.appUrl}/auth/verify?token=${token}`;
  await resend.emails.send({
    from,
    to,
    subject: 'Verify your SuperLocalSEO account',
    html: `<p>Click the link below to verify your email address. This link expires in 24 hours.</p>
<p><a href="${url}">${url}</a></p>`,
  }).catch((e) => logger.error('Failed to send verification email', { error: e, to }));
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${config.appUrl}/auth/reset-password?token=${token}`;
  await resend.emails.send({
    from,
    to,
    subject: 'Reset your SuperLocalSEO password',
    html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, you can ignore this email.</p>`,
  }).catch((e) => logger.error('Failed to send password reset email', { error: e, to }));
}

export async function sendPaymentFailedEmail(to: string, businessName: string): Promise<void> {
  const url = `${config.appUrl}/settings/billing`;
  await resend.emails.send({
    from,
    to,
    subject: `Action required: Payment failed for ${businessName}`,
    html: `<p>Your recent payment for SuperLocalSEO failed. Please update your payment method within 3 days to avoid losing access.</p>
<p><a href="${url}">Update payment method</a></p>`,
  }).catch((e) => logger.error('Failed to send payment failed email', { error: e, to }));
}
