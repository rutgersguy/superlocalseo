import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { db } from '../db/connection';
import { config } from '../config';
import { logger } from '../utils/logger';
import { sendReportEmail } from './email.service';
import { ENABLED_AI_ENGINES } from '../config/ai_engines.config';
import { mergeBusinessCounts } from './ai_visibility.service';
import { latestRanks, rankKey, summarizeRanks, latestCitations, summarizeCitations, RankObservation } from './measurement.service';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WhiteLabel {
  companyName?: string;
  logoUrl?: string;
  color?: string;
}

export interface ReportData {
  client: { businessName: string; email: string; whiteLabel?: WhiteLabel };
  /** Drives the Lite/Pro split inside the report — see the AI visibility section. */
  plan: 'lite' | 'pro';
  period: { month: number; year: number; label: string };
  locations: Array<{ id: string; name: string }>;
  rankings: {
    avgRank: number | null;
    keywordsInTop3: number;
    keywordsInTop10: number;
    topKeywords: Array<{
      keyword: string;
      location: string;
      rank: number | null;
      prevRank: number | null;
      delta: number | null;
    }>;
  };
  reviews: {
    total: number;
    newThisMonth: number;
    avgRating: number | null;
    byPlatform: Array<{ platform: string; count: number; avgRating: number | null }>;
  };
  /**
   * Null on Lite (#193). Citation auditing is a Pro feature — the scan runs for
   * every client regardless of plan, so the data exists, and the report used to
   * mail it to Lite customers who are blocked from `/citations` in the app.
   * Withheld here rather than hidden in the template, so a later template edit
   * cannot put it back by accident. Same rule as the AI competitor list.
   */
  citations: {
    score: number | null;
    checked?: number;
    unverified?: number;
    missing?: number;
    listed: number;
    total: number;
    napAccurate: number;
    /** Listings whose NAP we could actually read — the denominator for napAccurate. */
    napChecked: number;
  } | null;
  competitors: Array<{
    name: string;
    website: string | null;
    googleRating: number | null;
    googleReviewCount: number | null;
  }>;
  clientStats: {
    avgRating: number | null;
    reviewCount: number;
  };
  gap: {
    winning: number;
    competing: number;
    vulnerable: number;
    absent: number;
    atRisk: Array<{ keyword: string; location: string; rank: number | null; status: string }>;
  };
  sentiment: { positive: number; neutral: number; negative: number };
  visibility: { current: number | null; delta: number | null };
  /**
   * AI assistant visibility for the month (#192). Null when no scan landed
   * inside the period — a client in their first days, or a month the job never
   * ran. The section is omitted entirely rather than rendered empty, because a
   * blank panel in a PDF reads as a broken report.
   */
  aiVisibility: {
    scannedAt: Date;
    /** Over DETERMINATE checks only — see the unverified note below. */
    mentionRate: number | null;
    /** Same measure for the prior month, or null if there was no scan then. */
    priorMentionRate: number | null;
    engines: Array<{
      engine: string;
      label: string;
      mentioned: number;
      absent: number;
      unverified: number;
      determinate: number;
      bestPosition: number | null;
    }>;
    /** Pro only. Empty on Lite, which gets the verdict but not the depth. */
    topCompetitors: Array<{ name: string; timesNamed: number; isYou: boolean }>;
  } | null;
  auditScore: number | null;
  roi: { configured: boolean; estClicks: number; estLeads: number; estRevenue: number } | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function periodDates(month: number, year: number): { start: Date; end: Date } {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('Invalid report period');
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

function priorPeriodDates(month: number, year: number): { start: Date; end: Date } {
  const priorMonth = month === 1 ? 12 : month - 1;
  const priorYear = month === 1 ? year - 1 : year;
  return periodDates(priorMonth, priorYear);
}

// ─── gatherReportData ───────────────────────────────────────────────────────────

export async function gatherReportData(
  clientId: string,
  month: number,
  year: number,
): Promise<ReportData> {
  // Client + user email + white-label settings
  const client = await db('clients')
    .join('users', 'clients.user_id', 'users.id')
    .where('clients.id', clientId)
    .select(
      'clients.business_name',
      'clients.subscription_tier',
      'clients.white_label_company_name',
      'clients.white_label_logo_url',
      'clients.white_label_color',
      'clients.product_line',
      'users.email',
    )
    .first() as {
      business_name: string;
      email: string;
      subscription_tier: number;
      product_line: 'lite' | 'pro' | null;
      white_label_company_name: string | null;
      white_label_logo_url: string | null;
      white_label_color: string | null;
    } | undefined;

  if (!client) throw new Error(`Client not found: ${clientId}`);

  // Locations
  const locationRows = await db('locations')
    .where('client_id', clientId)
    .select('id', 'name') as Array<{ id: string; name: string }>;

  const { start: periodStart, end: periodEnd } = periodDates(month, year);
  const { start: priorStart, end: priorEnd } = priorPeriodDates(month, year);

  // ── Rankings ────────────────────────────────────────────────────────────────
  const currentRankRows = await latestRanks(clientId, periodEnd, periodStart) as RankObservation[];
  const priorRankRows = await latestRanks(clientId, priorEnd, priorStart) as RankObservation[];
  const priorRankMap = new Map(priorRankRows.map(r => [rankKey(r), r]));
  const allKeywords = currentRankRows.map(r => {
    const prior = priorRankMap.get(rankKey(r));
    const prevRank = prior?.rankType === r.rankType ? prior.rank : null;
    return {
      keyword: r.keyword,
      location: `${r.location} · ${r.geoLocation ?? 'primary area'} · ${r.searchEngine} / ${r.rankType ?? 'unspecified result type'}`,
      rank: r.rank, prevRank,
      delta: r.rank != null && prevRank != null ? prevRank - r.rank : null,
    };
  });
  const rankSummary = summarizeRanks(currentRankRows);
  const { avgRank, keywordsInTop3, keywordsInTop10 } = rankSummary;
  const topKeywords = [...allKeywords].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).slice(0, 10);

  // ── Reviews ──────────────────────────────────────────────────────────────────
  const totalReviewRows = (await db('reviews')
    .where('client_id', clientId)
    .where('review_date', '<', periodEnd)
    .count('id as count')
    .avg('rating as avg_rating')
    .first()) as { count: string; avg_rating: string | null };

  const newReviewRows = (await db('reviews')
    .where('client_id', clientId)
    .where('review_date', '>=', periodStart)
    .where('review_date', '<', periodEnd)
    .count('id as count')
    .first()) as { count: string };

  const byPlatformRows = (await db('reviews')
    .where('client_id', clientId)
    .where('review_date', '<', periodEnd)
    .select('platform')
    .count('id as count')
    .avg('rating as avg_rating')
    .groupBy('platform')) as Array<{
    platform: string;
    count: string;
    avg_rating: string | null;
  }>;

  // ── Citations ─────────────────────────────────────────────────────────────────
  const locationIds = locationRows.map(l => l.id);
  const citationRows = await latestCitations(clientId, periodEnd);
  const citationSummary = summarizeCitations(citationRows);

  // ── AI assistant visibility (#192) ────────────────────────────────────────
  //
  // Scoped to the month the report covers, not "latest overall": the report is
  // a record of where the business stood in August, and the month-over-month
  // delta is the number the owner actually reacts to.
  //
  // A run writes every row with the same scanned_at, so the latest timestamp
  // inside the period IS that run. The comparison stays in SQL rather than
  // round-tripping a Date through JS — Postgres keeps microseconds where a JS
  // Date keeps milliseconds, and a re-sent value silently matches nothing.
  const plan: 'lite' | 'pro' = client.product_line ?? 'pro';

  async function aiRowsForPeriod(from: Date, to: Date) {
    if (locationIds.length === 0) return [];
    return (await db('ai_visibility_snapshots as current_ai')
      .whereIn('location_id', locationIds)
      .whereIn('engine', ENABLED_AI_ENGINES.map(e => e.key))
      .where('scanned_at', '=', db('ai_visibility_snapshots as latest_ai')
        .whereRaw('latest_ai.location_id = current_ai.location_id')
        .where('scanned_at', '>=', from)
        .where('scanned_at', '<', to)
        .max('scanned_at'))
      .select('engine', 'status', 'position', 'businesses_named', 'scanned_at')) as Array<{
        engine: string;
        status: 'mentioned' | 'absent' | 'unverified';
        position: number | null;
        businesses_named: string[];
        scanned_at: Date;
      }>;
  }

  const aiRows = await aiRowsForPeriod(periodStart, periodEnd);
  const aiPriorRows = await aiRowsForPeriod(priorStart, priorEnd);

  /** Share of DETERMINATE checks that named the business. */
  function rateOf(rows: Array<{ status: string }>): number | null {
    const determinate = rows.filter((r) => r.status !== 'unverified').length;
    if (determinate === 0) return null;
    return Math.round((rows.filter((r) => r.status === 'mentioned').length / determinate) * 100);
  }

  const aiVisibility = aiRows.length === 0 ? null : {
    scannedAt: aiRows[0].scanned_at,
    // Unverified checks are excluded from the denominator, not counted as
    // misses. A week an assistant was unreachable must not print as a decline
    // in the customer's visibility — same rule as citation nap_match nulls.
    mentionRate: rateOf(aiRows),
    priorMentionRate: aiPriorRows.length === 0 ? null : rateOf(aiPriorRows),
    engines: ENABLED_AI_ENGINES.map((e) => {
      const mine = aiRows.filter((r) => r.engine === e.key);
      const mentioned = mine.filter((r) => r.status === 'mentioned');
      const positions = mentioned.map((r) => r.position).filter((p): p is number => p != null);
      return {
        engine: e.key,
        label: e.label,
        mentioned: mentioned.length,
        absent: mine.filter((r) => r.status === 'absent').length,
        unverified: mine.filter((r) => r.status === 'unverified').length,
        determinate: mine.filter((r) => r.status !== 'unverified').length,
        bestPosition: positions.length ? Math.min(...positions) : null,
      };
    }),
    // Pro only. Lite gets the verdict — which assistants recommend them — but
    // not who was recommended instead. Withheld here rather than hidden in the
    // template, so a future template edit cannot leak it.
    topCompetitors: plan === 'pro'
      ? mergeBusinessCounts(
          aiRows.flatMap((r) => r.businesses_named ?? []),
          [client.business_name, ...locationRows.map((l) => l.name)],
        ).slice(0, 8)
      : [],
  };

  const competitorRows = await db('competitors')
    .where({ client_id: clientId })
    .where('updated_at', '<', periodEnd)
    .select('name', 'website', 'google_rating', 'google_review_count')
    .orderBy('google_review_count', 'desc') as Array<{
      name: string;
      website: string | null;
      google_rating: string | null;
      google_review_count: number | null;
    }>;

  // ── Client stats for competitor comparison ────────────────────────────────────
  const clientStatRow = await db('reviews')
    .where('client_id', clientId)
    .where('platform', 'google')
    .where('review_date', '<', periodEnd)
    .count('id as count')
    .avg('rating as avg_rating')
    .first() as { count: string; avg_rating: string | null };

  // ── Keyword gap breakdown ─────────────────────────────────────────────────────
  const gapWithStatus = allKeywords.map(r => ({
    keyword: r.keyword, location: r.location, rank: r.rank,
    status: r.rank == null ? 'absent' : r.rank <= 3 ? 'winning' : r.rank <= 10 ? 'competing' : 'vulnerable',
  }));

  const gapCounts = { winning: 0, competing: 0, vulnerable: 0, absent: 0 };
  for (const k of gapWithStatus) gapCounts[k.status as keyof typeof gapCounts]++;
  const atRisk = gapWithStatus.filter((k) => k.status === 'vulnerable' || k.status === 'absent').slice(0, 15);

  // ── Review sentiment ─────────────────────────────────────────────────────────
  const sentimentRows = await db('reviews')
    .where('client_id', clientId)
    .where('review_date', '<', periodEnd)
    .whereNotNull('sentiment')
    .select('sentiment')
    .count('id as count')
    .groupBy('sentiment') as Array<{ sentiment: string; count: string }>;

  const sentimentMap: Record<string, number> = {};
  for (const s of sentimentRows) sentimentMap[s.sentiment] = parseInt(s.count, 10);

  // No historical composite is published: metrics_daily is not a reliable source,
  // and weighting unknown review/citation values would fabricate a score.
  const visibilityCurrent: number | null = null;
  const visibilityDelta: number | null = null;

  // ── Audit score ──────────────────────────────────────────────────────────────
  const auditRow = locationIds.length > 0
    ? await db('location_audits')
        .whereIn('location_id', locationIds)
        .where('status', 'complete')
        .where('completed_at', '<', periodEnd)
        .where(q => q.whereNotNull('bl_report_id').orWhereRaw("raw_data->>'scoreMethodology' = ?", ['verified_observations_v2']))
        .where('updated_at', '<', periodEnd)
        .orderBy('updated_at', 'desc')
        .select('composite_score')
        .first() as { composite_score: string | null } | undefined
    : undefined;
  const auditScore = auditRow?.composite_score != null ? parseFloat(auditRow.composite_score) : null;

  // Historical search volumes and ROI configuration are not versioned. Do not
  // invent volume from rank or insert today's assumptions into a historical brief.
  const roiData: ReportData['roi'] = null;

  const whiteLabel: WhiteLabel | undefined =
    plan === 'pro' &&
    (client.white_label_company_name || client.white_label_logo_url || client.white_label_color)
      ? {
          companyName: client.white_label_company_name ?? undefined,
          logoUrl: client.white_label_logo_url ?? undefined,
          color: client.white_label_color ?? undefined,
        }
      : undefined;

  const report: ReportData = {
    client: {
      businessName: client.business_name,
      email: client.email,
      whiteLabel,
    },
    period: {
      month,
      year,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
    },
    plan,
    locations: locationRows,
    rankings: {
      avgRank,
      keywordsInTop3,
      keywordsInTop10,
      topKeywords,
    },
    reviews: {
      total: parseInt(totalReviewRows?.count ?? '0', 10),
      newThisMonth: parseInt(newReviewRows?.count ?? '0', 10),
      avgRating: totalReviewRows?.avg_rating != null ? parseFloat(totalReviewRows.avg_rating) : null,
      byPlatform: byPlatformRows.map((r) => ({
        platform: r.platform,
        count: parseInt(r.count, 10),
        avgRating: r.avg_rating != null ? parseFloat(r.avg_rating) : null,
      })),
    },
    citations: citationSummary.total > 0 ? citationSummary : null,
    competitors: competitorRows.map((c) => ({
      name: c.name,
      website: c.website,
      googleRating: c.google_rating != null ? parseFloat(c.google_rating) : null,
      googleReviewCount: c.google_review_count,
    })),
    clientStats: {
      avgRating: clientStatRow?.avg_rating != null ? parseFloat(clientStatRow.avg_rating) : null,
      reviewCount: parseInt(clientStatRow?.count ?? '0', 10),
    },
    gap: { ...gapCounts, atRisk },
    sentiment: {
      positive: sentimentMap['positive'] ?? 0,
      neutral: sentimentMap['neutral'] ?? 0,
      negative: sentimentMap['negative'] ?? 0,
    },
    visibility: { current: visibilityCurrent, delta: visibilityDelta },
    aiVisibility,
    auditScore,
    roi: roiData,
  };

  // ── Plan gate (#193, decision: gate rather than reprice) ──────────────────
  //
  // Lite's report is rankings, reviews, the AI visibility verdict and
  // recommendations. Citation health, ROI attribution, competitor benchmarking
  // and the SEO audit score are Pro, are gated everywhere else in the product,
  // and were being emailed to Lite anyway because this file had no notion of a
  // plan.
  //
  // Stripped from the DATA, not the markup. #157 was four Pro surfaces that
  // rendered for Lite because only the UI knew about the gate; a report section
  // added later reads an already-empty field rather than needing to remember.
  //
  // Deliberately NOT gated: the visibility score (a single composite the
  // dashboard shows both plans) and the keyword position breakdown, which is
  // computed from the client's own ranks and is not competitor data despite
  // the name.
  if (plan === 'lite') {
    report.citations = null;
    report.auditScore = null;
    report.competitors = [];
    report.roi = null;
  }

  return report;
}

// ─── renderReportHtml ───────────────────────────────────────────────────────────

export function renderReportHtml(data: ReportData): string {
  const { client, period, rankings, reviews, citations, competitors, clientStats, gap, sentiment, visibility, aiVisibility, auditScore, roi } = data;
  // Default report branding matches the authenticated workspace and public
  // homepage. A tenant white-label color still takes precedence.
  const brandColor = client.whiteLabel?.color ?? '#173E36';
  const brandName = client.whiteLabel?.companyName ?? 'SuperLocalSEO';
  const brandLogoUrl = client.whiteLabel?.logoUrl ?? 'https://superlocalseo.com/sls_logo_wide_white.png';

  // Auto recommendations
  const recommendations: string[] = [];

  if (rankings.avgRank != null && rankings.avgRank > 20) {
    recommendations.push(
      'Average keyword ranking is above position 20 — focus on on-page SEO and link building to push rankings higher.',
    );
  }

  const droppedKeywords = rankings.topKeywords.filter(
    (k) => k.delta != null && k.delta < 0,
  ).length;
  if (droppedKeywords > 0) {
    recommendations.push(
      `${droppedKeywords} keyword${droppedKeywords > 1 ? 's' : ''} of the displayed observations declined versus the prior month. Review the matching area and search engine before deciding what to change.`,
    );
  }

  // AI visibility recommendations (#192). Placed FIRST because a business that
  // no assistant names has a bigger problem than a citation gap, and the report
  // should say so in the order the owner should act.
  if (aiVisibility) {
    const silent = aiVisibility.engines.filter((e) => e.determinate > 0 && e.mentioned === 0);
    const rate = aiVisibility.mentionRate;

    if (silent.length === aiVisibility.engines.filter((e) => e.determinate > 0).length && silent.length > 0) {
      recommendations.push(
        `Your business was not named in the verified answers sampled for this report. Inspect the questions and cited sources before choosing an action; this sample does not establish what all users see or why a business was omitted.`,
      );
    } else if (silent.length > 0) {
      recommendations.push(
        `${silent.map((e) => e.label).join(' and ')} did not name your business in this report’s verified sample${rate != null ? `, holding you at ${rate}%` : ''} — each assistant draws on a different mix of sources, so being recommended by one does not carry to the others.`,
      );
    }

    const prior = aiVisibility.priorMentionRate;
    if (rate != null && prior != null && rate < prior) {
      recommendations.push(
        `Your sampled AI mention rate changed from ${prior}% to ${rate}%. Compare the questions, locations and successful checks first; changes in sample coverage can affect this percentage.`,
      );
    }
  }

  // Guarded on the data, not on the plan. A Lite report must never recommend
  // acting on a section it did not show — that is a support ticket, not advice.
  if (citations && (citations.missing ?? ((citations.checked ?? citations.total) - citations.listed)) > 0) {
    const missing = citations.missing ?? ((citations.checked ?? citations.total) - citations.listed);
    recommendations.push(
      `${missing} director${missing === 1 ? 'y' : 'ies'} returned no matching listing. Check the evidence and search the directory before creating a new listing.`,
    );
  }

  if (citations && citations.napAccurate < citations.napChecked) {
    const napIssues = citations.napChecked - citations.napAccurate;
    recommendations.push(
      `${napIssues} citation${napIssues > 1 ? 's have' : ' has'} name, address or phone differences. Review the observed fields; formatting differences do not by themselves establish incorrect business information or a Google penalty.`,
    );
  }

  if (reviews.avgRating != null && reviews.avgRating < 4.0) {
    recommendations.push(
      `Average review rating is ${reviews.avgRating.toFixed(1)} — actively respond to negative reviews and invite customers to share an honest review, regardless of rating.`,
    );
  }

  if (reviews.newThisMonth === 0) {
    recommendations.push(
      'No reviews dated within this month are stored. Confirm the correct review source is connected and synchronized before concluding that no customers left reviews.',
    );
  }

  if (sentiment.negative > sentiment.positive && sentiment.negative > 2) {
    recommendations.push(
      `${sentiment.negative} negative reviews detected — respond promptly and professionally to each one to demonstrate your commitment to customer satisfaction.`,
    );
  }

  if (gap.absent > 3) {
    recommendations.push(
      `${gap.absent} observations returned no ranking within the collected search results. Review the matching keyword, area, engine and collection coverage before deciding whether content changes are needed.`,
    );
  }

  if (gap.vulnerable > 5) {
    recommendations.push(
      `${gap.vulnerable} observations ranked outside the top 10. Review page relevance and the matching area and result type; this finding alone does not identify the cause.`,
    );
  }

  if (auditScore != null && auditScore < 60) {
    recommendations.push(
      `Latest available location audit score is ${auditScore.toFixed(0)}/100 — review your Google Business Profile completeness, local citations, and on-page SEO signals.`,
    );
  }

  // Imported review subsets are not comparable to complete Google profile totals.
  if (recommendations.length === 0) {
    recommendations.push(
      'No additional recommendation was triggered by the available data. This is not confirmation that all SEO work is complete; check collection coverage and review the detailed observations.',
    );
  }

  const starRating = (rating: number | null) => {
    if (rating == null) return 'N/A';
    const full = Math.min(5, Math.max(0, Math.round(rating)));
    return '★'.repeat(full) + '☆'.repeat(5 - full) + ` ${rating.toFixed(1)}`;
  };

  const deltaHtml = (delta: number | null) => {
    if (delta == null) return '<span style="color:#9ca3af">—</span>';
    if (delta > 0) return `<span style="color:#16a34a">▲ ${delta}</span>`;
    if (delta < 0) return `<span style="color:#dc2626">▼ ${Math.abs(delta)}</span>`;
    return '<span style="color:#9ca3af">—</span>';
  };

  const rankCell = (rank: number | null) => (rank != null ? String(rank) : '<span style="color:#9ca3af">—</span>');

  const topKeywordsRows = rankings.topKeywords
    .map(
      (k, i) => `
        <tr style="background:${i % 2 === 0 ? '#fffefa' : '#f8f6f0'}">
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;color:#20362f">${escHtml(k.keyword)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;color:#57665e">${escHtml(k.location)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center">${rankCell(k.rank)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center;color:#57665e">${rankCell(k.prevRank)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center">${deltaHtml(k.delta)}</td>
        </tr>`,
    )
    .join('');

  const platformRows = reviews.byPlatform
    .map(
      (p) => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;color:#20362f">${escHtml(p.platform)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center;color:#20362f">${p.count}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center;color:#f59e0b">${starRating(p.avgRating)}</td>
        </tr>`,
    )
    .join('');

  const recommendationItems = recommendations
    .map((r) => `<li style="margin-bottom:8px;font-size:13px;color:#374151;line-height:1.6">${escHtml(r)}</li>`)
    .join('');

  const citationBarWidth = citations ? Math.min(100, Math.max(0, citations.score ?? 0)) : 0;
  const citationBarColor = !citations || citations.score === null
    ? '#6b7280'
    : citations.score >= 80 ? '#16a34a' : citations.score >= 60 ? '#f59e0b' : '#dc2626';

  const gapSection = (gap.winning + gap.competing + gap.vulnerable + gap.absent) > 0 ? `
  <div style="padding:12px 40px 14px">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${brandColor};margin-bottom:10px;letter-spacing:-0.01em">Ranking Observation Breakdown</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:${gap.atRisk.length > 0 ? '14px' : '0'}">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 8px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#16a34a">${gap.winning}</div>
        <div style="font-size:10px;font-weight:600;color:#15803d;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em">Winning (1–3)</div>
      </div>
      <div style="background:#eaf0e9;border:1px solid #d8ded5;border-radius:6px;padding:10px 8px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#28624e">${gap.competing}</div>
        <div style="font-size:10px;font-weight:600;color:#28624e;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em">Competing (4–10)</div>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 8px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#d97706">${gap.vulnerable}</div>
        <div style="font-size:10px;font-weight:600;color:#b45309;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em">Vulnerable (11+)</div>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 8px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#dc2626">${gap.absent}</div>
        <div style="font-size:10px;font-weight:600;color:#b91c1c;margin-top:2px;text-transform:uppercase;letter-spacing:0.05em">Not Ranking</div>
      </div>
    </div>
    ${gap.atRisk.length > 0 ? `
    <div style="break-inside:avoid"><p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px">Observations to review:</p>
    <div style="border:1px solid #d8ded5;border-radius:8px;overflow:hidden">
      <table>
        <thead><tr><th>Keyword</th><th>Location / area / engine</th><th class="center">Period-end rank</th><th class="center">Status</th></tr></thead>
        <tbody>
          ${gap.atRisk.map((k, i) => `
            <tr style="background:${i % 2 === 0 ? '#fffefa' : '#f8f6f0'}">
              <td style="padding:9px 14px;border-bottom:1px solid #d8ded5;font-size:13px;color:#20362f">${escHtml(k.keyword)}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #d8ded5;font-size:13px;color:#57665e">${escHtml(k.location)}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center;color:#20362f">${k.rank ?? '—'}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center">
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;${k.status === 'absent' ? 'background:#fef2f2;color:#dc2626' : 'background:#fffbeb;color:#d97706'}">
                  ${k.status === 'absent' ? 'Not ranking' : 'Vulnerable'}
                </span>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div></div>` : ''}
  </div>` : '';

  /**
   * Second row of the executive summary.
   *
   * Assembled as a list rather than written out, because the Pro-only boxes
   * (citation score, SEO audit score) are absent on Lite and a fixed
   * three-column grid would otherwise render with a visible hole. Padded from
   * the Lite-inclusive stats so both plans get a full row.
   */
  const summaryBoxes: string[] = [statBox('Reviews dated this month', String(reviews.newThisMonth), brandColor)];

  if (citations) {
    summaryBoxes.push(statBox('Citation Score', citations.score == null ? 'Not verified' : `${citations.score}%`, citationScoreColor(citations.score ?? 0)));
  }
  if (visibility.current != null) {
    summaryBoxes.push(statBox(
      'Visibility Score',
      `${visibility.current}/100${visibility.delta != null ? (visibility.delta >= 0 ? ` ▲${visibility.delta}` : ` ▼${Math.abs(visibility.delta)}`) : ''}`,
      visibility.delta != null && visibility.delta >= 0 ? '#16a34a' : brandColor,
    ));
  }
  if (auditScore != null) {
    summaryBoxes.push(statBox(
      'Latest Location Audit',
      `${auditScore.toFixed(0)}/100`,
      auditScore >= 70 ? '#16a34a' : auditScore >= 50 ? '#f59e0b' : '#dc2626',
    ));
  }
  if (aiVisibility?.mentionRate != null) {
    summaryBoxes.push(statBox('AI Sample Mention Rate', `${aiVisibility.mentionRate}%`, brandColor));
  }
  summaryBoxes.push(statBox('Stored reviews to month end', String(reviews.total), brandColor));

  if (summaryBoxes.length < 3) summaryBoxes.push(statBox('Locations included', String(data.locations.length), brandColor));
  const summaryRowTwo = summaryBoxes.slice(0, 3).join('\n      ');

  /**
   * AI assistant visibility (#192).
   *
   * Placed directly under the Executive Summary because it is the lead claim on
   * the marketing site and the first thing the dashboard shows — the report
   * should not bury it below citation health (docs/POSITIONING.md).
   *
   * Omitted entirely when there was no scan in the month. An empty panel reads
   * as a broken report, and "no data" is not a finding worth a page.
   */
  const aiSection = !aiVisibility ? '' : (() => {
    const rate = aiVisibility.mentionRate;
    const prior = aiVisibility.priorMentionRate;
    const delta = rate != null && prior != null ? rate - prior : null;

    const deltaLabel = delta == null
      ? '<span style="font-size:11px;color:#9ca3af">no comparison for last month</span>'
      : delta === 0
      ? '<span style="font-size:11px;color:#6b7280">no change from last month</span>'
      : `<span style="font-size:11px;font-weight:600;color:${delta > 0 ? '#16a34a' : '#dc2626'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} points vs last month</span>`;

    const engineRows = aiVisibility.engines.map((e) => {
      // Three states, kept three. `unverified` is grey and excluded from the
      // rate; printing it as "not recommended" would be a claim the data does
      // not support.
      const verdict = e.determinate === 0
        ? '<span style="color:#9ca3af;font-weight:600">Couldn\'t check</span>'
        : e.mentioned > 0
        ? `<span style="color:#16a34a;font-weight:700">Yes${e.bestPosition != null ? ` — best #${e.bestPosition}` : ''}</span>`
        : '<span style="color:#dc2626;font-weight:700">Not mentioned</span>';

      const detail = e.determinate === 0
        ? 'no answer this month'
        : `named you in ${e.mentioned} of ${e.determinate} question${e.determinate === 1 ? '' : 's'}${e.unverified > 0 ? ` · ${e.unverified} couldn't be checked` : ''}`;

      return `<tr>
        <td style="padding:7px 0;font-size:12px;font-weight:600;color:#111827;width:110px">${escHtml(e.label)}</td>
        <td style="padding:7px 0;font-size:12px">${verdict}</td>
        <td style="padding:7px 0;font-size:11px;color:#6b7280;text-align:right">${escHtml(detail)}</td>
      </tr>`;
    }).join('');

    const competitorBlock = aiVisibility.topCompetitors.length === 0 ? '' : `
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid #d8ded5">
        <p style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px">Who the assistants named this month</p>
        <p style="font-size:11px;color:#6b7280;line-height:1.7">
          ${aiVisibility.topCompetitors.map((c) => c.isYou
            ? `<strong style="color:${brandColor}">${escHtml(c.name)} (you)</strong> <span style="color:#9ca3af">${c.timesNamed}&times;</span>`
            : `${escHtml(c.name)} <span style="color:#9ca3af">${c.timesNamed}&times;</span>`).join(' &nbsp;·&nbsp; ')}
        </p>
      </div>`;

    return `
  <!-- AI Visibility -->
  <div style="padding:0 40px 14px;break-inside:avoid">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${brandColor};margin-bottom:10px;letter-spacing:-0.01em">AI Assistant Visibility</h2>
    <div style="border:1px solid #d8ded5;border-radius:8px;padding:12px 16px;background:#fffefa">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">
        <div>
          <span style="font-size:13px;font-weight:600;color:#111827">Mentioned in </span>
          <span style="font-size:18px;font-weight:700;color:${brandColor}">${rate != null ? `${rate}%` : 'N/A'}</span>
          <span style="font-size:13px;color:#6b7280"> of verified sampled answers</span>
        </div>
        ${deltaLabel}
      </div>
      <table style="width:100%;border-collapse:collapse">${engineRows}</table>
      ${competitorBlock}
    </div>
    <p style="margin-top:6px;font-size:10px;color:#9ca3af">
      Latest available scan per location within the report month. ${aiVisibility.engines.reduce((n, e) => n + e.mentioned, 0)} mentions across ${aiVisibility.engines.reduce((n, e) => n + e.determinate, 0)} verified answers. These are sampled API responses, not measured customer exposure.
      Checks we could not complete are excluded from the percentage rather than counted against you.
    </p>
  </div>`;
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(client.businessName)} SEO Report — ${escHtml(period.label)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #ffffff; color: #20362f; }
  /* Keep the masthead as the only full-width color block. A background on
     this wrapper is repeated by Chromium across every printed page and reads
     as an unintended cream panel beneath the green header. */
  .page { max-width: 900px; margin: 0 auto; background: transparent; border: 0; box-shadow: none; }
  h2, h3 { font-family: Georgia, 'Times New Roman', serif; }
  p { line-height: 1.5; }
  p:has(+ table) { break-after: avoid; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eaf0e9; padding: 10px 14px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #57665e; text-align: left; border-bottom: 2px solid #d8ded5; }
  tr { break-inside: avoid; }
  h2 { break-after: avoid; }
  td { overflow-wrap: anywhere; }
  th.center { text-align: center; }
  @media print {
    .page { max-width: 100%; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="background:${brandColor};color:#ffffff;padding:28px 40px 24px">
    <!-- Logo left / client info right -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      ${client.whiteLabel?.logoUrl ? `<img src="${escHtml(brandLogoUrl)}" alt="${escHtml(brandName)}" style="height:34px;object-fit:contain;display:block;flex-shrink:0" />` : `<span style="font-size:20px;font-weight:700">${escHtml(brandName)}</span>`}
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;line-height:1.2">${escHtml(client.businessName)}</div>
        <div style="font-size:11px;opacity:0.7;margin-top:3px;letter-spacing:0.02em">${escHtml(client.email)}</div>
      </div>
    </div>
    <!-- Divider -->
    <div style="border-top:1px solid rgba(255,255,255,0.2);margin-bottom:18px"></div>
    <!-- Centered report title -->
    <div style="text-align:center">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;letter-spacing:-0.01em">Monthly visibility brief</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;opacity:0.65;margin-top:5px">${escHtml(period.label)}</div>
    </div>
  </div>

  <!-- Executive Summary -->
  <p style="padding:16px 40px 0;font-size:11px;color:#57665e">UTC report period. Ranking counts are observations (keyword × location × area × engine), not unique keywords. Only observations collected in this month are included; averages exclude unranked results. Review totals count stored reviews by publication date, not a verified total on each platform. Citation results are the latest available through month end; unverified checks are excluded from the percentage. Historical competitor/audit values unavailable as of month end are omitted. The audit score, when available, is the latest completed location audit, not an average of all locations.</p>
  <div style="padding:28px 40px 12px">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${brandColor};margin-bottom:10px;letter-spacing:-0.01em">Executive Summary</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
      ${statBox('Avg. Rank', rankings.avgRank != null ? String(rankings.avgRank) : 'N/A', brandColor)}
      ${statBox('Observations in Top 10', String(rankings.keywordsInTop10), brandColor)}
      ${statBox('Observations in Top 3', String(rankings.keywordsInTop3), brandColor)}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${summaryRowTwo}
    </div>
  </div>

  ${aiSection}

  ${gapSection}

  <!-- Citations (Pro only — null on Lite, see gatherReportData) -->
  ${!citations ? '' : `
  <div style="padding:0 40px 14px;break-inside:avoid">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${brandColor};margin-bottom:10px;letter-spacing:-0.01em">Citation Health</h2>
    <div style="border:1px solid #d8ded5;border-radius:8px;padding:12px 16px;background:#fffefa">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;font-weight:600;color:#111827">Citation Score</span>
        <span style="font-size:16px;font-weight:700;color:${citationBarColor}">${citations.score == null ? 'Not verified' : `${citations.score}%`}</span>
      </div>
      <div style="background:#d8ded5;border-radius:999px;height:8px;overflow:hidden;margin-bottom:10px">
        <div style="background:${citationBarColor};width:${citationBarWidth}%;height:100%;border-radius:999px"></div>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        ${citationStatPill('Listed', citations.listed, '#16a34a')}
        ${citationStatPill('No match found', citations.missing ?? ((citations.checked ?? citations.total) - citations.listed), '#dc2626')}
        ${citationStatPill('Exact NAP matches', citations.napAccurate, brandColor)}
        ${citationStatPill('Location-directory checks', citations.total, '#6b7280')}
        ${citationStatPill('Unverified', citations.unverified ?? 0, '#6b7280')}
      </div>
    </div>
  </div>`}

  <!-- ROI Estimates -->
  ${roi ? `
  <div style="padding:0 40px 14px;break-inside:avoid">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${brandColor};margin-bottom:10px;letter-spacing:-0.01em">Modeled Traffic Scenario</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${statBox('Est. Monthly Clicks', roi.estClicks.toLocaleString(), brandColor)}
      ${statBox('Est. Monthly Leads', roi.estLeads.toLocaleString(), brandColor)}
      ${statBox('Est. Monthly Revenue', `$${roi.estRevenue >= 1000 ? (roi.estRevenue / 1000).toFixed(1) + 'k' : roi.estRevenue.toLocaleString()}`, '#16a34a')}
    </div>
    <p style="margin-top:6px;font-size:10px;color:#9ca3af">Modeled scenario, not measured traffic, leads or revenue. Assumptions and search volumes must be available for the report period.</p>
  </div>` : ''}

  <!-- Recommendations -->
  <div style="padding:40px 40px 20px">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${brandColor};margin-bottom:16px;letter-spacing:-0.01em">Recommendations</h2>
    <div style="background:#f8ecdf;border:1px solid #f2c7ad;border-radius:8px;padding:20px">
      <ul style="padding-left:18px">
        ${recommendationItems}
      </ul>
    </div>
  </div>

  <!-- Rankings -->
  <div style="padding:40px 40px 32px">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${brandColor};margin-bottom:16px;letter-spacing:-0.01em">Ranking Observations</h2>
    <div style="border:1px solid #d8ded5;border-radius:8px;overflow:hidden">
      <div style="padding:14px 16px;background:#eaf0e9;border-bottom:1px solid #d8ded5;display:flex;gap:32px">
        <span style="font-size:13px;color:#374151"><strong style="color:${brandColor}">${rankings.keywordsInTop3}</strong> in Top 3</span>
        <span style="font-size:13px;color:#374151"><strong style="color:${brandColor}">${rankings.keywordsInTop10}</strong> in Top 10</span>
        <span style="font-size:13px;color:#374151">Avg. ranked position: <strong style="color:${brandColor}">${rankings.avgRank ?? 'N/A'}</strong></span>
      </div>
      ${rankings.topKeywords.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Location / area / engine</th>
            <th class="center">Rank</th>
            <th class="center">Prev.</th>
            <th class="center">Change</th>
          </tr>
        </thead>
        <tbody>${topKeywordsRows}</tbody>
      </table>` : `<p style="padding:20px;font-size:13px;color:#6b7280">No ranking data available for this period.</p>`}
    </div>
  </div>

  <!-- Reviews -->
  <div style="padding:40px 40px 32px">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${brandColor};margin-bottom:16px;letter-spacing:-0.01em">Reviews</h2>
    <div style="border:1px solid #d8ded5;border-radius:8px;overflow:hidden">
      <div style="padding:14px 16px;background:#eaf0e9;border-bottom:1px solid #d8ded5;display:flex;gap:32px;flex-wrap:wrap">
        <span style="font-size:13px;color:#374151">Stored reviews through month end: <strong style="color:${brandColor}">${reviews.total}</strong></span>
        <span style="font-size:13px;color:#374151">Dated this month: <strong style="color:${brandColor}">${reviews.newThisMonth}</strong></span>
        <span style="font-size:13px;color:#374151">Avg. Rating: <strong style="color:#f59e0b">${reviews.avgRating != null ? reviews.avgRating.toFixed(1) + ' ★' : 'N/A'}</strong></span>
        ${(sentiment.positive + sentiment.neutral + sentiment.negative) > 0 ? `
        <span style="font-size:13px;color:#374151">Sentiment: <strong style="color:#16a34a">${sentiment.positive}↑</strong> <strong style="color:#6b7280">${sentiment.neutral}→</strong> <strong style="color:#dc2626">${sentiment.negative}↓</strong></span>` : ''}
      </div>
      ${reviews.byPlatform.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th class="center">Reviews</th>
            <th class="center">Avg. Rating</th>
          </tr>
        </thead>
        <tbody>${platformRows}</tbody>
      </table>` : `<p style="padding:20px;font-size:13px;color:#6b7280">No review data available for this period.</p>`}
    </div>
  </div>

  <!-- Competitors -->
  ${competitors.length > 0 ? `
  <div style="padding:40px 40px 32px">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${brandColor};margin-bottom:16px;letter-spacing:-0.01em">Competitor Observations</h2>
    <div style="border:1px solid #d8ded5;border-radius:8px;overflow:hidden">
      <table>
        <thead>
          <tr>
            <th>Business</th>
            <th class="center">Google Rating</th>
            <th class="center">Total Reviews</th>
            <th>Website</th>
          </tr>
        </thead>
        <tbody>
          ${competitors.map((c, i) => `
            <tr style="background:${i % 2 === 0 ? '#fffefa' : '#f8f6f0'}">
              <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;font-weight:600;color:#20362f">${escHtml(c.name)}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center;color:#f59e0b">${c.googleRating != null ? `★ ${c.googleRating.toFixed(1)}` : '—'}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;text-align:center;color:#20362f">${c.googleReviewCount != null ? c.googleReviewCount.toLocaleString() : '—'}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #d8ded5;font-size:13px;color:#57665e">${c.website ? `<a href="${escHtml(c.website)}" style="color:${brandColor}">${escHtml(c.website)}</a>` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}


</div>
</body>
</html>`;
}

// ─── HTML helpers ────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statBox(label: string, value: string, color: string): string {
  return `<div style="background:#eaf0e9;border:1px solid #d8ded5;border-radius:8px;padding:10px 14px;text-align:center">
    <div style="font-size:20px;font-weight:700;color:${color};margin-bottom:3px">${escHtml(value)}</div>
    <div style="font-size:11px;color:#6b7280;font-weight:500">${escHtml(label)}</div>
  </div>`;
}

function citationStatPill(label: string, value: number, color: string): string {
  return `<div style="display:flex;align-items:center;gap:8px">
    <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
    <span style="font-size:13px;color:#374151">${escHtml(label)}: <strong style="color:${color}">${value}</strong></span>
  </div>`;
}

function citationScoreColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#f59e0b';
  return '#dc2626';
}

// ─── generatePdf ─────────────────────────────────────────────────────────────────

export async function generatePdf(html: string, outputPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
  } finally {
    await browser.close();
  }
}

// ─── generateAndSendReport ────────────────────────────────────────────────────────

export async function generateAndSendReport(
  clientId: string,
  month: number,
  year: number,
): Promise<string> {
  // 1. Upsert report row with status='generating'
  const existing = await db('reports')
    .where({ client_id: clientId, period_month: month, period_year: year })
    .first() as { id: string } | undefined;

  let reportId: string;

  if (existing) {
    await db('reports')
      .where({ id: existing.id })
      .update({ status: 'generating', updated_at: db.fn.now() });
    reportId = existing.id;
  } else {
    const inserted = await db('reports')
      .insert({
        client_id: clientId,
        period_month: month,
        period_year: year,
        status: 'generating',
      })
      .returning('id') as Array<{ id: string }>;
    reportId = inserted[0].id;
  }

  try {
    // 2. Gather data
    logger.info('Gathering report data', { clientId, month, year });
    const data = await gatherReportData(clientId, month, year);

    // 3. Render HTML
    const html = renderReportHtml(data);

    // 4. Build output path
    const monthStr = String(month).padStart(2, '0');
    const outputPath = `${config.reports.dir}/${clientId}/${year}-${monthStr}.pdf`;

    // 5. Generate PDF
    logger.info('Generating PDF', { outputPath });
    await generatePdf(html, outputPath);

    // 6. Update: status='generated'
    await db('reports').where({ id: reportId }).update({
      status: 'generated',
      file_path: outputPath,
      generated_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // 7. Send email
    logger.info('Sending report email', { to: data.client.email });
    await sendReportEmail(
      data.client.email,
      data.client.businessName,
      data.period.label,
      outputPath,
    );

    // 8. Update: status='sent'
    await db('reports').where({ id: reportId }).update({
      status: 'sent',
      sent_at: db.fn.now(),
      email_recipient: data.client.email,
      updated_at: db.fn.now(),
    });

    logger.info('Report generated and sent', { reportId, clientId, month, year });
  } catch (error) {
    // Mark as failed so we don't leave it stuck in 'generating'
    await db('reports').where({ id: reportId }).update({
      status: 'failed',
      updated_at: db.fn.now(),
    });
    throw error;
  }

  return reportId;
}
