import puppeteer from 'puppeteer';
import type { LighthouseData, LighthouseAuditItem } from './dataforseo.service';

// ─── Colour helpers ───────────────────────────────────────────────────────────

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

function scoreBg(score: number | null): string {
  if (score == null) return '#f1f5f9';
  if (score >= 75) return '#dcfce7';
  if (score >= 50) return '#fef9c3';
  return '#fee2e2';
}

function cwvColor(metric: 'lcp' | 'cls' | 'tbt', v: number): string {
  if (metric === 'lcp') return v <= 2500 ? '#22c55e' : v <= 4000 ? '#f59e0b' : '#ef4444';
  if (metric === 'cls') return v <= 0.1 ? '#22c55e' : v <= 0.25 ? '#f59e0b' : '#ef4444';
  return v <= 200 ? '#22c55e' : v <= 600 ? '#f59e0b' : '#ef4444';
}
function cwvLabel(metric: 'lcp' | 'cls' | 'tbt', v: number): string {
  if (metric === 'lcp') return v <= 2500 ? 'Good' : v <= 4000 ? 'Needs Improvement' : 'Poor';
  if (metric === 'cls') return v <= 0.1 ? 'Good' : v <= 0.25 ? 'Needs Improvement' : 'Poor';
  return v <= 200 ? 'Good' : v <= 600 ? 'Needs Improvement' : 'Poor';
}

function auditDotColor(score: number | null): string {
  if (score == null) return '#94a3b8';
  if (score >= 0.9) return '#22c55e';
  if (score >= 0.5) return '#f59e0b';
  return '#ef4444';
}

// ─── On-page pass/fail detection ─────────────────────────────────────────────

function isOnPagePass(detail: string): boolean {
  return /optimal|present|detected|found|served over https/i.test(detail) &&
    !/no |not |too short|too long|reduce|missing|add |trim|migrate|expand|check|multiple/i.test(detail);
}

// Pulls the three highest-priority on-page failures
function topOnPageIssues(details: string[]): string[] {
  return details.filter((d) => !isOnPagePass(d)).slice(0, 3);
}

// ─── Score bar ────────────────────────────────────────────────────────────────

function scoreBar(score: number, color: string): string {
  return `<div style="display:flex;align-items:center;gap:10px;">
    <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;">
      <div style="width:${score}%;background:${color};border-radius:4px;height:8px;"></div>
    </div>
    <span style="font-size:13px;font-weight:700;color:${color};min-width:30px;text-align:right;">${score}</span>
  </div>`;
}

// ─── Priority action builder ──────────────────────────────────────────────────

interface Action {
  priority: 'high' | 'medium' | 'low';
  category: string;
  issue: string;
  fix: string;
}

function buildPriorityActions(
  onPageDetails: string[],
  lh: LighthouseData | null,
): Action[] {
  const actions: Action[] = [];

  // On-page failures → high priority
  const onPageFixes: Record<string, string> = {
    'https': 'Contact your web host to enable an SSL certificate (free via Let\'s Encrypt). Then set up a 301 redirect from HTTP to HTTPS.',
    'title': 'Update your <title> tag to 50–60 characters including your primary service keyword and city (e.g. "HVAC Repair Tulsa OK | Your Business").',
    'meta description': 'Write a 120–160 character meta description with your keyword, city, and a clear call to action.',
    'h1': 'Add a single H1 to your homepage that describes your primary service and location.',
    'schema': 'Add LocalBusiness JSON-LD markup to your site\'s <head>. Use the Rank Math or Yoast plugin in WordPress to generate it automatically.',
    'canonical': 'Add <link rel="canonical" href="https://yoursite.com/"> to your <head> to prevent duplicate content issues.',
    'viewport': 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to your page\'s <head>.',
  };

  for (const detail of onPageDetails) {
    if (isOnPagePass(detail)) continue;
    const key = Object.keys(onPageFixes).find((k) => detail.toLowerCase().includes(k));
    if (key) {
      actions.push({
        priority: key === 'https' || key === 'title' || key === 'h1' || key === 'schema' ? 'high' : 'medium',
        category: 'On-Page SEO',
        issue: detail,
        fix: onPageFixes[key],
      });
    }
  }

  // Lighthouse performance issues → high priority if score < 50
  if (lh) {
    const lhCategories: Array<{ score: number; name: string; audits: LighthouseAuditItem[] }> = [
      { score: lh.performanceScore, name: 'Performance', audits: lh.categoryAudits?.performance ?? [] },
      { score: lh.accessibilityScore, name: 'Accessibility', audits: lh.categoryAudits?.accessibility ?? [] },
      { score: lh.bestPracticesScore, name: 'Best Practices', audits: lh.categoryAudits?.bestPractices ?? [] },
      { score: lh.seoScore, name: 'Technical SEO', audits: lh.categoryAudits?.seo ?? [] },
    ];

    for (const cat of lhCategories) {
      for (const audit of cat.audits.slice(0, 3)) {
        if (audit.score != null && audit.score >= 0.5) continue; // only failing
        actions.push({
          priority: cat.score < 50 ? 'high' : 'medium',
          category: cat.name,
          issue: audit.title + (audit.displayValue ? ` — ${audit.displayValue}` : ''),
          fix: audit.description || 'Work with your web developer to address this issue.',
        });
      }
    }
  }

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => order[a.priority] - order[b.priority]);

  return actions.slice(0, 8); // cap at 8 actions for readability
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

export function renderAuditReportHtml(row: Record<string, unknown>): string {
  const businessName = String(row.client_business_name ?? row.location_name ?? 'Your Business');
  const locationName = String(row.location_name ?? '');
  const city = row.location_city ? `${String(row.location_city)}${row.location_state ? ', ' + String(row.location_state) : ''}` : '';
  const website = row.location_website ? String(row.location_website) : null;
  const completedAt = row.completed_at
    ? new Date(row.completed_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const onPage = row.on_page_score != null ? Number(row.on_page_score) : null;

  const onPageDetails: string[] = Array.isArray(row.on_page_details)
    ? (row.on_page_details as string[])
    : (typeof row.on_page_details === 'string' && row.on_page_details ? JSON.parse(row.on_page_details) : []);

  const lh: LighthouseData | null = row.dfs_on_page_data
    ? (typeof row.dfs_on_page_data === 'string' ? JSON.parse(row.dfs_on_page_data) : row.dfs_on_page_data as LighthouseData)
    : null;

  const actions = buildPriorityActions(onPageDetails, lh);
  const highActions = actions.filter((a) => a.priority === 'high');
  const medActions = actions.filter((a) => a.priority === 'medium');

  const priorityBadge = (p: Action['priority']) => {
    const map = { high: ['#ef4444', '#fee2e2', 'High Priority'], medium: ['#f59e0b', '#fef9c3', 'Medium'], low: ['#22c55e', '#dcfce7', 'Low'] };
    const [color, bg, label] = map[p];
    return `<span style="background:${bg};color:${color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;letter-spacing:0.03em;">${label}</span>`;
  };

  const lhCategoryRows = lh ? [
    { label: 'Overall Performance', score: lh.performanceScore, audits: lh.categoryAudits?.performance ?? [] },
    { label: 'Accessibility', score: lh.accessibilityScore, audits: lh.categoryAudits?.accessibility ?? [] },
    { label: 'Best Practices', score: lh.bestPracticesScore, audits: lh.categoryAudits?.bestPractices ?? [] },
    { label: 'Technical SEO', score: lh.seoScore, audits: lh.categoryAudits?.seo ?? [] },
  ] : [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: #fff; font-size: 13px; line-height: 1.6; }
  .page { max-width: 800px; margin: 0 auto; padding: 44px 40px; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 32px; border-bottom: 3px solid #6366f1; }
  .header-left .brand { font-size: 11px; color: #6366f1; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  h1 { font-size: 24px; font-weight: 800; color: #0f172a; }
  .header-meta { font-size: 12px; color: #64748b; margin-top: 3px; }
  .overall-badge { text-align: center; padding: 14px 20px; border-radius: 14px; border: 3px solid; }
  .overall-badge .num { font-size: 44px; font-weight: 900; line-height: 1; }
  .overall-badge .lbl { font-size: 11px; color: #64748b; margin-top: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

  /* Sections */
  .section { margin-bottom: 36px; }
  h2 { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
  .section-subtitle { font-size: 11px; color: #94a3b8; margin-bottom: 16px; }

  /* Score grid */
  .score-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .score-card { border-radius: 12px; padding: 16px 12px; text-align: center; border: 1px solid #e2e8f0; }
  .score-card .val { font-size: 30px; font-weight: 900; }
  .score-card .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-top: 3px; }
  .score-card .badge { font-size: 10px; font-weight: 700; margin-top: 5px; padding: 2px 8px; border-radius: 20px; display: inline-block; }

  /* Priority actions */
  .action-item { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 14px 16px; border-radius: 10px; margin-bottom: 10px; border: 1px solid; }
  .action-item.high { background: #fff7f7; border-color: #fecaca; }
  .action-item.medium { background: #fffbeb; border-color: #fde68a; }
  .action-badge-col { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 90px; }
  .action-category { font-size: 10px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .action-issue { font-size: 12px; font-weight: 600; color: #1e293b; margin-bottom: 5px; }
  .action-fix-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .action-fix { font-size: 12px; color: #475569; }

  /* On-page checks */
  .check-item { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border-radius: 8px; margin-bottom: 5px; font-size: 12px; }
  .check-item.pass { background: #f0fdf4; }
  .check-item.fail { background: #fef2f2; }
  .check-icon { font-weight: 800; flex-shrink: 0; margin-top: 1px; }
  .check-icon.pass { color: #22c55e; }
  .check-icon.fail { color: #ef4444; }

  /* CWV */
  .cwv-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .cwv-card { background: #f8fafc; border-radius: 10px; padding: 14px; border: 1px solid #e2e8f0; }
  .cwv-card .metric-name { font-size: 11px; font-weight: 700; color: #475569; }
  .cwv-card .metric-sub { font-size: 10px; color: #94a3b8; margin-top: 1px; margin-bottom: 6px; }
  .cwv-card .metric-val { font-size: 22px; font-weight: 900; }
  .cwv-card .metric-status { font-size: 11px; font-weight: 700; margin-top: 2px; }

  /* Lighthouse bars */
  .lh-row { margin-bottom: 16px; }
  .lh-row-header { display: flex; justify-content: space-between; margin-bottom: 5px; }
  .lh-label { font-size: 12px; font-weight: 600; color: #374151; }
  .lh-issues { margin-top: 8px; padding-left: 12px; border-left: 2px solid #e2e8f0; }
  .lh-issue { font-size: 11px; color: #64748b; margin-bottom: 4px; display: flex; align-items: flex-start; gap: 6px; }
  .lh-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }

  /* Footer */
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }

</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="brand">SuperLocalSEO · SEO Audit Report</div>
      <h1>${businessName}</h1>
      <div class="header-meta">${[locationName, city, website].filter(Boolean).join(' · ')}</div>
      <div class="header-meta" style="margin-top:2px;">Audit completed ${completedAt}</div>
    </div>
    ${onPage != null ? `
    <div class="overall-badge" style="border-color:${scoreColor(onPage)};">
      <div class="num" style="color:${scoreColor(onPage)};">${onPage}</div>
      <div class="lbl">On-Page Score</div>
      <div style="font-size:11px;font-weight:700;color:${scoreColor(onPage)};margin-top:2px;">${scoreLabel(onPage)}</div>
    </div>` : ''}
  </div>


  <!-- Priority Actions -->
  ${actions.length > 0 ? `
  <div class="section">
    <h2>Priority Actions</h2>
    <div class="section-subtitle">Fix these issues to improve your local search rankings — listed highest impact first</div>
    ${[...highActions, ...medActions].map((a) => `
    <div class="action-item ${a.priority}">
      <div class="action-badge-col">
        ${priorityBadge(a.priority)}
        <div class="action-category">${a.category}</div>
      </div>
      <div>
        <div class="action-issue">${a.issue}</div>
        <div class="action-fix-label">How to fix</div>
        <div class="action-fix">${a.fix}</div>
      </div>
    </div>`).join('')}
  </div>` : ''}

  <!-- On-Page SEO Checks -->
  ${onPageDetails.length > 0 ? `
  <div class="section">
    <h2>On-Page SEO Checks</h2>
    <div class="section-subtitle">Technical checks run against your homepage — click items in the app for detailed guidance</div>
    ${onPageDetails.map((d) => {
      const pass = isOnPagePass(d);
      return `<div class="check-item ${pass ? 'pass' : 'fail'}">
        <span class="check-icon ${pass ? 'pass' : 'fail'}">${pass ? '✓' : '✗'}</span>
        <span>${d}</span>
      </div>`;
    }).join('')}
  </div>` : ''}

  ${lh ? `
  <!-- Website Performance -->
  <div class="section">
    <h2>Website Performance</h2>
    <div class="section-subtitle">Measured by Google Lighthouse — these signals directly affect your search rankings and user experience</div>

    ${(lh.lcp != null || lh.cls != null || lh.tbt != null) ? `
    <div class="cwv-grid" style="margin-bottom:24px;">
      ${lh.lcp != null ? `
      <div class="cwv-card">
        <div class="metric-name">Page Load Speed</div>
        <div class="metric-sub">Time until main content loads</div>
        <div class="metric-val" style="color:${cwvColor('lcp', lh.lcp)};">${(lh.lcp / 1000).toFixed(2)}s</div>
        <div class="metric-status" style="color:${cwvColor('lcp', lh.lcp)};">${cwvLabel('lcp', lh.lcp)}</div>
      </div>` : ''}
      ${lh.cls != null ? `
      <div class="cwv-card">
        <div class="metric-name">Layout Stability</div>
        <div class="metric-sub">How much the page shifts while loading</div>
        <div class="metric-val" style="color:${cwvColor('cls', lh.cls)};">${lh.cls.toFixed(3)}</div>
        <div class="metric-status" style="color:${cwvColor('cls', lh.cls)};">${cwvLabel('cls', lh.cls)}</div>
      </div>` : ''}
      ${lh.tbt != null ? `
      <div class="cwv-card">
        <div class="metric-name">Interactivity</div>
        <div class="metric-sub">How quickly the page responds to clicks</div>
        <div class="metric-val" style="color:${cwvColor('tbt', lh.tbt)};">${Math.round(lh.tbt)}ms</div>
        <div class="metric-status" style="color:${cwvColor('tbt', lh.tbt)};">${cwvLabel('tbt', lh.tbt)}</div>
      </div>` : ''}
    </div>` : ''}

    ${lhCategoryRows.map((cat) => `
    <div class="lh-row">
      <div class="lh-row-header">
        <span class="lh-label">${cat.label}</span>
      </div>
      ${scoreBar(cat.score, scoreColor(cat.score))}
      ${cat.audits.filter((a) => a.score == null || a.score < 0.9).slice(0, 3).length > 0 ? `
      <div class="lh-issues">
        ${cat.audits.filter((a) => a.score == null || a.score < 0.9).slice(0, 3).map((a) => `
        <div class="lh-issue">
          <div class="lh-dot" style="background:${auditDotColor(a.score)};"></div>
          <span>${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''}</span>
        </div>`).join('')}
      </div>` : `<div style="font-size:11px;color:#22c55e;margin-top:6px;padding-left:12px;">✓ No significant issues found</div>`}
    </div>`).join('')}
  </div>` : ''}


  <!-- Footer -->
  <div class="footer">
    <span>Generated by SuperLocalSEO · Confidential</span>
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
      margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
