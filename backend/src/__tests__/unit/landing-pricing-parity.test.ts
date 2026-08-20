/**
 * The public landing page and the JSON-LD in index.html must quote the same
 * prices, and both must match the Stripe-backed figures in PRICING.md.
 *
 * This is guarded by a test because it has gone wrong three times:
 *   #113  BillingPage checkout summary hardcoded to Pro — Lite customers were
 *         billed Lite and SHOWN Pro numbers.
 *   #125  Settings quoted $349 plus the waived $499 setup fee to trialing users
 *         who had not picked a plan at all.
 *   #153  index.html served the retired $350–$1200 tiers to Google for months.
 *         It is not React, so nobody looks at it when prices change.
 *
 * The landing page cannot derive prices the way an authenticated surface does —
 * it is public and has no client to read `productLine` from — so a constant plus
 * this test is the available substitute. If you are changing prices, change
 * PRICING.md, Landing.tsx, index.html, and the numbers here together.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENABLED_AI_ENGINES } from '../../config/ai_engines.config';

const EXPECTED = { lite: 149, pro: 349, extraLocation: 125, setupFeeAnchor: 499 };

const root = join(__dirname, '../../../..');
const landingSource = readFileSync(join(root, 'frontend/src/pages/Landing.tsx'), 'utf8');

/**
 * Source with comments stripped.
 *
 * These guards are about what a VISITOR reads, not what the file documents. The
 * header comment necessarily quotes the banned jargon and the retired "Trusted
 * by..." line in order to explain why they are banned, and a naive scan of the
 * raw file flags exactly the documentation that exists to prevent the problem.
 */
const landing = landingSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const indexHtml = readFileSync(join(root, 'frontend/index.html'), 'utf8');

describe('landing page pricing parity', () => {
  it('declares the prices in one constant rather than scattered through the markup', () => {
    // The retired $499 setup fee survived in three separate places after it was
    // waived, because each was written out by hand.
    const block = landingSource.match(/const PRICING = \{[\s\S]*?\} as const;/);
    expect(block).not.toBeNull();

    for (const [key, value] of Object.entries(EXPECTED)) {
      expect(block![0]).toContain(`${key}: ${value}`);
    }
  });

  it('does not hardcode a dollar figure outside that constant', () => {
    // Any "$149"-style literal in the markup is a price that will not move when
    // PRICING does. Interpolations like ${PRICING.lite} are what we want.
    const body = landing.replace(/const PRICING = \{[\s\S]*?\} as const;/, '');
    const hardcoded = body.match(/\$\d{2,4}\b/g) ?? [];

    // The agency comparison is a market fact, not our price — see POSITIONING.md.
    const allowed = new Set(['$1,500', '$5,000']);
    expect(hardcoded.filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('serves the same prices to Google in the JSON-LD', () => {
    const raw = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(raw).not.toBeNull();

    // JSON-LD is JSON: a stray comment inside the block silently invalidates the
    // whole structured-data blob, so parse it rather than regexing the numbers.
    const ld = JSON.parse(raw![1]) as { offers?: { lowPrice?: string; highPrice?: string } };

    expect(ld.offers?.lowPrice).toBe(String(EXPECTED.lite));
    expect(ld.offers?.highPrice).toBe(String(EXPECTED.pro));
  });
});

describe('landing page positioning guards', () => {
  it('does not use SEO jargon our buyer does not speak', () => {
    // docs/POSITIONING.md bans these from the page: the reader is a plumber.
    // "citations" in particular is our internal word for directory listings.
    // Word boundaries matter: "snapshot" contains "nap", and we say "every
    // snapshot we have ever recorded" on purpose.
    for (const term of ['NAP', 'local pack', 'SERP', 'domain authority', 'backlink']) {
      expect(landing).not.toMatch(new RegExp(`\\b${term}\\b`, 'i'));
    }
  });

  it('has not brought back the placeholder social proof', () => {
    // With no named customers, "trusted by..." reads as "we have no customers"
    // and did active damage at this price point.
    expect(landing).not.toMatch(/trusted by/i);
  });

  it('names every assistant we actually scan, and no others', () => {
    // Derived from the engine registry rather than a hardcoded list, so
    // enabling or disabling an engine forces the page copy to change with it.
    // POSITIONING.md: we do not name an engine in marketing that we do not
    // scan, and we do not scan one we do not report.
    for (const engine of ENABLED_AI_ENGINES) {
      expect(landing).toContain(engine.label);
    }
  });

  it('does not advertise an assistant that is switched off', () => {
    const { AI_ENGINES } = jest.requireActual<typeof import('../../config/ai_engines.config')>(
      '../../config/ai_engines.config',
    );
    for (const engine of AI_ENGINES.filter((e) => !e.enabled)) {
      expect(landing).not.toContain(engine.label);
    }
  });
});
