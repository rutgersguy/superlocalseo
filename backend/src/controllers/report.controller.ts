import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { reportsQueue } from '../jobs/queue';
import { ok, notFound, err } from '../utils/response';

// ─── list ──────────────────────────────────────────────────────────────────────

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await db('reports')
      .where('client_id', req.clientId)
      .select(
        'id',
        'period_month as periodMonth',
        'period_year as periodYear',
        'status',
        'generated_at as generatedAt',
        'sent_at as sentAt',
        'email_recipient as emailRecipient',
      )
      .orderBy('period_year', 'desc')
      .orderBy('period_month', 'desc') as Array<{
      id: string;
      periodMonth: number;
      periodYear: number;
      status: string;
      generatedAt: string | null;
      sentAt: string | null;
      emailRecipient: string | null;
    }>;

    ok(res, rows);
  } catch (e) {
    next(e);
  }
}

// ─── download ─────────────────────────────────────────────────────────────────

export async function download(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const report = await db('reports')
      .where({ id })
      .first() as {
      id: string;
      client_id: string;
      file_path: string | null;
      status: string;
      period_month: number;
      period_year: number;
    } | undefined;

    if (!report) {
      notFound(res, 'Report not found');
      return;
    }

    if (report.client_id !== req.clientId) {
      notFound(res, 'Report not found');
      return;
    }

    if (!report.file_path) {
      err(res, 'Report file is not yet available', 422);
      return;
    }

    // Check file exists
    try {
      await fs.promises.access(report.file_path, fs.constants.R_OK);
    } catch {
      notFound(res, 'Report file not found on disk');
      return;
    }

    const monthStr = String(report.period_month).padStart(2, '0');
    const filename = `SEO-Report-${report.period_year}-${monthStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(report.file_path);
    stream.on('error', (streamErr) => {
      if (!res.headersSent) {
        next(streamErr);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
}

// ─── view (inline) ───────────────────────────────────────────────────────────

export async function view(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const report = await db('reports')
      .where({ id })
      .first() as {
      id: string;
      client_id: string;
      file_path: string | null;
      status: string;
      period_month: number;
      period_year: number;
    } | undefined;

    if (!report) {
      notFound(res, 'Report not found');
      return;
    }

    if (report.client_id !== req.clientId) {
      notFound(res, 'Report not found');
      return;
    }

    if (!report.file_path) {
      err(res, 'Report file is not yet available', 422);
      return;
    }

    // Check file exists
    try {
      await fs.promises.access(report.file_path, fs.constants.R_OK);
    } catch {
      notFound(res, 'Report file not found on disk');
      return;
    }

    const monthStr = String(report.period_month).padStart(2, '0');
    const filename = `SEO-Report-${report.period_year}-${monthStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    const stream = fs.createReadStream(report.file_path);
    stream.on('error', (streamErr) => {
      if (!res.headersSent) {
        next(streamErr);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

function sendCsv(res: Response, filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const lines = [headers.join(','), ...rows.map(csvRow)].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines); // BOM for Excel compatibility
}

// ─── export: rankings over time ────────────────────────────────────────────────

export async function exportRankings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await db('ranking_snapshots')
      .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
      .join('locations', 'ranking_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .select(
        'keywords.keyword',
        'locations.name as location',
        'ranking_snapshots.rank',
        'ranking_snapshots.url_ranked',
        'ranking_snapshots.search_engine',
        'ranking_snapshots.pulled_at',
      )
      .orderBy('ranking_snapshots.pulled_at', 'desc') as Array<{
        keyword: string;
        location: string;
        rank: number | null;
        url_ranked: string | null;
        search_engine: string;
        pulled_at: Date;
      }>;

    const headers = ['Date', 'Keyword', 'Location', 'Rank', 'Search Engine', 'Ranked URL'];
    const data = rows.map((r) => [
      new Date(r.pulled_at).toISOString().split('T')[0],
      r.keyword,
      r.location,
      r.rank,
      r.search_engine,
      r.url_ranked,
    ]);

    sendCsv(res, 'rankings-history.csv', headers, data);
  } catch (e) { next(e); }
}

// ─── export: keywords with latest rank ─────────────────────────────────────────

export async function exportKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await db('keywords')
      .join('locations', 'keywords.location_id', 'locations.id')
      .leftJoin(
        db('ranking_snapshots')
          .select('keyword_id', 'location_id', 'rank', 'url_ranked', 'pulled_at')
          .distinctOn(['keyword_id', 'location_id'])
          .orderBy([
            { column: 'keyword_id' },
            { column: 'location_id' },
            { column: 'pulled_at', order: 'desc' },
          ])
          .as('latest'),
        function () {
          this.on('latest.keyword_id', 'keywords.id').andOn('latest.location_id', 'keywords.location_id');
        },
      )
      .where('locations.client_id', req.clientId)
      .select(
        'keywords.keyword',
        'locations.name as location',
        'latest.rank',
        'latest.url_ranked',
        'latest.pulled_at as last_checked',
        'keywords.created_at',
      )
      .orderBy('locations.name')
      .orderBy('latest.rank') as Array<{
        keyword: string;
        location: string;
        rank: number | null;
        url_ranked: string | null;
        last_checked: Date | null;
        created_at: Date;
      }>;

    const headers = ['Keyword', 'Location', 'Current Rank', 'Ranked URL', 'Last Checked', 'Date Added'];
    const data = rows.map((r) => [
      r.keyword,
      r.location,
      r.rank,
      r.url_ranked,
      r.last_checked ? new Date(r.last_checked).toISOString().split('T')[0] : null,
      new Date(r.created_at).toISOString().split('T')[0],
    ]);

    sendCsv(res, 'keywords.csv', headers, data);
  } catch (e) { next(e); }
}

// ─── export: reviews ────────────────────────────────────────────────────────────

export async function exportReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await db('reviews')
      .leftJoin('locations', 'reviews.location_id', 'locations.id')
      .where('reviews.client_id', req.clientId)
      .select(
        'reviews.review_date',
        'reviews.platform',
        'locations.name as location',
        'reviews.author_name',
        'reviews.rating',
        'reviews.sentiment',
        'reviews.status',
        'reviews.body',
        'reviews.platform_url',
      )
      .orderBy('reviews.review_date', 'desc') as Array<{
        review_date: Date | null;
        platform: string;
        location: string | null;
        author_name: string | null;
        rating: number;
        sentiment: string | null;
        status: string;
        body: string | null;
        platform_url: string | null;
      }>;

    const headers = ['Date', 'Platform', 'Location', 'Author', 'Rating', 'Sentiment', 'Status', 'Review Text', 'URL'];
    const data = rows.map((r) => [
      r.review_date ? new Date(r.review_date).toISOString().split('T')[0] : null,
      r.platform,
      r.location,
      r.author_name,
      r.rating,
      r.sentiment,
      r.status,
      r.body,
      r.platform_url,
    ]);

    sendCsv(res, 'reviews.csv', headers, data);
  } catch (e) { next(e); }
}

// ─── export: citations ──────────────────────────────────────────────────────────

export async function exportCitations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await db('citation_snapshots')
      .join('locations', 'citation_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .distinctOn(['citation_snapshots.location_id', 'citation_snapshots.directory'])
      .orderBy([
        { column: 'citation_snapshots.location_id' },
        { column: 'citation_snapshots.directory' },
        { column: 'citation_snapshots.pulled_at', order: 'desc' },
      ])
      .select(
        'locations.name as location',
        'citation_snapshots.directory',
        'citation_snapshots.listed',
        'citation_snapshots.nap_match',
        'citation_snapshots.nap_name_match',
        'citation_snapshots.nap_address_match',
        'citation_snapshots.nap_phone_match',
        'citation_snapshots.listed_name',
        'citation_snapshots.listed_address',
        'citation_snapshots.listed_phone',
        'citation_snapshots.listing_url',
        'citation_snapshots.pulled_at',
      ) as Array<{
        location: string;
        directory: string;
        listed: boolean;
        nap_match: boolean;
        nap_name_match: boolean | null;
        nap_address_match: boolean | null;
        nap_phone_match: boolean | null;
        listed_name: string | null;
        listed_address: string | null;
        listed_phone: string | null;
        listing_url: string | null;
        pulled_at: Date;
      }>;

    const headers = [
      'Location', 'Directory', 'Listed', 'NAP Match',
      'Name Match', 'Address Match', 'Phone Match',
      'Listed Name', 'Listed Address', 'Listed Phone',
      'Listing URL', 'Last Checked',
    ];
    const data = rows.map((r) => [
      r.location,
      r.directory,
      r.listed ? 'Yes' : 'No',
      r.nap_match ? 'Yes' : 'No',
      r.nap_name_match == null ? '' : r.nap_name_match ? 'Yes' : 'No',
      r.nap_address_match == null ? '' : r.nap_address_match ? 'Yes' : 'No',
      r.nap_phone_match == null ? '' : r.nap_phone_match ? 'Yes' : 'No',
      r.listed_name,
      r.listed_address,
      r.listed_phone,
      r.listing_url,
      new Date(r.pulled_at).toISOString().split('T')[0],
    ]);

    sendCsv(res, 'citations.csv', headers, data);
  } catch (e) { next(e); }
}

// ─── generate ────────────────────────────────────────────────────────────────────

export async function generate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      clientId?: string;
      month?: number;
      year?: number;
    };

    const clientId = body.clientId ?? req.clientId;

    // Default to previous month
    const now = new Date();
    const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const month = body.month ?? defaultMonth;
    const year = body.year ?? defaultYear;

    if (month < 1 || month > 12) {
      err(res, 'month must be between 1 and 12', 400);
      return;
    }

    if (year < 2020 || year > now.getFullYear() + 1) {
      err(res, 'year is out of acceptable range', 400);
      return;
    }

    const job = await reportsQueue.add('generate-report', {
      clientId,
      month,
      year,
    });

    ok(res, { queued: true, jobId: job.id });
  } catch (e) {
    next(e);
  }
}
