import { Resend } from 'resend';
import { config } from '../config';
import { logger } from '../utils/logger';

const resend = new Resend(config.resend.apiKey);

const from = `${config.resend.fromName} <${config.resend.fromEmail}>`;

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${config.publicUrl}/auth/verify-email?token=${token}`;
  await resend.emails.send({
    from,
    to,
    subject: 'Verify your SuperLocalSEO account',
    html: `<p>Click the link below to verify your email address. This link expires in 24 hours.</p>
<p><a href="${url}">${url}</a></p>`,
  }).catch((e) => logger.error('Failed to send verification email', { error: e, to }));
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${config.publicUrl}/auth/reset-password?token=${token}`;
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
  const url = `${config.publicUrl}/settings/billing`;
  await resend.emails.send({
    from,
    to,
    subject: `Action required: Payment failed for ${businessName}`,
    html: `<p>Your recent payment for SuperLocalSEO failed. Please update your payment method within 3 days to avoid losing access.</p>
<p><a href="${url}">Update payment method</a></p>`,
  }).catch((e) => logger.error('Failed to send payment failed email', { error: e, to }));
}

export async function sendTeamInviteEmail(
  to: string,
  token: string,
  businessName: string,
  role: string,
): Promise<void> {
  const url = `${config.publicUrl}/team/accept?token=${token}`;
  await resend.emails.send({
    from,
    to,
    subject: `You've been invited to join ${businessName} on SuperLocalSEO`,
    html: `<p>You've been invited to join <strong>${businessName}</strong> on SuperLocalSEO as a <strong>${role}</strong>.</p>
<p>Click the link below to accept the invitation. This link expires in 48 hours.</p>
<p><a href="${url}">Accept invitation</a></p>
<p>If you weren't expecting this, you can safely ignore this email.</p>`,
  }).catch((e) => logger.error('Failed to send team invite email', { error: e, to }));
}

export async function sendReportEmail(
  to: string,
  businessName: string,
  period: string,
  pdfPath: string,
): Promise<void> {
  const { promises: fsPromises } = await import('fs');
  const pdfBuffer = await fsPromises.readFile(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');

  await resend.emails.send({
    from,
    to,
    subject: `Your ${period} SEO Report — ${businessName}`,
    html: `<p>Hi there,</p>
<p>Your <strong>${period}</strong> SEO performance report for <strong>${businessName}</strong> is ready.</p>
<p>Please find your monthly SEO report attached. It includes keyword rankings, review activity, citation health, and personalised recommendations to improve your local search visibility.</p>
<p>If you have any questions, reply to this email and our team will be happy to help.</p>
<p>Best regards,<br/>The SuperLocalSEO Team</p>`,
    attachments: [
      {
        filename: `${businessName} SEO Report - ${period}.pdf`,
        content: pdfBase64,
      },
    ],
  }).catch((e) => logger.error('Failed to send report email', { error: e, to }));
}
