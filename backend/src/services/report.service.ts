import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { db } from '../db/connection';
import { config } from '../config';
import { logger } from '../utils/logger';
import { sendReportEmail } from './email.service';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WhiteLabel {
  companyName?: string;
  logoUrl?: string;
  color?: string;
}

export interface ReportData {
  client: { businessName: string; email: string; whiteLabel?: WhiteLabel };
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
    byPlatform: Array<{ platform: string; count: number; avgRating: number }>;
  };
  citations: {
    score: number;
    listed: number;
    total: number;
    napAccurate: number;
  };
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
  auditScore: number | null;
  roi: { configured: boolean; estClicks: number; estLeads: number; estRevenue: number } | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function periodDates(month: number, year: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
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
      'users.email',
    )
    .first() as {
      business_name: string;
      email: string;
      subscription_tier: number;
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
  // Latest snapshot in the period per keyword+location
  const currentRankRows = (await db('ranking_snapshots')
    .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
    .join('locations', 'ranking_snapshots.location_id', 'locations.id')
    .where('locations.client_id', clientId)
    .where('ranking_snapshots.pulled_at', '>=', periodStart)
    .where('ranking_snapshots.pulled_at', '<=', periodEnd)
    .whereNotNull('ranking_snapshots.rank')
    .select(
      db.raw(`DISTINCT ON (ranking_snapshots.keyword_id, ranking_snapshots.location_id)
        ranking_snapshots.keyword_id,
        ranking_snapshots.location_id,
        keywords.keyword,
        locations.name as location_name,
        ranking_snapshots.rank`),
    )
    .orderByRaw('ranking_snapshots.keyword_id, ranking_snapshots.location_id, ranking_snapshots.pulled_at DESC')) as Array<{
    keyword_id: string;
    location_id: string;
    keyword: string;
    location_name: string;
    rank: number | null;
  }>;

  // Latest snapshot in the prior period per keyword+location
  const priorRankRows = (await db('ranking_snapshots')
    .join('locations', 'ranking_snapshots.location_id', 'locations.id')
    .where('locations.client_id', clientId)
    .where('ranking_snapshots.pulled_at', '>=', priorStart)
    .where('ranking_snapshots.pulled_at', '<=', priorEnd)
    .whereNotNull('ranking_snapshots.rank')
    .select(
      db.raw(`DISTINCT ON (ranking_snapshots.keyword_id, ranking_snapshots.location_id)
        ranking_snapshots.keyword_id,
        ranking_snapshots.location_id,
        ranking_snapshots.rank as prev_rank`),
    )
    .orderByRaw('ranking_snapshots.keyword_id, ranking_snapshots.location_id, ranking_snapshots.pulled_at DESC')) as Array<{
    keyword_id: string;
    location_id: string;
    prev_rank: number | null;
  }>;

  const priorRankMap = new Map(
    priorRankRows.map((r) => [`${r.keyword_id}:${r.location_id}`, r.prev_rank]),
  );

  const allKeywords = currentRankRows.map((r) => {
    const prevRank = priorRankMap.get(`${r.keyword_id}:${r.location_id}`) ?? null;
    const delta =
      r.rank != null && prevRank != null ? prevRank - r.rank : null;
    return {
      keyword: r.keyword,
      location: r.location_name,
      rank: r.rank,
      prevRank,
      delta,
    };
  });

  const rankedKeywords = allKeywords.filter((k) => k.rank != null);
  const avgRank =
    rankedKeywords.length > 0
      ? Math.round(
          rankedKeywords.reduce((sum, k) => sum + (k.rank as number), 0) /
            rankedKeywords.length,
        )
      : null;
  const keywordsInTop3 = rankedKeywords.filter((k) => (k.rank as number) <= 3).length;
  const keywordsInTop10 = rankedKeywords.filter((k) => (k.rank as number) <= 10).length;

  const topKeywords = [...allKeywords]
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return 0;
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    })
    .slice(0, 10);

  // ── Reviews ──────────────────────────────────────────────────────────────────
  const totalReviewRows = (await db('reviews')
    .where('client_id', clientId)
    .count('id as count')
    .avg('rating as avg_rating')
    .first()) as { count: string; avg_rating: string | null };

  const newReviewRows = (await db('reviews')
    .where('client_id', clientId)
    .where('review_date', '>=', periodStart)
    .where('review_date', '<=', periodEnd)
    .count('id as count')
    .first()) as { count: string };

  const byPlatformRows = (await db('reviews')
    .where('client_id', clientId)
    .select('platform')
    .count('id as count')
    .avg('rating as avg_rating')
    .groupBy('platform')) as Array<{
    platform: string;
    count: string;
    avg_rating: string | null;
  }>;

  // ── Citations ─────────────────────────────────────────────────────────────────
  // Latest snapshot per directory per location (most recent before period end)
  const locationIds = locationRows.map((l) => l.id);

  let citationRows: Array<{
    directory: string;
    listed: boolean;
    nap_match: boolean;
  }> = [];

  if (locationIds.length > 0) {
    citationRows = (await db('citation_snapshots')
      .whereIn('location_id', locationIds)
      .where('pulled_at', '<=', periodEnd)
      .select(
        db.raw(`DISTINCT ON (location_id, directory)
          directory,
          listed,
          nap_match`),
      )
      .orderByRaw('location_id, directory, pulled_at DESC')) as Array<{
      directory: string;
      listed: boolean;
      nap_match: boolean;
    }>;
  }

  const citationTotal = citationRows.length;
  const citationListed = citationRows.filter((c) => c.listed).length;
  const citationNapAccurate = citationRows.filter((c) => c.listed && c.nap_match).length;
  const citationScore =
    citationTotal > 0 ? Math.round((citationListed / citationTotal) * 100) : 0;

  const competitorRows = await db('competitors')
    .where({ client_id: clientId })
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
    .count('id as count')
    .avg('rating as avg_rating')
    .first() as { count: string; avg_rating: string | null };

  // ── Keyword gap breakdown ─────────────────────────────────────────────────────
  const gapRows = locationIds.length > 0
    ? await db.raw<{ rows: Array<{ keyword: string; location_name: string; rank: number | null }> }>(
        `SELECT DISTINCT ON (rs.keyword_id, rs.location_id)
           k.keyword, l.name as location_name, rs.rank
         FROM ranking_snapshots rs
         JOIN keywords k ON rs.keyword_id = k.id
         JOIN locations l ON rs.location_id = l.id
         WHERE l.client_id = ?
           AND rs.rank IS NOT NULL
         ORDER BY rs.keyword_id, rs.location_id, rs.pulled_at DESC`,
        [clientId],
      ).then((r) => r.rows)
    : [];

  const gapWithStatus = gapRows.map((r) => ({
    keyword: r.keyword,
    location: r.location_name,
    rank: r.rank,
    status: r.rank == null ? 'absent' : r.rank <= 3 ? 'winning' : r.rank <= 10 ? 'competing' : 'vulnerable',
  }));

  const gapCounts = { winning: 0, competing: 0, vulnerable: 0, absent: 0 };
  for (const k of gapWithStatus) gapCounts[k.status as keyof typeof gapCounts]++;
  const atRisk = gapWithStatus.filter((k) => k.status === 'vulnerable' || k.status === 'absent').slice(0, 15);

  // ── Review sentiment ─────────────────────────────────────────────────────────
  const sentimentRows = await db('reviews')
    .where('client_id', clientId)
    .whereNotNull('sentiment')
    .select('sentiment')
    .count('id as count')
    .groupBy('sentiment') as Array<{ sentiment: string; count: string }>;

  const sentimentMap: Record<string, number> = {};
  for (const s of sentimentRows) sentimentMap[s.sentiment] = parseInt(s.count, 10);

  // ── Visibility score ─────────────────────────────────────────────────────────
  const metricsRows = await db('metrics_daily')
    .where('client_id', clientId)
    .where('date', '>=', db.raw(`(CURRENT_DATE - INTERVAL '60 days')`))
    .orderBy('date', 'asc')
    .select('date', 'avg_ranking', 'citation_completeness', 'avg_rating') as Array<{
      date: string; avg_ranking: string | null; citation_completeness: string | null; avg_rating: string | null;
    }>;

  let visibilityCurrent: number | null = null;
  let visibilityDelta: number | null = null;
  if (metricsRows.length > 0) {
    const toScore = (r: typeof metricsRows[0]) => {
      const rankScore = r.avg_ranking ? Math.max(0, 100 - (parseFloat(r.avg_ranking) - 1) * 2) : 0;
      const citScore = r.citation_completeness ? parseFloat(r.citation_completeness) : 0;
      const reviewScore = r.avg_rating ? (parseFloat(r.avg_rating) / 5) * 100 : 0;
      return Math.round(rankScore * 0.5 + citScore * 0.3 + reviewScore * 0.2);
    };
    visibilityCurrent = toScore(metricsRows[metricsRows.length - 1]);
    const prior = toScore(metricsRows[0]);
    visibilityDelta = metricsRows.length > 1 ? visibilityCurrent - prior : null;
  }

  // ── Audit score ──────────────────────────────────────────────────────────────
  const auditRow = locationIds.length > 0
    ? await db('location_audits')
        .whereIn('location_id', locationIds)
        .where('status', 'complete')
        .orderBy('updated_at', 'desc')
        .select('composite_score')
        .first() as { composite_score: string | null } | undefined
    : undefined;
  const auditScore = auditRow?.composite_score != null ? parseFloat(auditRow.composite_score) : null;

  // ── ROI ──────────────────────────────────────────────────────────────────────
  const roiClient = await db('clients').where({ id: clientId })
    .select('roi_config').first() as { roi_config: { avgCustomerValue?: number; conversionRate?: number } | null } | undefined;

  let roiData: ReportData['roi'] = null;
  const roiCfg = roiClient?.roi_config ?? {};
  const avgVal = roiCfg.avgCustomerValue ?? 0;
  if (avgVal > 0) {
    const convRate = (roiCfg.conversionRate ?? 2.5) / 100;
    const CTR: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.04, 7: 0.03, 8: 0.02, 9: 0.02, 10: 0.01 };
    const VOLUMES: Record<number, number> = { 1: 100, 2: 200, 3: 300, 4: 500, 5: 1000 };
    let totalClicks = 0, totalLeads = 0, totalRevenue = 0;
    for (const kw of rankedKeywords) {
      if (!kw.rank || kw.rank > 10) continue;
      const vol = VOLUMES[Math.min(kw.rank, 5)] ?? 100;
      const ctr = CTR[kw.rank] ?? 0.01;
      const clicks = Math.round(vol * ctr);
      const leads = Math.round(clicks * convRate * 10) / 10;
      totalClicks += clicks;
      totalLeads += leads;
      totalRevenue += Math.round(leads * avgVal);
    }
    roiData = { configured: true, estClicks: totalClicks, estLeads: Math.round(totalLeads * 10) / 10, estRevenue: totalRevenue };
  }

  const whiteLabel: WhiteLabel | undefined =
    client.subscription_tier >= 3 &&
    (client.white_label_company_name || client.white_label_logo_url || client.white_label_color)
      ? {
          companyName: client.white_label_company_name ?? undefined,
          logoUrl: client.white_label_logo_url ?? undefined,
          color: client.white_label_color ?? undefined,
        }
      : undefined;

  return {
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
        avgRating: r.avg_rating != null ? parseFloat(r.avg_rating) : 0,
      })),
    },
    citations: {
      score: citationScore,
      listed: citationListed,
      total: citationTotal,
      napAccurate: citationNapAccurate,
    },
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
    auditScore,
    roi: roiData,
  };
}

// ─── renderReportHtml ───────────────────────────────────────────────────────────

export function renderReportHtml(data: ReportData): string {
  const { client, period, rankings, reviews, citations, competitors, clientStats, gap, sentiment, visibility, auditScore, roi } = data;
  const brandColor = client.whiteLabel?.color ?? '#0052CC';
  const brandName = client.whiteLabel?.companyName ?? 'SuperLocalSEO';
  const brandLogoUrl = client.whiteLabel?.logoUrl ?? null;

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
      `${droppedKeywords} keyword${droppedKeywords > 1 ? 's' : ''} dropped in rankings this month — consider refreshing content and improving internal linking for those terms.`,
    );
  }

  if (citations.score < 80) {
    const missing = citations.total - citations.listed;
    recommendations.push(
      `Citation score is ${citations.score}% — ${missing} director${missing === 1 ? 'y' : 'ies'} missing. Submit your business to unclaimed directories to improve local visibility.`,
    );
  }

  if (citations.napAccurate < citations.listed) {
    const napIssues = citations.listed - citations.napAccurate;
    recommendations.push(
      `${napIssues} citation${napIssues > 1 ? 's' : ''} have incorrect NAP (name, address, phone) data — update these listings to improve trust signals.`,
    );
  }

  if (reviews.avgRating != null && reviews.avgRating < 4.0) {
    recommendations.push(
      `Average review rating is ${reviews.avgRating.toFixed(1)} — actively respond to negative reviews and encourage satisfied customers to leave reviews.`,
    );
  }

  if (reviews.newThisMonth === 0) {
    recommendations.push(
      'No new reviews were collected this month — implement a review request campaign via email or SMS to boost review volume.',
    );
  }

  if (sentiment.negative > sentiment.positive && sentiment.negative > 2) {
    recommendations.push(
      `${sentiment.negative} negative reviews detected — respond promptly and professionally to each one to demonstrate your commitment to customer satisfaction.`,
    );
  }

  if (gap.absent > 3) {
    recommendations.push(
      `${gap.absent} keywords are not ranking at all — consider creating dedicated landing pages or location-specific content targeting these terms.`,
    );
  }

  if (gap.vulnerable > 5) {
    recommendations.push(
      `${gap.vulnerable} keywords are ranking outside the top 10 — strengthen page relevance, build local backlinks, and ensure consistent NAP data to push these into the top 10.`,
    );
  }

  if (auditScore != null && auditScore < 60) {
    recommendations.push(
      `Local SEO audit score is ${auditScore.toFixed(0)}/100 — review your Google Business Profile completeness, local citations, and on-page SEO signals.`,
    );
  }

  if (competitors.length > 0 && clientStats.avgRating != null) {
    const leadingCompetitor = competitors.find((c) => c.googleRating != null && c.googleRating > (clientStats.avgRating ?? 0));
    if (leadingCompetitor) {
      recommendations.push(
        `${escHtml(leadingCompetitor.name)} has a higher Google rating (${leadingCompetitor.googleRating?.toFixed(1)}) than yours (${clientStats.avgRating.toFixed(1)}) — prioritize review generation to close this gap.`,
      );
    }
    const moreReviews = competitors.find((c) => c.googleReviewCount != null && c.googleReviewCount > clientStats.reviewCount * 1.5);
    if (moreReviews) {
      recommendations.push(
        `${escHtml(moreReviews.name)} has ${moreReviews.googleReviewCount?.toLocaleString()} reviews compared to your ${clientStats.reviewCount.toLocaleString()} — an active review request campaign could help close this volume gap.`,
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push(
      'Great work! Your SEO metrics are on track. Continue producing quality content and maintaining consistent citations across all directories.',
    );
  }

  const starRating = (rating: number | null) => {
    if (rating == null) return 'N/A';
    const full = Math.round(rating);
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
        <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827">${escHtml(k.keyword)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${escHtml(k.location)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${rankCell(k.rank)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#6b7280">${rankCell(k.prevRank)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${deltaHtml(k.delta)}</td>
        </tr>`,
    )
    .join('');

  const platformRows = reviews.byPlatform
    .map(
      (p) => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827">${escHtml(p.platform)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#111827">${p.count}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#f59e0b">${starRating(p.avgRating)}</td>
        </tr>`,
    )
    .join('');

  const recommendationItems = recommendations
    .map((r) => `<li style="margin-bottom:8px;font-size:13px;color:#374151;line-height:1.6">${escHtml(r)}</li>`)
    .join('');

  const citationBarWidth = Math.min(100, Math.max(0, citations.score));
  const citationBarColor =
    citations.score >= 80 ? '#16a34a' : citations.score >= 60 ? '#f59e0b' : '#dc2626';

  const gapSection = (gap.winning + gap.competing + gap.vulnerable + gap.absent) > 0 ? `
  <div style="padding:24px 40px 32px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">Keyword Position Breakdown</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:${gap.atRisk.length > 0 ? '20px' : '0'}">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#16a34a">${gap.winning}</div>
        <div style="font-size:11px;font-weight:600;color:#15803d;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">Winning (1–3)</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#2563eb">${gap.competing}</div>
        <div style="font-size:11px;font-weight:600;color:#1d4ed8;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">Competing (4–10)</div>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#d97706">${gap.vulnerable}</div>
        <div style="font-size:11px;font-weight:600;color:#b45309;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">Vulnerable (11+)</div>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#dc2626">${gap.absent}</div>
        <div style="font-size:11px;font-weight:600;color:#b91c1c;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">Not Ranking</div>
      </div>
    </div>
    ${gap.atRisk.length > 0 ? `
    <p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px">Keywords needing attention:</p>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <table>
        <thead><tr><th>Keyword</th><th>Location</th><th class="center">Current Rank</th><th class="center">Status</th></tr></thead>
        <tbody>
          ${gap.atRisk.map((k, i) => `
            <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
              <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827">${escHtml(k.keyword)}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${escHtml(k.location)}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#111827">${k.rank ?? '—'}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;${k.status === 'absent' ? 'background:#fef2f2;color:#dc2626' : 'background:#fffbeb;color:#d97706'}">
                  ${k.status === 'absent' ? 'Not ranking' : 'Vulnerable'}
                </span>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(client.businessName)} SEO Report — ${escHtml(period.label)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #ffffff; color: #111827; }
  .page { max-width: 900px; margin: 0 auto; background: #ffffff; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f9fafb; padding: 10px 14px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; text-align: left; border-bottom: 2px solid #e5e7eb; }
  th.center { text-align: center; }
  @media print {
    .page { max-width: 100%; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="background:${brandColor};color:#ffffff;padding:36px 40px 28px">
    ${brandLogoUrl
      ? `<img src="${brandLogoUrl}" alt="${escHtml(brandName)}" style="height:32px;margin-bottom:12px;object-fit:contain;display:block" />`
      : `<div style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;margin-bottom:4px">${escHtml(brandName)}</div>`}
    <h1 style="font-size:26px;font-weight:700;margin-bottom:6px">${escHtml(client.businessName)}</h1>
    <div style="font-size:15px;opacity:0.85">Monthly SEO Performance Report &mdash; ${escHtml(period.label)}</div>
  </div>

  <!-- Executive Summary -->
  <div style="padding:32px 40px 24px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:20px;text-transform:uppercase;letter-spacing:0.05em">Executive Summary</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px">
      ${statBox('Avg. Rank', rankings.avgRank != null ? String(rankings.avgRank) : 'N/A', brandColor)}
      ${statBox('Keywords in Top 10', String(rankings.keywordsInTop10), brandColor)}
      ${statBox('Keywords in Top 3', String(rankings.keywordsInTop3), brandColor)}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      ${statBox('New Reviews', String(reviews.newThisMonth), brandColor)}
      ${statBox('Citation Score', `${citations.score}%`, citationScoreColor(citations.score))}
      ${visibility.current != null
        ? statBox('Visibility Score', `${visibility.current}/100${visibility.delta != null ? (visibility.delta >= 0 ? ` ▲${visibility.delta}` : ` ▼${Math.abs(visibility.delta)}`) : ''}`, visibility.delta != null && visibility.delta >= 0 ? '#16a34a' : brandColor)
        : auditScore != null
        ? statBox('SEO Audit Score', `${auditScore.toFixed(0)}/100`, auditScore >= 70 ? '#16a34a' : auditScore >= 50 ? '#f59e0b' : '#dc2626')
        : statBox('Total Reviews', String(reviews.total), brandColor)}
    </div>
  </div>

  ${gapSection}

  <!-- Citations -->
  <div style="padding:0 40px 32px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">Citation Health</h2>
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:14px;font-weight:600;color:#111827">Citation Score</span>
        <span style="font-size:20px;font-weight:700;color:${citationBarColor}">${citations.score}%</span>
      </div>
      <div style="background:#e5e7eb;border-radius:999px;height:10px;overflow:hidden;margin-bottom:20px">
        <div style="background:${citationBarColor};width:${citationBarWidth}%;height:100%;border-radius:999px;transition:width 0.3s"></div>
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        ${citationStatPill('Listed', citations.listed, '#16a34a')}
        ${citationStatPill('Not Listed', citations.total - citations.listed, '#dc2626')}
        ${citationStatPill('NAP Accurate', citations.napAccurate, brandColor)}
        ${citationStatPill('Total Directories', citations.total, '#6b7280')}
      </div>
    </div>
  </div>

  <!-- ROI Estimates -->
  ${roi ? `
  <div style="padding:0 40px 32px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">ROI &amp; Revenue Attribution</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      ${statBox('Est. Monthly Clicks', roi.estClicks.toLocaleString(), brandColor)}
      ${statBox('Est. Monthly Leads', roi.estLeads.toLocaleString(), brandColor)}
      ${statBox('Est. Monthly Revenue', `$${roi.estRevenue >= 1000 ? (roi.estRevenue / 1000).toFixed(1) + 'k' : roi.estRevenue.toLocaleString()}`, '#16a34a')}
    </div>
    <p style="margin-top:10px;font-size:11px;color:#9ca3af">Estimates based on your configured average customer value and keyword rankings. Actual results may vary.</p>
  </div>` : ''}

  <!-- Rankings -->
  <div style="page-break-before:always;padding:40px 40px 32px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">Keyword Rankings</h2>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="padding:14px 16px;background:#f0f4ff;border-bottom:1px solid #e5e7eb;display:flex;gap:32px">
        <span style="font-size:13px;color:#374151"><strong style="color:${brandColor}">${rankings.keywordsInTop3}</strong> in Top 3</span>
        <span style="font-size:13px;color:#374151"><strong style="color:${brandColor}">${rankings.keywordsInTop10}</strong> in Top 10</span>
        <span style="font-size:13px;color:#374151">Avg. Position: <strong style="color:${brandColor}">${rankings.avgRank ?? 'N/A'}</strong></span>
      </div>
      ${rankings.topKeywords.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Location</th>
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
  <div style="page-break-before:always;padding:40px 40px 32px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">Reviews</h2>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="padding:14px 16px;background:#f0f4ff;border-bottom:1px solid #e5e7eb;display:flex;gap:32px;flex-wrap:wrap">
        <span style="font-size:13px;color:#374151">Total: <strong style="color:${brandColor}">${reviews.total}</strong></span>
        <span style="font-size:13px;color:#374151">New this month: <strong style="color:${brandColor}">${reviews.newThisMonth}</strong></span>
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
  <div style="padding:0 40px 32px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">Competitor Benchmarking</h2>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
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
          <tr style="background:#f0f4ff">
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:${brandColor}">${escHtml(client.businessName)} <span style="font-size:10px;font-weight:600;background:${brandColor};color:#fff;padding:1px 6px;border-radius:999px;margin-left:4px">YOU</span></td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#f59e0b">${clientStats.avgRating != null ? `★ ${clientStats.avgRating.toFixed(1)}` : '—'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;font-weight:600;color:#111827">${clientStats.reviewCount.toLocaleString()}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">—</td>
          </tr>
          ${competitors.map((c, i) => `
            <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111827">${escHtml(c.name)}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#f59e0b">${c.googleRating != null ? `★ ${c.googleRating.toFixed(1)}` : '—'}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#111827">${c.googleReviewCount != null ? c.googleReviewCount.toLocaleString() : '—'}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${c.website ? `<a href="${escHtml(c.website)}" style="color:${brandColor}">${escHtml(c.website)}</a>` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}

  <!-- Recommendations (new page) -->
  <div style="page-break-before:always;padding:40px 40px 40px">
    <h2 style="font-size:16px;font-weight:700;color:${brandColor};margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em">Recommendations</h2>
    <div style="background:#f0f4ff;border:1px solid #dbeafe;border-radius:8px;padding:20px">
      <ul style="padding-left:18px">
        ${recommendationItems}
      </ul>
    </div>
  </div>


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
  return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;text-align:center">
    <div style="font-size:26px;font-weight:700;color:${color};margin-bottom:6px">${escHtml(value)}</div>
    <div style="font-size:12px;color:#6b7280;font-weight:500">${escHtml(label)}</div>
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
