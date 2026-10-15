// Shared across scans in this API process; prevents concurrent maps multiplying
// the provider burst. Unknown points are never converted into absent businesses.
let running = 0;
const waiting: Array<() => void> = [];
export const GRID_CONCURRENCY = 8;
export async function gridRequests<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  return Promise.all(items.map(async item => {
    if (running >= GRID_CONCURRENCY) await new Promise<void>(resolve => waiting.push(resolve));
    else running++;
    try { return { status: 'fulfilled' as const, value: await fn(item) }; }
    catch (reason) { return { status: 'rejected' as const, reason }; }
    finally { const next = waiting.shift(); if (next) next(); else running--; }
  }));
}
export function gridCoverage(points: Array<{ observationStatus?: string }>) {
  const verified = points.filter(p => p.observationStatus === 'observed').length;
  return { verified, total: points.length, sufficient: points.length > 0 && verified / points.length >= 0.8 };
}
