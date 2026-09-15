import { db } from '../db/connection';
import { register, googleSignIn } from '../services/auth.service';
jest.mock('../services/email.service', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined), sendWelcomeEmail: jest.fn().mockResolvedValue(undefined), sendPasswordResetEmail: jest.fn() }));
const emails = ['password', 'google'].map(x => `trial-dates-${x}-${Date.now()}@example.test`);
afterEach(async () => { await db('users').whereIn('email', emails).delete(); });
async function dates(email: string) {
  return db('clients as c').join('users as u','u.id','c.user_id').where('u.email',email).select('u.created_at as registered','c.created_at as created','c.trial_ends_at as ends').first();
}
it('starts a new password registration with current dates and a full seven-day trial', async () => {
  const before=Date.now(); await register(emails[0], 'Password123!', 'Trial fixture'); const after=Date.now(); const row=await dates(emails[0]);
  expect(new Date(row.registered).getTime()).toBeGreaterThanOrEqual(before-1000); expect(new Date(row.registered).getTime()).toBeLessThanOrEqual(after+1000);
  expect(Math.abs(new Date(row.created).getTime()-new Date(row.registered).getTime())).toBeLessThan(5000);
  expect(Math.abs(new Date(row.ends).getTime()-new Date(row.created).getTime()-7*86400000)).toBeLessThan(5000);
});
it('starts a new Google registration with seven days and preserves dates on returning sign-in', async () => {
  const before=Date.now(), googleId=`trial-google-${Date.now()}`; await googleSignIn(googleId,emails[1],'Trial fixture'); const after=Date.now(); const row=await dates(emails[1]);
  expect(new Date(row.registered).getTime()).toBeGreaterThanOrEqual(before-1000); expect(new Date(row.registered).getTime()).toBeLessThanOrEqual(after+1000);
  expect(Math.abs(new Date(row.ends).getTime()-new Date(row.created).getTime()-7*86400000)).toBeLessThan(5000);
  await googleSignIn(googleId,emails[1],'Trial fixture'); expect(await dates(emails[1])).toEqual(row);
});
