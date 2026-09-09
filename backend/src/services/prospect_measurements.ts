export interface MapItem { placeId: string; name: string; rank: number; rating: number | null; reviewCount: number | null; }
export interface MapPoint { lat: number; lng: number; status: 'checked' | 'unavailable'; rank: number | null; checkedAt: string; collectedAt?: string | null; resultCount: number; items: MapItem[]; }
export function gridCoordinates(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 80 || Math.abs(lng) > 180) throw new Error('Invalid scan center');
  const deltaLat = 2 / 111.32;
  const deltaLng = 2 / (111.32 * Math.cos(lat * Math.PI / 180));
  return [1, 0, -1].flatMap(y => [-1, 0, 1].map(x => ({ lat: +(lat + y * deltaLat).toFixed(7), lng: +(((lng + x * deltaLng + 540) % 360) - 180).toFixed(7) })));
}
export function summarizeGrid(points: MapPoint[]) {
  const checked = points.filter(p => p.status === 'checked');
  const found = checked.filter(p => p.rank !== null);
  const counts = { top3: 0, fourToTen: 0, elevenToTwenty: 0, notFound: 0 };
  for (const p of checked) {
    if (p.rank === null) counts.notFound++;
    else if (p.rank <= 3) counts.top3++;
    else if (p.rank <= 10) counts.fourToTen++;
    else counts.elevenToTwenty++;
  }
  return { checked: checked.length, unavailable: points.length - checked.length, found: found.length,
    averageWhenFound: found.length ? Math.round(found.reduce((n,p) => n + p.rank!,0) / found.length * 10) / 10 : null,
    counts, percentages: Object.fromEntries(Object.entries(counts).map(([key,n]) => [key, checked.length ? Math.round(n / checked.length * 1000) / 10 : null])) };
}
export function parseMapsResponse(body: any, placeId: string, coordinate: { lat: number; lng: number }, checkedAt: string): MapPoint {
  const task = body?.tasks?.[0];
  const result = task?.result?.[0];
  if (body?.status_code !== 20000 || task?.status_code !== 20000 || !Array.isArray(result?.items)) throw new Error('Map observation unavailable');
  // A filtered subset cannot prove absence: missing IDs, duplicate ranks or a
  // truncated/gapped list invalidate the observation instead of lowering coverage.
  const raw = result.items;
  if (!raw.length || raw.length > 20 || (result.items_count != null && result.items_count !== raw.length)) throw new Error('Incomplete map observations');
  const ranks = new Set<number>();
  const ids = new Set<string>();
  const items: MapItem[] = raw.map((i: any) => {
    if (i.type !== 'maps_search' || !Number.isInteger(i.rank_group) || i.rank_group < 1 || i.rank_group > 20 ||
      typeof i.place_id !== 'string' || !i.place_id.trim() || ranks.has(i.rank_group) || ids.has(i.place_id)) throw new Error('Invalid map observation');
    ranks.add(i.rank_group); ids.add(i.place_id);
    return { placeId: i.place_id, name: typeof i.title === 'string' ? i.title : 'Unnamed business', rank: i.rank_group,
      rating: typeof i.rating?.value === 'number' && i.rating.value >= 0 && i.rating.value <= 5 ? i.rating.value : null,
      reviewCount: Number.isInteger(i.rating?.votes_count) && i.rating.votes_count >= 0 ? i.rating.votes_count : null };
  });
  if (Math.max(...ranks) !== items.length) throw new Error('Gaps in map observations');
  const collectionTime = typeof result.datetime === 'string' ? Date.parse(result.datetime) : NaN;
  return { ...coordinate, status: 'checked', checkedAt,
    collectedAt: Number.isFinite(collectionTime) ? new Date(collectionTime).toISOString() : null,
    rank: items.find(i => i.placeId === placeId)?.rank ?? null, resultCount: items.length, items };
}

export function ratingAction(rating: number | null): string {
  if (rating === 5) return 'Maintain the service customers value and keep inviting honest feedback.';
  if (rating === null) return 'Check your Google listing and invite customers to share their honest experience.';
  return 'Read recent feedback for specific improvements, then invite honest reviews from all customers.';
}
