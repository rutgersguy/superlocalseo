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
  const url = `${config.publicUrl}/dashboard/settings?tab=billing`;
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

interface AuditCategory {
  label: string;
  score: number;
  grade: string;
  details: string[];
  locked: boolean;
}

interface AuditEmailData {
  overallScore: number;
  overallGrade: string;
  categories: AuditCategory[];
  keyword: string | null;
  formattedAddress: string | null;
}

function gradeColor(grade: string): string {
  const colors: Record<string, string> = {
    A: '#16a34a', B: '#65a30d', C: '#ca8a04', D: '#ea580c', F: '#dc2626',
  };
  return colors[grade] ?? '#6b7280';
}

function gradeLabel(grade: string): string {
  const labels: Record<string, string> = {
    A: 'Excellent', B: 'Good', C: 'Fair', D: 'Needs Work', F: 'Critical',
  };
  return labels[grade] ?? grade;
}

function buildCategoryRows(categories: AuditCategory[]): string {
  return categories.map((c) => {
    if (c.locked) {
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
            <span style="color:#6b7280;font-size:14px;">🔒 ${c.label}</span>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
            <span style="font-size:12px;color:#9ca3af;background:#f9fafb;padding:3px 10px;border-radius:20px;border:1px solid #e5e7eb;">Unlock with trial</span>
          </td>
        </tr>`;
    }
    const color = gradeColor(c.grade);
    const topDetail = c.details[0] ?? '';
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:14px;font-weight:600;color:#111827;">${c.label}</div>
          ${topDetail ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${topDetail}</div>` : ''}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap;">
          <span style="font-size:13px;font-weight:700;color:${color};background:${color}18;padding:3px 10px;border-radius:20px;">
            ${c.grade} &nbsp;·&nbsp; ${c.score}/100
          </span>
        </td>
      </tr>`;
  }).join('');
}

export async function sendAuditLeadEmail(
  to: string,
  businessName: string,
  auditData: AuditEmailData,
): Promise<void> {
  const registerUrl = `${config.publicUrl}/register?email=${encodeURIComponent(to)}&business=${encodeURIComponent(businessName)}`;
  const { overallScore, overallGrade, categories, keyword, formattedAddress } = auditData;
  const scoreColor = gradeColor(overallGrade);
  const lockedCount = categories.filter((c) => c.locked).length;

  const keywordLine = keyword
    ? `<p style="margin:0 0 4px;font-size:14px;color:#6b7280;">Keyword tracked: <strong style="color:#374151;">${keyword}</strong></p>`
    : '';
  const addressLine = formattedAddress
    ? `<p style="margin:0 0 4px;font-size:14px;color:#6b7280;">${formattedAddress}</p>`
    : '';

  await resend.emails.send({
    from,
    to,
    subject: `Your local SEO score: ${overallGrade} (${overallScore}/100) — ${businessName}`,
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#2563eb;border-radius:12px 12px 0 0;padding:28px 32px;">
        <p style="margin:0;font-size:13px;color:#bfdbfe;letter-spacing:.5px;text-transform:uppercase;">SuperLocalSEO</p>
        <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:700;">Your Free Local SEO Audit</h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;">

        <!-- Business info -->
        <h2 style="margin:0 0 6px;font-size:18px;color:#111827;">${businessName}</h2>
        ${addressLine}
        ${keywordLine}

        <!-- Score card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#f8faff;border:1px solid #dbeafe;border-radius:10px;padding:20px;" role="presentation">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Overall Score</p>
              <p style="margin:0;font-size:42px;font-weight:800;color:${scoreColor};line-height:1;">${overallScore}<span style="font-size:20px;color:#9ca3af;">/100</span></p>
              <p style="margin:6px 0 0;font-size:14px;font-weight:600;color:${scoreColor};">Grade ${overallGrade} — ${gradeLabel(overallGrade)}</p>
            </td>
          </tr>
        </table>

        <!-- Category breakdown -->
        <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Category Breakdown</h3>
        <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">${lockedCount} of ${categories.length} categories require your free trial to unlock.</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${buildCategoryRows(categories)}
        </table>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
          <tr><td style="background:#eff6ff;border-radius:10px;padding:20px;">
            <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#1e40af;">Unlock your full audit + start tracking</p>
            <p style="margin:0 0 16px;font-size:13px;color:#3b82f6;">See your keyword rankings, citation gaps, and how you stack up against local competitors — all updated daily.</p>
            <a href="${registerUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:8px;">Start your free 7-day trial →</a>
          </td></tr>
        </table>

        <p style="margin:28px 0 0;font-size:13px;color:#9ca3af;">The SuperLocalSEO Team · <a href="${config.publicUrl}" style="color:#9ca3af;">${config.publicUrl}</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`,
  }).catch((e) => logger.error('Failed to send audit lead email', { error: e, to }));
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
