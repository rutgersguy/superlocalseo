import {fetchAllReviews as readAllReviews} from '../../services/embedmyreviews.service';
const fetchAllReviews=readAllReviews as (key:string,location:string,organization:string)=>ReturnType<typeof readAllReviews>;
const row=(id:number)=>({id,location_id:33,organization_id:26,source:'Google',date:'2026-01-01T00:00:00Z',rating:5,author:'Fixture',message:'Review',reply:null,reply_date:null});
const response=(data:unknown,meta:unknown={current_page:1,last_page:1})=>new Response(JSON.stringify({data,meta}));
describe('complete provider review snapshots',()=>{
  const original=global.fetch;afterEach(()=>{global.fetch=original;});
  it('reads every scoped page, normalizes numeric IDs and permits a healthy empty snapshot',async()=>{
    global.fetch=jest.fn().mockResolvedValueOnce(response([row(1)],{current_page:1,last_page:2,total:2})).mockResolvedValueOnce(response([row(2)],{current_page:2,last_page:2,total:2})).mockResolvedValueOnce(response([],{current_page:1,last_page:1,total:0}));
    expect((await fetchAllReviews('test','33','26')).map(r=>r.id)).toEqual(['1','2']);
    expect((global.fetch as jest.Mock).mock.calls.every(c=>c[0].includes('location_id=33')&&c[0].includes('organization_id=26'))).toBe(true);
    await expect(fetchAllReviews('test','33','26')).resolves.toEqual([]);
  });
  it.each([{}, {data:[]}, {data:[],meta:{current_page:2,last_page:2}}, {data:[{...row(1),location_id:99}],meta:{current_page:1,last_page:1}}, {data:[{...row(1),organization_id:99}],meta:{current_page:1,last_page:1}}, {data:[{...row(1),date:null}],meta:{current_page:1,last_page:1}}, {data:[{...row(1),reply:undefined}],meta:{current_page:1,last_page:1}}, {data:[],meta:{current_page:1,last_page:1,total:2}}])('rejects incomplete or foreign evidence %#',async payload=>{
    global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(fetchAllReviews('test','33','26')).rejects.toThrow();
  });
  it('rejects repeated identities and page totals that change mid-read',async()=>{
    for(const second of [{current_page:2,last_page:2,total:2},{current_page:2,last_page:3,total:3}]){
      global.fetch=jest.fn().mockResolvedValueOnce(response([row(1)],{current_page:1,last_page:2,total:2})).mockResolvedValueOnce(response([row(1)],second));
      await expect(fetchAllReviews('test','33','26')).rejects.toThrow('pagination');
    }
  });
  it('caps non-terminating pagination at 100 requests',async()=>{
    let n=0;global.fetch=jest.fn().mockImplementation(()=>{n++;return Promise.resolve(response([row(n)],{current_page:n,last_page:101}));});
    await expect(fetchAllReviews('test','33','26')).rejects.toThrow('100-page');expect(n).toBe(100);
  });
});
