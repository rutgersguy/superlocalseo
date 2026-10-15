export interface GridPoint { gridRow: number; gridCol: number; lat: number; lng: number; rank: number | null; url: string | null; observationStatus?: string; }
/** Preserve every requested coordinate; missing/legacy unproven responses are unknown, not a rank failure. */
export function completeGrid(data: GridPoint[], size: number, lat: number, lng: number): GridPoint[] {
  const half = Math.floor(size / 2); const points: GridPoint[] = [];
  for (let row = -half; row <= half; row++) for (let col = -half; col <= half; col++) {
    const saved = data.find(p => p.gridRow === row && p.gridCol === col);
    points.push(saved ? { ...saved, observationStatus: saved.observationStatus ?? (saved.rank != null ? 'observed' : 'unverified') } : { gridRow: row, gridCol: col, lat: lat + row * 0.0145, lng: lng + col * 0.0145 / Math.max(0.1, Math.cos(lat * Math.PI / 180)), rank: null, url: null, observationStatus: 'unverified' });
  }
  return points;
}
