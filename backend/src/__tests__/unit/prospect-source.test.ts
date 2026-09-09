import { parseBusiness, scanProspect, searchAreas, findArea } from '../../services/prospect_report.service';
import places from '../../data/us-places-2025.json';
jest.mock('../../config', () => ({ config: { ...jest.requireActual('../../config').config, dataforseo: { login: 'fixture', password: 'fixture' } } }));
const source = (items: any[], datetime = '2026-09-09 12:00:00 +00:00') => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items, items_count: items.length, datetime }] }] });
const business = { type:'google_business_info', place_id:'selected', title:'Verified business', address:null, latitude:46.423669, longitude:-129.9427086, rating:{value:5,votes_count:8} };
describe('report source identity and geography', () => {
  it('validates every bundled Census coordinate and unique identifier', () => {
    expect(places).toHaveLength(32058); expect(new Set(places.map(p=>p.id)).size).toBe(places.length);
    expect(places.every(p=>/^\d{7}$/.test(p.id) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=80 && Math.abs(p.lng)<=180)).toBe(true);
    expect(searchAreas('Atlanta, GA')).toContainEqual(findArea('1304000'));
  });
  it('retains the exact verified identity and no invented address or provider coordinates', () => {
    const b=parseBusiness(source([business]),'selected');
    expect(b).toMatchObject({name:'Verified business',address:null,rating:5,reviewCount:8});
    expect(b).not.toHaveProperty('latitude'); expect(b).not.toHaveProperty('longitude');
    expect(()=>parseBusiness(source([business]),'different')).toThrow();
    expect(()=>parseBusiness(source([business,business]),'selected')).toThrow();
  });
  it('uses the selected city for all nine requests even when provider business coordinates are wrong', async () => {
    const calls: any[]=[];
    const fetchMock=jest.spyOn(global,'fetch').mockImplementation(async (url,init) => {
      calls.push(JSON.parse(String(init?.body))[0]);
      return {ok:true,json:async()=>String(url).includes('my_business_info') ? source([business]) : source([{type:'maps_search',rank_group:1,place_id:'other',title:'Other'}])} as Response;
    });
    try {
      const s=await scanProspect('selected','1304000','film production');
      expect(calls).toHaveLength(10); expect(s.center).toMatchObject({lat:33.762909,lng:-84.422675});
      expect(calls.slice(1).every(c=>c.location_coordinate.startsWith('33.'))).toBe(true);
      expect(s.summary).toMatchObject({checked:9,found:0,averageWhenFound:null,percentages:{notFound:100}});
    } finally { fetchMock.mockRestore(); }
  });
  it('resumes persisted points without repeating their paid calls', async () => {
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:false} as Response);
    const prior={business:parseBusiness(source([business]),'selected'),profileCheckedAt:'2026-09-09T12:00:00.000Z',points:Array.from({length:8},()=>({lat:33,lng:-84,status:'unavailable',rank:null,checkedAt:'2026-09-09T12:00:00.000Z',resultCount:0,items:[]}))};
    try { const s=await scanProspect('selected','1304000','film production',prior); expect(fetchMock).toHaveBeenCalledTimes(1); expect(s.summary.checked).toBe(0); expect(s.summary.percentages.notFound).toBeNull(); }
    finally { fetchMock.mockRestore(); }
  });
});
