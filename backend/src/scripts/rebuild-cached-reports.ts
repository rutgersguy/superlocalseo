/** Repair existing downloadable PDFs without sending email or changing delivery history.
 * Default: render and back up only. Pass --apply to replace validated staged files.
 * Run after deployment: node dist/scripts/rebuild-cached-reports.js [--apply]
 */
import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/connection';
import { config } from '../config';
import { gatherReportData, renderReportHtml, generatePdf } from '../services/report.service';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Only --apply is supported');
  const apply = args.includes('--apply');
  const root = path.resolve(config.reports.dir);
  const runDir = path.join(root, '.repairs', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  const reports = await db('reports').whereNotNull('file_path').orderBy('id');
  const manifest: Array<{ id: string; target: string; staged: string; backup: string; originalGeneratedAt: unknown }> = [];
  // Finish every render and backup before replacing any download.
  for (const report of reports) {
    const target = path.resolve(report.file_path);
    if (!target.startsWith(root + path.sep)) throw new Error(`Report ${report.id} is outside report directory`);
    const backup = path.join(runDir, `${report.id}.original.pdf`);
    const staged = path.join(runDir, `${report.id}.repaired.pdf`);
    await fs.copyFile(target, backup); // Missing original is an explicit error.
    const data = await gatherReportData(report.client_id, report.period_month, report.period_year);
    const html = renderReportHtml(data);
    if (html.includes('NaN') || html.includes('Infinity')) throw new Error(`Invalid numeric output: ${report.id}`);
    await generatePdf(html, staged);
    const bytes = await fs.readFile(staged);
    if (bytes.length < 1000 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error(`Invalid PDF: ${report.id}`);
    manifest.push({ id: report.id, target, staged, backup, originalGeneratedAt: report.generated_at });
  }
  await fs.writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  if (apply) {
    for (const item of manifest) {
      const temporary = `${item.target}.repairing`;
      await fs.copyFile(item.staged, temporary);
      await fs.rename(temporary, item.target);
      try {
        await db('reports').where({ id: item.id }).update({ generated_at: db.fn.now(), updated_at: db.fn.now() });
      } catch (error) {
        await fs.copyFile(item.backup, item.target);
        throw error;
      }
    }
  }
  console.log(JSON.stringify({ reports: manifest.length, applied: apply, backupDirectory: runDir, emailsSent: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.destroy());
