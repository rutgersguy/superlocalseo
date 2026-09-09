import knex from 'knex';
import { db } from '../db/connection';
import { config } from '../config';
import { up, down } from '../db/migrations/20260909010000_repair_audit_leads_source';

describe('audit lead source schema repair', () => {
  const schema = `report_repair_${Date.now()}`;
  const isolated = knex({ client: 'pg', connection: config.db.url, searchPath: [schema], pool: { min: 0, max: 2 } });
  beforeAll(async () => {
    await db.raw('CREATE SCHEMA ??', [schema]);
    await isolated.schema.createTable('audit_leads', t => { t.integer('id').primary(); t.text('business_name'); });
    await isolated('audit_leads').insert({ id: 1, business_name: 'Existing lead' });
  });
  afterAll(async () => { await isolated.destroy(); await db.raw('DROP SCHEMA ?? CASCADE', [schema]); });
  it('repairs the live missing-column shape without losing a lead', async () => {
    await expect(isolated('audit_leads').where({ source: 'verified-free-report-v1' })).rejects.toThrow('source');
    await up(isolated);
    expect(await isolated('audit_leads').first()).toMatchObject({ id: 1, business_name: 'Existing lead', source: null });
    await isolated('audit_leads').where({ id: 1 }).update({ source: 'verified-free-report-v1' });
    await up(isolated); await down(isolated);
    expect(await isolated('audit_leads').where({ source: 'verified-free-report-v1' }).first()).toMatchObject({ id: 1, business_name: 'Existing lead' });
  });
});
