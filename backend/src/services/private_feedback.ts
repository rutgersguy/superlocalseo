import { z } from 'zod';

export const feedbackFilter = z.object({
  locationId: z.string().uuid().optional(), rating: z.coerce.number().int().min(1).max(5).optional(),
  campaignId: z.string().max(255).optional(), status: z.enum(['new', 'in_progress', 'resolved']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const feedbackUpdate = z.object({
  version: z.number().int().min(0),
  status: z.enum(['new', 'in_progress', 'resolved']),
  assignedUserId: z.string().uuid().nullable(),
  notes: z.string().max(4000),
}).strict();
export const feedbackCoverage = 'This inbox contains native submissions and EMR webhook events received by SuperLocalSEO. Historical EMR feedback and later edits are not backfilled or guaranteed complete.';

function maskName(name: string | null): string | null {
  return name ? name.trim().split(/\s+/).map(p => p[0] + '***').join(' ') : null;
}
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  return local && domain ? `${local[0]}***@${domain}` : '***';
}
export function feedbackView(f: Record<string, any>, canManage: boolean) {
  return {
    id: f.id, campaignId: f.campaign_id, locationId: f.location_id, source: f.source,
    contactConsent: f.contact_consent === true,
    contactName: f.source === 'native' ? f.contact_name : maskName(f.contact_name),
    contactEmail: f.source === 'native' && f.contact_consent === true ? f.contact_email : maskEmail(f.contact_email),
    contactPhone: f.contact_phone ? f.contact_phone.slice(0, 3) + '***' : null,
    rating: f.rating, message: f.message, receivedAt: f.received_at,
    status: f.follow_up_status, assignedUserId: f.assigned_user_id,
    notes: canManage ? f.follow_up_notes : undefined,
    version: f.follow_up_version, followUpUpdatedAt: f.follow_up_updated_at,
  };
}
// Quote every cell and neutralize spreadsheet formulas, including leading whitespace.
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function feedbackCsv(rows: Record<string, any>[]): string {
  const keys = ['id', 'source', 'locationId', 'campaignId', 'receivedAt', 'rating', 'message', 'contactName', 'contactEmail', 'contactPhone', 'contactConsent', 'status', 'assignedUserId'];
  return [keys.map(csvCell).join(','), ...rows.map(row => keys.map(key => csvCell(row[key] instanceof Date ? row[key].toISOString() : row[key])).join(','))].join('\r\n');
}
