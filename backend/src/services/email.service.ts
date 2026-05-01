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

export async function sendWelcomeEmail(to: string, businessName: string): Promise<void> {
  const dashboardUrl = `${config.publicUrl}/dashboard`;
  await resend.emails.send({
    from,
    to,
    subject: `Welcome to SuperLocalSEO, ${businessName}!`,
    html: `<p>Hi there,</p>
<p>Welcome to <strong>SuperLocalSEO</strong>! Your account for <strong>${businessName}</strong> is ready.</p>
<p>Here's what to do next:</p>
<ol>
  <li>Add your first business location</li>
  <li>Set up keyword tracking for your top services</li>
  <li>Connect your Google Business Profile to start syncing reviews</li>
</ol>
<p><a href="${dashboardUrl}">Go to your dashboard →</a></p>
<p>If you have any questions, just reply to this email — we're here to help.</p>
<p>Best,<br/>The SuperLocalSEO Team</p>`,
  }).catch((e) => logger.error('Failed to send welcome email', { error: e, to }));
}

export async function sendTrialEndingSoonEmail(to: string, businessName: string, daysLeft: number): Promise<void> {
  const billingUrl = `${config.publicUrl}/dashboard/settings?tab=billing`;
  await resend.emails.send({
    from,
    to,
    subject: `Your SuperLocalSEO trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
    html: `<p>Hi there,</p>
<p>Your free trial for <strong>${businessName}</strong> on SuperLocalSEO ends in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>.</p>
<p>To keep your rankings, reviews, and citation data — and stay ahead of local competitors — subscribe before your trial expires.</p>
<p><a href="${billingUrl}">Choose your plan →</a></p>
<p>Have questions? Just reply to this email.</p>
<p>The SuperLocalSEO Team</p>`,
  }).catch((e) => logger.error('Failed to send trial ending soon email', { error: e, to }));
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

export async function sendJobFailureAlert(
  jobName: string,
  errorMessage: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const adminEmail = config.resend.fromEmail; // Alert goes to the operator inbox
  await resend.emails.send({
    from,
    to: adminEmail,
    subject: `[SuperLocalSEO] Job failure: ${jobName}`,
    html: `<p><strong>Job:</strong> ${jobName}</p>
<p><strong>Error:</strong> ${errorMessage}</p>
${context ? `<pre>${JSON.stringify(context, null, 2)}</pre>` : ''}
<p><small>${new Date().toISOString()}</small></p>`,
  }).catch((e) => logger.error('Failed to send job failure alert', { error: e }));
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
