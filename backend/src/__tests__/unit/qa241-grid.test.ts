const mockUpdate=jest.fn().mockResolvedValue(1);
jest.mock('../../db/connection',()=>({db:jest.fn(()=>({where:jest.fn(()=>({update:mockUpdate}))}))}));
jest.mock('../../services/brightlocal.service',()=>({createRankingRequest:jest.fn(),fetchRankingResult:jest.fn()}));
jest.mock('../../services/dataforseo.service',()=>({getRankForCoordinate:jest.fn()}));
import {runGeoGrid} from '../../controllers/geogrid.controller';
import {createRankingRequest,fetchRankingResult} from '../../services/brightlocal.service';
import {getRankForCoordinate} from '../../services/dataforseo.service';
beforeEach(()=>jest.clearAllMocks());
it('falls back after ready-but-failed BrightLocal results, retaining all points',async()=>{
 let seq=0;(createRankingRequest as jest.Mock).mockImplementation(async()=>`req_${seq++}`);
 (fetchRankingResult as jest.Mock).mockResolvedValue({ready:true,success:false});
 (getRankForCoordinate as jest.Mock).mockResolvedValue({rank:3,url:'https://example.com'});
 await runGeoGrid('grid_qa','hvac',36,-96,3,{name:'QA'});
 expect(getRankForCoordinate).toHaveBeenCalledTimes(9);
 const row=mockUpdate.mock.calls.at(-1)[0];expect(row.status).toBe('complete');
 expect(JSON.parse(row.grid_data)).toHaveLength(9);expect(JSON.parse(row.grid_data).every((p:any)=>p.rank===3&&p.observationStatus==='observed')).toBe(true);
});
it('reports failure when most points are unknown instead of claiming no visibility',async()=>{
 (createRankingRequest as jest.Mock).mockRejectedValue(new Error('HTTP 429'));
 let seq=0;(getRankForCoordinate as jest.Mock).mockImplementation(async()=>{if(seq++<6)throw new Error('No Search Results');return{rank:null,url:null};});
 await runGeoGrid('grid_qa','hvac',36,-96,3,{name:'QA'});
 const row=mockUpdate.mock.calls.at(-1)[0];expect(row.status).toBe('failed');
 const points=JSON.parse(row.grid_data);expect(points).toHaveLength(9);expect(points.filter((p:any)=>p.observationStatus==='unverified')).toHaveLength(6);
});
