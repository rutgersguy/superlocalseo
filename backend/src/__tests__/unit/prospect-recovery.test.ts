import { prospectRecovery } from '../../services/prospect_recovery';
const now = Date.now(); const fresh = new Date(now); const stale = new Date(now - 20 * 60000);
describe('free report recovery eligibility', () => {
  it('resumes failed and stalled requests without a completed snapshot', () => {
    expect(prospectRecovery({status:'failed'}, fresh, now).allowed).toBe(true);
    expect(prospectRecovery({status:'processing'}, stale, now).allowed).toBe(true);
    expect(prospectRecovery({status:'queued'}, fresh, now).allowed).toBe(false);
    expect(prospectRecovery({status:'failed',generationToken:'live'}, fresh, now).allowed).toBe(false);
  });
  it('blocks unknown profile outcomes instead of repurchasing', () => {
    expect(prospectRecovery({status:'failed',progress:{profileAttemptedAt:'recorded'}}, stale, now).allowed).toBe(false);
  });
  it('permits only definitely unsent email, independently of age', () => {
    for (const emailStatus of ['accepted','sending','uncertain','legacy_unknown','failed','pending',undefined])
      expect(prospectRecovery({snapshot:{},emailStatus}, stale, now).allowed).toBe(false);
    for (const emailStatus of ['not_started','rejected']) expect(prospectRecovery({snapshot:{},emailStatus}, fresh, now).allowed).toBe(true);
  });
});
