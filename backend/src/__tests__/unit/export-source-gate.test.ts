/**
 * Exports must inherit the plan gate of the data they return.
 *
 * The bug this locks down, verified against a real Lite account before the fix:
 *
 *   GET /citations                 → 403 {"code":"PRO_REQUIRED"}
 *   GET /reports/export/citations  → 200, same rows, including listing URLs and
 *                                    full NAP mismatch detail
 *
 * Citations are Pro-only, and the CSV export of them was not gated at all —
 * `PLAN_ROUTE_GATES` matches on the REQUEST path and `reports` is not listed, so
 * an export living under /reports inherited nothing from the resource it reads.
 *
 * The fix gates on the SOURCE prefix, so the export cannot drift from the
 * resource again. These tests assert the middleware itself rather than the
 * wiring, because the wiring is one line and the logic is the part that has to
 * stay correct as plans change.
 */
import { requireSourceAccess } from '../../middleware/requireProPlan';
import { isPlanAllowed } from '../../config/planFeatures';

interface FakeRes {
  statusCode?: number;
  body?: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

function run(gate: ReturnType<typeof requireSourceAccess>, req: Record<string, unknown>) {
  const res = makeRes();
  let nexted = false;
  gate(req as never, res as never, () => { nexted = true; });
  return { res, nexted };
}

describe('requireSourceAccess', () => {
  it('blocks Lite from an export whose source is Pro-only', () => {
    // The regression: this is exactly /reports/export/citations for a Lite user.
    const { res, nexted } = run(requireSourceAccess('citations'), {
      client: { product_line: 'lite' },
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'PRO_REQUIRED' } });
  });

  it('allows Pro through', () => {
    const { nexted, res } = run(requireSourceAccess('citations'), {
      client: { product_line: 'pro' },
    });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBeUndefined();
  });

  it('allows Lite when the source is not Pro-gated', () => {
    // Keywords are readable on Lite, so a keywords export is a PRICING question
    // (#157), not a gate bypass. This middleware must not silently decide it.
    const { nexted } = run(requireSourceAccess('keywords'), {
      client: { product_line: 'lite' },
    });
    expect(nexted).toBe(true);
  });

  it('lets admins bypass, matching requireProPlan', () => {
    const { nexted } = run(requireSourceAccess('citations'), {
      userRole: 'admin',
      client: { product_line: 'lite' },
    });
    expect(nexted).toBe(true);
  });

  it('defaults an unpopulated client to Pro rather than denying', () => {
    // Same default as requireProPlan. Denying here would break legitimate Pro
    // traffic whenever req.client is absent, which is a worse failure than the
    // one being fixed.
    const { nexted } = run(requireSourceAccess('citations'), {});
    expect(nexted).toBe(true);
  });

  it('agrees with the capability map it delegates to', () => {
    // Guards against the gate and the map drifting apart.
    expect(isPlanAllowed('citations', 'lite')).toBe(false);
    expect(isPlanAllowed('citations', 'pro')).toBe(true);
  });
});
