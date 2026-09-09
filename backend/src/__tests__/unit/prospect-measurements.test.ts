import { gridCoordinates, parseMapsResponse, summarizeGrid, ratingAction, MapPoint } from '../../services/prospect_measurements';
const at = '2026-09-09T12:00:00.000Z';
const coordinate = { lat: 33.75, lng: -84.39 };
const row = (rank: number, id = `place-${rank}`) => ({ type: 'maps_search', rank_group: rank, place_id: id, title: 'Same business name', rating: { value: 5, votes_count: 0 } });
const response = (items: any[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items, items_count: items.length, datetime: '2026-09-09 11:59:00 +00:00' }] }] });
const point = (rank: number | null, status: 'checked' | 'unavailable' = 'checked'): MapPoint => ({ ...coordinate, rank, status, checkedAt: at, resultCount: status === 'checked' ? 20 : 0, items: [] });
describe('verified prospect measurements', () => {
  it('matches exact place IDs, not identical business names', () => {
    const p = parseMapsResponse(response([row(1),row(2,'target')]), 'target', coordinate, at);
    expect(p.rank).toBe(2); expect(p.resultCount).toBe(2);
    expect(p.items[0]).toMatchObject({ rating: 5, reviewCount: 0 });
    expect(p.checkedAt).toBe(at); expect(p.collectedAt).toBe('2026-09-09T11:59:00.000Z');
  });
  it('retains actual returned coverage and never invents rank 21', () => {
    expect(parseMapsResponse(response([row(1),row(2)]),'absent',coordinate,at)).toMatchObject({ status: 'checked', rank: null, resultCount: 2 });
  });
  it.each([[], [row(1),row(3)], [row(1),row(1)], [row(1),row(2,'place-1')], [row(1),{...row(2),place_id:null}], [{...row(1),type:'unknown'}]].map(items => ({items})))('rejects unusable or incomplete evidence %#', ({items}) => {
    expect(() => parseMapsResponse(response(items),'target',coordinate,at)).toThrow();
  });
  it('rejects a provider count mismatch and failed task', () => {
    const body=response([row(1)]); body.tasks[0].result[0].items_count=2;
    expect(()=>parseMapsResponse(body,'target',coordinate,at)).toThrow();
    body.tasks[0].status_code=50000;
    expect(()=>parseMapsResponse(body,'target',coordinate,at)).toThrow();
  });
  it('does not fabricate a collection timestamp', () => {
    const body=response([row(1)]); body.tasks[0].result[0].datetime='invalid';
    expect(parseMapsResponse(body,'target',coordinate,at).collectedAt).toBeNull();
  });
  it('excludes failed checks from percentages and missing ranks from averages', () => {
    const s=summarizeGrid([point(1),point(8),point(null),point(null,'unavailable')]);
    expect(s).toMatchObject({ checked:3, unavailable:1, found:2, averageWhenFound:4.5, counts:{top3:1,fourToTen:1,elevenToTwenty:0,notFound:1}, percentages:{top3:33.3,notFound:33.3} });
  });
  it('all missing is 100% of checked points, with no average', () => {
    expect(summarizeGrid(Array.from({length:9},()=>point(null)))).toMatchObject({ averageWhenFound:null,percentages:{notFound:100},found:0 });
  });
  it('all failed has unknown percentages, not zeros', () => {
    expect(summarizeGrid([point(null,'unavailable')])).toMatchObject({checked:0,averageWhenFound:null,percentages:{top3:null,notFound:null}});
  });
  it('creates nine explicit coordinates around the intended center', () => {
    const grid=gridCoordinates(33.75,-84.39); expect(grid).toHaveLength(9); expect(grid[4]).toEqual(coordinate);
    expect(grid[0].lat).toBeGreaterThan(grid[4].lat); expect(grid[0].lng).toBeLessThan(grid[4].lng);
    expect(gridCoordinates(0,180).every(p=>p.lng>=-180 && p.lng<=180)).toBe(true);
    expect(()=>gridCoordinates(NaN,0)).toThrow();
  });
  it('never recommends exceeding the five-star maximum', () => {
    expect(ratingAction(5)).toContain('Maintain'); expect(ratingAction(null)).toContain('honest');
  });
});
