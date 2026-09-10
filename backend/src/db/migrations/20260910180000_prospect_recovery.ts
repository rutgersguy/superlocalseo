import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  // Old workers did not persist pre-send intent. Never infer that a failed email was unsent.
  await knex('audit_leads').where({ source: 'verified-free-report-v1' })
    .whereRaw("audit_data->'snapshot' IS NOT NULL AND audit_data->'snapshot' <> 'null'::jsonb")
    .whereRaw("COALESCE(audit_data->>'emailStatus', '') <> 'accepted'")
    .update({ audit_data: knex.raw("audit_data || ?::jsonb", [JSON.stringify({ emailStatus: 'legacy_unknown' })]) });
}
export async function down(): Promise<void> { /* Preserve unknown delivery outcomes. */ }
