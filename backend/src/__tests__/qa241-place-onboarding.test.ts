import request from 'supertest';
import app from '../app';
import {db} from '../db/connection';
import {config} from '../config';
import {initialScansQueue} from '../jobs/queue';
jest.mock('../services/geocode.service',()=>({...jest.requireActual('../services/geocode.service'),geocodeAddress:jest.fn().mockResolvedValue(null)}));
describe('automatic onboarding review destination',()=>{
 const email=`place-241-${Date.now()}@example.invalid`;let token:string;const prior=config.googlePlacesApiKey;
 beforeAll(async()=>{
  jest.spyOn(initialScansQueue,'add').mockResolvedValue({} as never);
  await request(app).post('/api/auth/register').send({email,password:'Password123!',businessName:'Aire Serv'});
  token=(await request(app).post('/api/auth/login').send({email,password:'Password123!'})).body.data.accessToken;
  Object.assign(config,{googlePlacesApiKey:'fixture'});
  jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({places:[{id:'ChIJverified241',displayName:{text:'Aire Serv'},types:['establishment'],location:{latitude:36,longitude:-96},addressComponents:[
   ['street_number','123','123'],['route','Main Street','Main St'],['locality','Tulsa','Tulsa'],['administrative_area_level_1','Oklahoma','OK'],['postal_code','74103','74103'],['country','United States','US'],
  ].map(([type,longText,shortText])=>({types:[type],longText,shortText}))}]})} as any);
 });
 afterAll(async()=>{Object.assign(config,{googlePlacesApiKey:prior});jest.restoreAllMocks();await db('users').where({email}).delete();});
 it('creates a location without manual place ID and exposes a ready Google review destination',async()=>{
  const r=await request(app).post('/api/locations').set('Authorization',`Bearer ${token}`).send({name:'Aire Serv',address:'123 Main St',city:'Tulsa',state:'OK',zip:'74103'});
  expect(r.status).toBe(201);expect(r.body.data.googlePlaceId).toBe('ChIJverified241');
  const collection=await request(app).get('/api/campaigns/collection').set('Authorization',`Bearer ${token}`);
  expect(collection.status).toBe(200);expect(collection.body.data.locations[0].ready).toBe(true);
  const billing=await request(app).get('/api/billing/status').set('Authorization',`Bearer ${token}`);
  expect(billing.status).toBe(200);expect(billing.body.data.resourceUsage.seats).toBe(1);
  expect(billing.body.data.resourceUsage.keywords[0].used).toBe(2);
 });
});
