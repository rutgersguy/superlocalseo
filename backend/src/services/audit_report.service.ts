import puppeteer from 'puppeteer';
import type { LighthouseData } from './dataforseo.service';

function scoreColor(score: number | null): string {
  if (score == null) return '#94a3b8';
  if (score >= 75) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score: number | null): string {
  if (score == null) return '–';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Needs Work';
}

function lcpLabel(ms: number): string {
  if (ms <= 2500) return 'Good';
  if (ms <= 4000) return 'Needs Improvement';
  return 'Poor';
}

function lcpColor(ms: number): string {
  if (ms <= 2500) return '#22c55e';
  if (ms <= 4000) return '#f59e0b';
  return '#ef4444';
}

function clsLabel(v: number): string {
  if (v <= 0.1) return 'Good';
  if (v <= 0.25) return 'Needs Improvement';
  return 'Poor';
}

function clsColor(v: number): string {
  if (v <= 0.1) return '#22c55e';
  if (v <= 0.25) return '#f59e0b';
  return '#ef4444';
}

function tbtLabel(ms: number): string {
  if (ms <= 200) return 'Good';
  if (ms <= 600) return 'Needs Improvement';
  return 'Poor';
}

function tbtColor(ms: number): string {
  if (ms <= 200) return '#22c55e';
  if (ms <= 600) return '#f59e0b';
  return '#ef4444';
}

function scoreBar(score: number, color: string): string {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;">
        <div style="width:${score}%;background:${color};border-radius:4px;height:8px;"></div>
      </div>
      <span style="font-size:13px;font-weight:600;color:${color};min-width:36px;text-align:right;">${score}</span>
    </div>`;
}

function onPageIcon(detail: string): string {
  const pass = /optimal|present|detected|found|served over https/i.test(detail) &&
    !/no |not |too short|too long|reduce|missing|add |trim|migrate|expand|check/i.test(detail);
  return pass
    ? `<span style="color:#22c55e;font-weight:700;">✓</span>`
    : `<span style="color:#ef4444;font-weight:700;">✗</span>`;
}

export function renderAuditReportHtml(row: Record<string, unknown>): string {
  const businessName = String(row.client_business_name ?? row.location_name ?? 'Your Business');
  const locationName = String(row.location_name ?? '');
  const city = row.location_city ? `${String(row.location_city)}${row.location_state ? ', ' + String(row.location_state) : ''}` : '';
  const website = row.location_website ? String(row.location_website) : null;
  const completedAt = row.completed_at ? new Date(row.completed_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';

  const composite = row.composite_score != null ? Number(row.composite_score) : null;
  const nap = row.nap_score != null ? Number(row.nap_score) : null;
  const citation = row.citation_score != null ? Number(row.citation_score) : null;
  const onPage = row.on_page_score != null ? Number(row.on_page_score) : null;

  const onPageDetails: string[] = Array.isArray(row.on_page_details)
    ? (row.on_page_details as string[])
    : (typeof row.on_page_details === 'string' ? JSON.parse(row.on_page_details || '[]') : []);

  const lh: LighthouseData | null = row.dfs_on_page_data
    ? (typeof row.dfs_on_page_data === 'string' ? JSON.parse(row.dfs_on_page_data) : row.dfs_on_page_data as LighthouseData)
    : null;

  const scoreCards = [
    { label: 'Overall Score', value: composite },
    { label: 'NAP Accuracy', value: nap },
    { label: 'Citations', value: citation },
    { label: 'On-Page SEO', value: onPage },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: #fff; font-size: 14px; line-height: 1.5; }
  .page { max-width: 780px; margin: 0 auto; padding: 40px 32px; }
  .header { border-bottom: 3px solid #6366f1; padding-bottom: 24px; margin-bottom: 32px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { font-size: 13px; color: #6366f1; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px; }
  h1 { font-size: 26px; font-weight: 700; color: #1e293b; }
  .meta { font-size: 13px; color: #64748b; margin-top: 4px; }
  .overall-badge { text-align: center; padding: 16px 24px; background: #f8fafc; border-radius: 12px; border: 2px solid; min-width: 120px; }
  .overall-badge .num { font-size: 42px; font-weight: 800; line-height: 1; }
  .overall-badge .lbl { font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .section { margin-bottom: 32px; }
  .section-title { font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
  .score-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .score-card { background: #f8fafc; border-radius: 10px; padding: 16px; text-align: center; border: 1px solid #e2e8f0; }
  .score-card .val { font-size: 28px; font-weight: 800; }
  .score-card .lbl { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
  .score-card .badge { font-size: 11px; font-weight: 600; margin-top: 4px; padding: 2px 8px; border-radius: 20px; display: inline-block; }
  .detail-item { display: flex; gap: 10px; padding: 10px 12px; border-radius: 8px; margin-bottom: 6px; background: #f8fafc; font-size: 13px; align-items: flex-start; }
  .detail-icon { font-size: 14px; margin-top: 1px; flex-shrink: 0; }
  .cwv-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
  .cwv-card { background: #f8fafc; border-radius: 10px; padding: 14px; border: 1px solid #e2e8f0; }
  .cwv-card .metric { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .cwv-card .value { font-size: 22px; font-weight: 800; margin: 4px 0 2px; }
  .cwv-card .status { font-size: 11px; font-weight: 700; }
  .lh-bars { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .lh-bar-item .label { font-size: 12px; color: #475569; font-weight: 600; margin-bottom: 4px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div>
        <div class="brand">SuperLocalSEO — SEO Audit Report</div>
        <h1>${businessName}</h1>
        <div class="meta">${locationName}${city ? ' · ' + city : ''}${website ? ' · ' + website : ''}</div>
        <div class="meta" style="margin-top:4px;">Report Date: ${completedAt}</div>
      </div>
      ${composite != null ? `
      <div class="overall-badge" style="border-color:${scoreColor(composite)};">
        <div class="num" style="color:${scoreColor(composite)};">${composite}</div>
        <div class="lbl">Overall Score</div>
      </div>` : ''}
    </div>
  </div>

  <!-- Score Overview -->
  <div class="section">
    <div class="section-title">Score Overview</div>
    <div class="score-grid">
      ${scoreCards.map((c) => `
      <div class="score-card">
        <div class="val" style="color:${scoreColor(c.value)};">${c.value ?? '–'}</div>
        <div class="lbl">${c.label}</div>
        ${c.value != null ? `<div class="badge" style="background:${scoreColor(c.value)}22;color:${scoreColor(c.value)};">${scoreLabel(c.value)}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>

  <!-- On-Page SEO Checks -->
  ${onPageDetails.length > 0 ? `
  <div class="section">
    <div class="section-title">On-Page SEO Checks</div>
    ${onPageDetails.map((d) => `
    <div class="detail-item">
      <span class="detail-icon">${onPageIcon(d)}</span>
      <span>${d}</span>
    </div>`).join('')}
  </div>` : ''}

  <!-- Core Web Vitals -->
  ${lh ? `
  <div class="section">
    <div class="section-title">Performance &amp; Core Web Vitals</div>
    <div class="cwv-grid">
      ${lh.lcp != null ? `
      <div class="cwv-card">
        <div class="metric">LCP</div>
        <div class="value" style="color:${lcpColor(lh.lcp)};">${(lh.lcp / 1000).toFixed(2)}s</div>
        <div class="status" style="color:${lcpColor(lh.lcp)};">${lcpLabel(lh.lcp)}</div>
      </div>` : ''}
      ${lh.cls != null ? `
      <div class="cwv-card">
        <div class="metric">CLS</div>
        <div class="value" style="color:${clsColor(lh.cls)};">${lh.cls.toFixed(3)}</div>
        <div class="status" style="color:${clsColor(lh.cls)};">${clsLabel(lh.cls)}</div>
      </div>` : ''}
      ${lh.tbt != null ? `
      <div class="cwv-card">
        <div class="metric">TBT</div>
        <div class="value" style="color:${tbtColor(lh.tbt)};">${Math.round(lh.tbt)}ms</div>
        <div class="status" style="color:${tbtColor(lh.tbt)};">${tbtLabel(lh.tbt)}</div>
      </div>` : ''}
    </div>
    <div class="lh-bars">
      <div class="lh-bar-item">
        <div class="label">Performance</div>
        ${scoreBar(lh.performanceScore, scoreColor(lh.performanceScore))}
      </div>
      <div class="lh-bar-item">
        <div class="label">Accessibility</div>
        ${scoreBar(lh.accessibilityScore, scoreColor(lh.accessibilityScore))}
      </div>
      <div class="lh-bar-item">
        <div class="label">Best Practices</div>
        ${scoreBar(lh.bestPracticesScore, scoreColor(lh.bestPracticesScore))}
      </div>
      <div class="lh-bar-item">
        <div class="label">SEO</div>
        ${scoreBar(lh.seoScore, scoreColor(lh.seoScore))}
      </div>
    </div>
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <span>Generated by SuperLocalSEO</span>
    <span>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
  </div>

</div>
</body>
</html>`;
}

export async function generateAuditPdf(row: Record<string, unknown>): Promise<Buffer> {
  const html = renderAuditReportHtml(row);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
