import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { findBusiness, PlaceResult } from '../services/places.service';
import { checkOnPageSeo } from '../services/onpage.service';
import { sendAuditLeadEmail } from '../services/email.service';

export const scanSchema = z.object({
  businessName: z.string().min(1).max(255),
  city: z.string().min(1).max(255),
  keyword: z.string().max(255).optional(),
  source: z.string().max(100).optional(),
});

export const captureSchema = z.object({
  scanId: z.string().uuid(),
  email: z.string().email(),
});

// ─── Scoring helpers ──────────────────────────────────────────────────────────

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

function toGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

interface CategoryScore {
  grade: Grade;
  score: number;
  label: string;
  details: string[];
  locked: boolean;
}

function scoreGoogleProfile(place: PlaceResult): CategoryScore {
  let score = 0;
  const details: string[] = [];

  if (place.websiteUrl) { score += 20; details.push('Website linked'); }
  else details.push('No website on profile');

  if (place.photoCount >= 5) { score += 20; details.push(`${place.photoCount} photos`); }
  else if (place.photoCount > 0) { score += 10; details.push(`Only ${place.photoCount} photo(s) — add more`); }
  else details.push('No photos — add at least 5');

  if (place.hasHours) { score += 20; details.push('Business hours listed'); }
  else details.push('Hours not listed');

  const reviews = place.userRatingsTotal ?? 0;
  if (reviews >= 50) { score += 20; details.push(`${reviews} reviews`); }
  else if (reviews >= 10) { score += 10; details.push(`${reviews} reviews — aim for 50+`); }
  else details.push(`${reviews} reviews — critical to build`);

  if (place.businessStatus === 'OPERATIONAL') { score += 20; details.push('Business verified on Google'); }
  else details.push('Business status not verified');

  return { grade: toGrade(score), score, label: 'Google Business Profile', details, locked: false };
}

function scoreReviews(place: PlaceResult): CategoryScore {
  const rating = place.rating ?? 0;
  const count = place.userRatingsTotal ?? 0;
  let score = 0;
  const details: string[] = [];

  // Rating (60 pts)
  if (rating >= 4.7) { score += 60; details.push(`${rating}★ excellent rating`); }
  else if (rating >= 4.3) { score += 50; details.push(`${rating}★ good rating`); }
  else if (rating >= 3.8) { score += 35; details.push(`${rating}★ average — needs work`); }
  else if (rating >= 3.0) { score += 20; details.push(`${rating}★ below average`); }
  else if (rating > 0) { details.push(`${rating}★ — urgent attention needed`); }
  else details.push('No rating data found');

  // Volume (40 pts)
  if (count >= 100) { score += 40; details.push(`${count} total reviews`); }
  else if (count >= 50) { score += 30; details.push(`${count} reviews — building well`); }
  else if (count >= 20) { score += 20; details.push(`${count} reviews — aim for 50+`); }
  else if (count >= 5) { score += 10; details.push(`${count} reviews — needs more`); }
  else details.push(`${count} reviews — priority: get first reviews`);

  return { grade: toGrade(score), score, label: 'Reviews', details, locked: false };
}

function stubCategory(label: string): CategoryScore {
  return {
    grade: 'F',
    score: 0,
    label,
    details: ['Connect SuperLocalSEO to get your full score'],
    locked: true,
  };
}

function buildAuditData(place: PlaceResult | null, onPage: { score: number; details: string[] } | null, keyword?: string) {
  const onPageCategory: CategoryScore | null = onPage
    ? { grade: toGrade(onPage.score), score: onPage.score, label: 'On-Page SEO', details: onPage.details, locked: false }
    : null;

  const categories: CategoryScore[] = place
    ? [
        scoreGoogleProfile(place),
        scoreReviews(place),
        ...(onPageCategory ? [onPageCategory] : []),
        stubCategory('Keyword Rankings'),
        stubCategory('Citations & Directories'),
        stubCategory('Competitor Benchmark'),
      ]
    : [
        stubCategory('Google Business Profile'),
        stubCategory('Reviews'),
        stubCategory('Keyword Rankings'),
        stubCategory('Citations & Directories'),
        stubCategory('Competitor Benchmark'),
      ];

  const unlockedScores = categories.filter((c) => !c.locked).map((c) => c.score);
  const overallScore = unlockedScores.length
    ? Math.round(unlockedScores.reduce((a, b) => a + b, 0) / unlockedScores.length)
    : 0;

  return {
    businessName: place?.name ?? null,
    formattedAddress: place?.formattedAddress ?? null,
    placeId: place?.placeId ?? null,
    keyword: keyword ?? null,
    overallGrade: toGrade(overallScore),
    overallScore,
    categories,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function scan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { businessName, city, keyword, source } = scanSchema.parse(req.body);

    const place = await findBusiness(businessName, city);

    // Run on-page check on the website returned by Places — in parallel with DB insert.
    let onPage: { score: number; details: string[] } | null = null;
    if (place?.websiteUrl) {
      try {
        onPage = await checkOnPageSeo(place.websiteUrl);
      } catch {
        // non-blocking
      }
    }

    const auditData = buildAuditData(place, onPage, keyword);

    const [lead] = await db('audit_leads').insert({
      business_name: businessName,
      city,
      keyword: keyword ?? null,
      google_place_id: place?.placeId ?? null,
      audit_data: JSON.stringify(auditData),
      source: source ?? null,
    }).returning('id');

    ok(res, { scanId: lead.id, audit: auditData });
  } catch (e) {
    next(e);
  }
}

export async function capture(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { scanId, email } = captureSchema.parse(req.body);

    const lead = await db('audit_leads').where({ id: scanId }).first();
    if (!lead) {
      err(res, 'Scan not found', 404, 'NOT_FOUND');
      return;
    }

    await db('audit_leads').where({ id: scanId }).update({ email, updated_at: new Date() });

    const auditData = lead.audit_data as ReturnType<typeof buildAuditData>;

    // Send email before unlocking so it reflects the locked/free breakdown the user saw
    void sendAuditLeadEmail(email, lead.business_name as string, auditData);

    // Unlock all locked categories in audit_data
    auditData.categories = auditData.categories.map((c) => ({
      ...c,
      locked: false,
      details: c.locked
        ? ['Sign up to start tracking this — we monitor daily']
        : c.details,
    }));

    ok(res, { audit: auditData });
  } catch (e) {
    next(e);
  }
}
