import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { geocodeAddress } from '../services/geocode.service';
import { initialScansQueue } from '../jobs/queue';
jest.mock('../services/geocode.service', () => ({ geocodeAddress: jest.fn() }));
describe('location geocoding across edits', () => {
  let clientId: string, locationId: string, token: string;
  const email = `geocode-${Date.now()}@example.com`;
  beforeAll(async () => {
    jest.spyOn(initialScansQueue, 'add').mockResolvedValue({} as never);
    await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Geocode fixture' });
    const user = await db('users').where({ email }).first(); clientId = (await db('clients').where({ user_id: user.id }).first()).id;
    token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
    locationId = (await db('locations').insert({ client_id: clientId, name: 'Geocode fixture', address: '1 Old St', city: 'Tulsa', state: 'OK', zip: '74133', lat: 35, lng: -95 }).returning('id'))[0].id;
  });
  afterAll(async () => { await db('users').where({ email }).delete(); });
  it('keeps entered addresses and ignores a slow lookup after the address changes again', async () => {
    let releaseOld!: (coords: { lat: number; lng: number }) => void;
    (geocodeAddress as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; })).mockResolvedValueOnce({ lat: 36, lng: -96 });
    const patch = (address: string) => request(app).patch(`/api/locations/${locationId}`).set('Authorization', `Bearer ${token}`).send({ address });
    expect((await patch('9524 E81 St STE B-1502')).status).toBe(200);
    expect((await db('locations').where({ id: locationId }).first()).lat).toBeNull();
    expect((await patch('123 New St STE A')).status).toBe(200);
    releaseOld({ lat: 37, lng: -97 });
    for (let i = 0; i < 20; i++) {
      const loc = await db('locations').where({ id: locationId }).first();
      if (Number(loc.lat) === 36) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const saved = await db('locations').where({ id: locationId }).first();
    expect(saved.address).toBe('123 New St STE A'); expect(Number(saved.lat)).toBe(36); expect(Number(saved.lng)).toBe(-96);
    expect(geocodeAddress).toHaveBeenCalledWith('123 New St STE A', 'Tulsa', 'OK', '74133');
  });
});
