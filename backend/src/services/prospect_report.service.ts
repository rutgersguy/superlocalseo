import places from '../data/us-places-2025.json';
import { config } from '../config';
import { db } from '../db/connection';
import { gridCoordinates, parseMapsResponse, summarizeGrid, ratingAction, MapPoint } from './prospect_measurements';
export const PROSPECT_SOURCE = 'verified-free-report-v1';
const fieldMask = 'id,displayName,formattedAddress,location,rating,userRatingCount,googleMapsUri,pureServiceAreaBusiness,addressComponents,types';
export async function googlePlace(path: string, body?: object, mask = fieldMask): Promise<any> {
  if (!config.googlePlacesApiKey) throw new Error('Business lookup unavailable');
  const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googlePlacesApiKey, 'X-Goog-FieldMask': mask },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Business lookup unavailable');
  return response.json();
}
export function country(p: any): string | undefined { return p.addressComponents?.find((c: any) => c.types?.includes('country'))?.shortText; }
export function publicPlace(p: any) {
  return { placeId: p.id, name: p.displayName?.text ?? '', address: p.formattedAddress ?? null,
    serviceAreaBusiness: p.pureServiceAreaBusiness === true,
    rating: typeof p.rating === 'number' && p.rating >= 0 && p.rating <= 5 ? p.rating : null,
    reviewCount: Number.isInteger(p.userRatingCount) && p.userRatingCount >= 0 ? p.userRatingCount : null };
}
export function findArea(id: string) { return places.find(p => p.id === id); }
export function searchAreas(query: string) {
  const terms = query.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  return places.filter(p => terms.every(t => p.name.toLowerCase().includes(t))).slice(0, 20);
}
export async function searchProspect(business: string, city: string) {
  const businesses = await googlePlace('places:searchText', { textQuery: `${business} ${city} USA`, maxResultCount: 5, includePureServiceAreaBusinesses: true }, fieldMask.split(',').map(s => `places.${s}`).join(','));
  // Google Places results are transient selection data; only the chosen place ID is retained.
  return { businesses: (businesses.places ?? []).filter((p: any) => country(p) === 'US' || p.pureServiceAreaBusiness).map(publicPlace), areas: searchAreas(city) };
}
async function dfs(path: string, task: object): Promise<any> {
  if (!config.dataforseo.login || !config.dataforseo.password) throw new Error('Maps provider unavailable');
  const response = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64')}` }, body: JSON.stringify([task]),
  });
  if (!response.ok) throw new Error('Maps provider unavailable');
  return response.json();
}
export function parseBusiness(body: any, placeId: string) {
  const task = body?.tasks?.[0]; const result = task?.result?.[0];
  if (body?.status_code !== 20000 || task?.status_code !== 20000 || !Array.isArray(result?.items)) throw new Error('Business observation unavailable');
  const matches = result.items.filter((i: any) => i.type === 'google_business_info' && i.place_id === placeId);
  if (matches.length !== 1 || typeof matches[0].title !== 'string' || !matches[0].title.trim()) throw new Error('Business identity unavailable');
  const p = matches[0];
  if (p.address_info?.country_code && p.address_info.country_code !== 'US') throw new Error('Select a United States business');
  const stamp = typeof result.datetime === 'string' ? Date.parse(result.datetime) : NaN;
  // Provider coordinates for service-area businesses can point into the ocean.
  // Neither these coordinates nor an invented street address belong in the report.
  return { placeId, name: p.title, address: typeof p.address === 'string' && p.address.trim() ? p.address : null,
    rating: typeof p.rating?.value === 'number' && p.rating.value >= 0 && p.rating.value <= 5 ? p.rating.value : null,
    reviewCount: Number.isInteger(p.rating?.votes_count) && p.rating.votes_count >= 0 ? p.rating.votes_count : null,
    collectedAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null };
}
export async function scanProspect(placeId: string, areaId: string, keyword: string, prior?: any, save: (progress: any) => Promise<void> = async () => {}) {
  const area = findArea(areaId);
  if (!area) throw new Error('Select a supported United States city');
  let progress = prior;
  if (!progress?.business) {
    const business = parseBusiness(await dfs('business_data/google/my_business_info/live', { keyword: `place_id:${placeId}`, location_code: 2840, language_code: 'en' }), placeId);
    progress = { business, profileCheckedAt: new Date().toISOString(), points: [] };
    await save(progress);
  }
  const center = { lat: area.lat, lng: area.lng, label: area.name, areaId };
  const coordinates = gridCoordinates(center.lat, center.lng);
  const points: MapPoint[] = progress.points;
  for (const coordinate of coordinates.slice(points.length)) {
    // Save an unknown observation before the paid call. If the process dies, a
    // retry continues with the next point instead of silently purchasing it twice.
    const index = points.length;
    points.push({ ...coordinate, status: 'unavailable', rank: null, checkedAt: new Date().toISOString(), collectedAt: null, resultCount: 0, items: [] });
    await save(progress);
    try {
      const body = await dfs('serp/google/maps/live/advanced', { keyword, location_coordinate: `${coordinate.lat},${coordinate.lng},14z`, language_code: 'en', device: 'desktop', depth: 20, search_this_area: true });
      points[index] = parseMapsResponse(body, placeId, coordinate, new Date().toISOString());
    } catch { /* Keep unknown; never turn a failed request into absence. */ }
    await save(progress);
  }
  return { version: 1, business: progress.business, profileCheckedAt: progress.profileCheckedAt, generatedAt: new Date().toISOString(),
    center, keyword, points, summary: summarizeGrid(points), ratingAction: ratingAction(progress.business.rating),
    sources: { profile: 'Google business information via DataForSEO', rankings: 'Google Maps via DataForSEO', area: 'U.S. Census Bureau 2025 Places Gazetteer', language: 'English', device: 'Desktop', zoom: '14z', requestedDepth: 20, spacingKm: 2 } };
}
function escape(value: string): string { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
export async function processProspectReport(id: string): Promise<void> {
  const lead = await db('audit_leads').where({ id, source: PROSPECT_SOURCE }).first();
  if (!lead) return;
  let data = lead.audit_data;
  if (!data.snapshot) {
    await db('audit_leads').where({ id }).update({ audit_data: JSON.stringify({ ...data, status: 'processing' }), updated_at: new Date() });
    try {
      const snapshot = await scanProspect(lead.google_place_id, data.areaId, lead.keyword, data.progress, async progress => { data = { ...data, progress }; await db('audit_leads').where({ id }).update({ audit_data: JSON.stringify({ ...data, status: 'processing' }), updated_at: new Date() }); });
      data = { ...data, progress: undefined, snapshot, status: 'completed', emailStatus: 'pending' };
      await db('audit_leads').where({ id }).update({ business_name: snapshot.business.name });
    } catch {
      data = { ...data, status: 'failed', error: 'We could not complete this report. Check the selected listing and city, or contact hello@superlocalseo.com if the problem continues.' };
      await db('audit_leads').where({ id }).update({ audit_data: JSON.stringify(data), updated_at: new Date() });
      return;
    }
    await db('audit_leads').where({ id }).update({ audit_data: JSON.stringify(data), updated_at: new Date() });
  }
  if (data.emailStatus === 'accepted' || !lead.email) return;
  const url = `${config.publicUrl}/free-report/${id}`;
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `free-report-${id}` },
      body: JSON.stringify({ from: `${config.resend.fromName} <${config.resend.fromEmail}>`, to: [lead.email],
        subject: `Your SuperLocalSEO report: ${data.snapshot.business.name}`,
        html: `<p>Your requested report for <strong>${escape(data.snapshot.business.name)}</strong> is ready.</p><p>It includes available review totals and a nine-point Google Maps search sample. Any unavailable observations are marked clearly.</p><p><a href="${escape(url)}">Open your report</a></p><p>This is a snapshot of the sources checked, not a prediction of traffic or revenue. You can print or save it as a PDF from the report.</p><p>SuperLocalSEO</p>` }) });
    if (!response.ok) throw new Error('Report email delivery failed');
    const receipt = await response.json() as { id?: string };
    if (!receipt.id) throw new Error('Email acceptance could not be confirmed');
    await db('audit_leads').where({ id }).update({ audit_data: JSON.stringify({ ...data, emailStatus: 'accepted', emailId: receipt.id }), updated_at: new Date() });
  } catch {
    await db('audit_leads').where({ id }).update({ audit_data: JSON.stringify({ ...data, emailStatus: 'failed' }), updated_at: new Date() });
    throw new Error('Report email delivery failed');
  }
}
