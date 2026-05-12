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

// ─── On-page pass/fail detection + tips ──────────────────────────────────────

function isOnPagePass(detail: string): boolean {
  return /optimal|present|detected|found|served over https/i.test(detail) &&
    !/no |not |too short|too long|reduce|missing|add |trim|migrate|expand|check|multiple/i.test(detail);
}

interface Tip { what: string; howToFix: string; }

function getOnPageTip(detail: string): Tip | null {
  const d = detail.toLowerCase();
  const pass = isOnPagePass(detail);
  if (d.includes('https')) {
    return {
      what: 'HTTPS encrypts traffic between your visitor and your website. Google has used HTTPS as a ranking signal since 2014, and browsers now show a "Not Secure" warning on HTTP sites — which kills trust immediately.',
      howToFix: pass
        ? 'Your site is already on HTTPS — no action needed.'
        : 'Contact your web host or domain registrar and enable an SSL/TLS certificate (free via Let\'s Encrypt on most hosts). Then redirect all HTTP traffic to HTTPS with a 301 redirect.',
    };
  }
  if (d.includes('title tag') || d.includes('<title>')) {
    return {
      what: 'The title tag is the blue clickable headline shown in Google search results. It\'s one of the strongest on-page signals — Google uses it to understand what your page is about and it directly affects click-through rate.',
      howToFix: pass
        ? 'Your title is the right length — make sure it includes your primary service and city (e.g. "HVAC Repair in Tulsa, OK | Your Business").'
        : d.includes('short')
          ? 'Expand the title to 50–60 characters. Include your primary keyword and city: "[Service] in [City, State] | [Brand]".'
          : 'Trim the title to under 60 characters so it doesn\'t get cut off in search results.',
    };
  }
  if (d.includes('meta description')) {
    return {
      what: 'The meta description is the grey snippet of text shown beneath your title in search results. A compelling description increases click-through rate — which indirectly improves rankings.',
      howToFix: pass
        ? 'Your description length is good. Make sure it includes your primary keyword, city, and a call to action.'
        : d.includes('short')
          ? 'Expand to 120–160 characters. Describe what you do, mention your city, and add a call to action like "Call us for same-day service."'
          : 'Trim to 155 characters — anything longer gets cut off with "…" in search results.',
    };
  }
  if (d.includes('h1')) {
    return {
      what: 'The H1 is the main visible heading on your webpage. Search engines treat it as the primary topic signal — it should clearly state what the page is about. Every page should have exactly one H1.',
      howToFix: pass
        ? 'Your page has exactly 1 H1 — good. Make sure it includes your primary service and city.'
        : d.includes('no ')
          ? 'Add a single H1 tag to your homepage. In most website builders the main page headline is automatically the H1. Make it: "[Service] in [City, State]".'
          : 'You have multiple H1 tags — reduce to one. Additional headings should use H2 and H3.',
    };
  }
  if (d.includes('schema') || d.includes('json-ld') || d.includes('structured data')) {
    return {
      what: 'Schema markup (LocalBusiness JSON-LD) tells Google exactly what type of business you are, your address, phone, hours, and service area. It can unlock rich results in search (star ratings, address, hours) and is a proven local SEO signal.',
      howToFix: pass
        ? 'LocalBusiness schema is detected — great. Make sure it includes your NAP, opening hours, and geographic area served.'
        : 'Add a LocalBusiness JSON-LD script to your site\'s <head>. In WordPress, the Rank Math or Yoast SEO plugin handles this automatically. For other platforms, use Google\'s Structured Data Markup Helper.',
    };
  }
  if (d.includes('canonical')) {
    return {
      what: 'A canonical tag tells Google which version of a page is the "official" one. Without it, Google may index duplicate versions of your page (http vs https, with/without trailing slash) and split ranking signals between them.',
      howToFix: pass
        ? 'Canonical tag is present — no action needed. Verify it points to the correct HTTPS URL.'
        : 'Add <link rel="canonical" href="https://yoursite.com/"> to your page\'s <head>. Most SEO plugins (Yoast, Rank Math) add this automatically.',
    };
  }
  if (d.includes('viewport') || d.includes('mobile')) {
    return {
      what: 'The viewport meta tag tells mobile browsers how to scale your page. Without it, your site renders at desktop width on phones. Google primarily uses the mobile version of your site to determine rankings (mobile-first indexing).',
      howToFix: pass
        ? 'Viewport tag is present — your site signals mobile responsiveness.'
        : 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside your page\'s <head>. Any modern theme or website builder includes this automatically.',
    };
  }
  if (d.includes('could not fetch') || d.includes('http ') || d.includes('accessible')) {
    return {
      what: 'The audit tool couldn\'t load your website — either the URL is wrong, the site returned an error, or it blocked our crawler.',
      howToFix: 'Check that the website URL in your location settings is correct and publicly accessible. If your site blocks bots, whitelist the user agent "LocalSEOAuditBot".',
    };
  }
  return null;
}

// ─── Lighthouse category descriptions ────────────────────────────────────────

const LH_CATEGORY_INFO: Record<string, { description: string; howToImprove: string }> = {
  'Overall Performance': {
    description: 'How fast your page loads and feels to visitors. Google uses performance as a ranking signal — slow pages rank lower and lose more than half their visitors before the page even finishes loading.',
    howToImprove: 'Work with your web developer to compress images, reduce JavaScript, and enable browser caching. Focus on the highest-impact issues listed below.',
  },
  'Accessibility': {
    description: 'How usable your site is for people with disabilities — including those using screen readers, keyboard navigation, or requiring high colour contrast. Google treats accessibility as a quality signal.',
    howToImprove: 'Add alt text to images, ensure buttons have descriptive labels, and verify that text colours meet contrast requirements. Most SEO plugins highlight these issues automatically.',
  },
  'Best Practices': {
    description: 'Whether your site follows modern web security and quality standards — HTTPS, no browser console errors, correctly sized images, and up-to-date software. Issues here can affect user trust and search indexing.',
    howToImprove: 'Ensure your site loads over HTTPS, fix any JavaScript errors, and keep plugins and themes updated. Ask your developer to review the flagged items below.',
  },
  'Technical SEO': {
    description: 'Technical signals that affect how well search engines can find, crawl, and understand your pages — including mobile-friendliness, crawlability, meta tags, and structured data.',
    howToImprove: 'Ensure your site has a robots.txt, a sitemap, and that all pages are mobile-friendly. Fix any meta tag or structured data issues flagged below.',
  },
};

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
  .check-block { border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .check-block.pass { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .check-block.fail { background: #fef2f2; border: 1px solid #fecaca; }
  .check-header { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; font-size: 12px; }
  .check-icon { font-weight: 800; flex-shrink: 0; margin-top: 1px; }
  .check-icon.pass { color: #22c55e; }
  .check-icon.fail { color: #ef4444; }
  .check-tip { padding: 8px 12px 10px 32px; border-top: 1px solid; font-size: 11px; color: #475569; }
  .check-block.pass .check-tip { border-color: #bbf7d0; background: #f0fdf4; }
  .check-block.fail .check-tip { border-color: #fecaca; background: #fff7f7; }
  .tip-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 2px; margin-top: 6px; }
  .tip-label:first-child { margin-top: 0; }

  /* CWV */
  .cwv-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .cwv-card { background: #f8fafc; border-radius: 10px; padding: 14px; border: 1px solid #e2e8f0; }
  .cwv-card .metric-name { font-size: 11px; font-weight: 700; color: #475569; }
  .cwv-card .metric-sub { font-size: 10px; color: #94a3b8; margin-top: 1px; margin-bottom: 6px; }
  .cwv-card .metric-val { font-size: 22px; font-weight: 900; }
  .cwv-card .metric-status { font-size: 11px; font-weight: 700; margin-top: 2px; }

  /* Lighthouse categories */
  .lh-row { margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .lh-row-header { padding: 12px 14px 10px; background: #f8fafc; }
  .lh-label { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 8px; display: block; }
  .lh-detail { padding: 10px 14px 12px; border-top: 1px solid #e2e8f0; }
  .lh-desc { font-size: 11px; color: #475569; line-height: 1.6; margin-bottom: 8px; }
  .lh-improve-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 3px; }
  .lh-improve { font-size: 11px; color: #475569; line-height: 1.6; margin-bottom: 10px; }
  .lh-issues-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 6px; }
  .lh-issues { display: flex; flex-direction: column; gap: 6px; }
  .lh-issue { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 10px; }
  .lh-issue-header { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 3px; }
  .lh-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
  .lh-issue-title { font-size: 11px; font-weight: 600; color: #1e293b; flex: 1; }
  .lh-issue-val { font-size: 10px; color: #94a3b8; white-space: nowrap; margin-left: 6px; }
  .lh-issue-desc { font-size: 10px; color: #64748b; line-height: 1.5; padding-left: 14px; }

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
    <div class="section-subtitle">Technical checks run against your homepage</div>
    ${onPageDetails.map((d) => {
      const pass = isOnPagePass(d);
      const tip = getOnPageTip(d);
      return `<div class="check-block ${pass ? 'pass' : 'fail'}">
        <div class="check-header">
          <span class="check-icon ${pass ? 'pass' : 'fail'}">${pass ? '✓' : '✗'}</span>
          <span>${d}</span>
        </div>
        ${tip ? `<div class="check-tip">
          <div class="tip-label">What this means</div>
          <div style="margin-bottom:6px;">${tip.what}</div>
          <div class="tip-label">How to fix it</div>
          <div>${tip.howToFix}</div>
        </div>` : ''}
      </div>`;
    }).join('')}
  </div>` : ''}

  ${lh ? `
  <!-- Website Performance -->
  <div class="section" style="page-break-before:always;">
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

    ${lhCategoryRows.map((cat) => {
      const info = LH_CATEGORY_INFO[cat.label];
      const failingAudits = cat.audits.filter((a) => a.score == null || a.score < 0.9).slice(0, 4);
      return `
    <div class="lh-row">
      <div class="lh-row-header">
        <span class="lh-label">${cat.label}</span>
        ${scoreBar(cat.score, scoreColor(cat.score))}
      </div>
      <div class="lh-detail">
        ${info ? `
        <div class="lh-desc">${info.description}</div>
        <div class="lh-improve-label">How to improve it</div>
        <div class="lh-improve">${info.howToImprove}</div>` : ''}
        ${failingAudits.length > 0 ? `
        <div class="lh-issues-label">Issues found</div>
        <div class="lh-issues">
          ${failingAudits.map((a) => `
          <div class="lh-issue">
            <div class="lh-issue-header">
              <div class="lh-dot" style="background:${auditDotColor(a.score)};"></div>
              <span class="lh-issue-title">${a.title}</span>
              ${a.displayValue ? `<span class="lh-issue-val">${a.displayValue}</span>` : ''}
            </div>
            ${a.description ? `<div class="lh-issue-desc">${a.description}</div>` : ''}
          </div>`).join('')}
        </div>` : `<div style="font-size:11px;color:#22c55e;">✓ No significant issues found in this category</div>`}
      </div>
    </div>`;
    }).join('')}
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
