/**
 * The front-end capability map must not disagree with the backend one (#157).
 *
 * They are separate files by necessity — the frontend cannot import across the
 * workspace — and they had drifted badly: the frontend's `PRO_SETTINGS_TABS`
 * and `LITE_RANKINGS_HIDDEN` were imported by nothing, `canAccess()` had zero
 * consumers, and the keys matched no code ('qr' vs 'qrcodes', 'whitelabel' was
 * not a tab). Pages hardcoded their own isLite checks instead, which is how
 * four Pro-marketed surfaces ended up rendering for Lite.
 *
 * This asserts the pairs that must agree. Hiding a control whose endpoint is
 * open is theatre; gating an endpoint whose control still renders is a dead
 * button. Both have shipped to production.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { isPlanAllowed } from '../../config/planFeatures';

const frontendMap = readFileSync(
  join(__dirname, '../../../../frontend/src/config/planFeatures.ts'),
  'utf8',
);

describe('frontend/backend plan map parity', () => {
  it('the frontend still declares the Pro features the backend gates', () => {
    // If someone deletes a key here, the corresponding control silently
    // reappears for Lite.
    for (const feature of ['csvExport', 'roiSettings']) {
      expect(frontendMap).toContain(`'${feature}'`);
    }
  });

  it('every Pro feature the frontend hides has a backend gate behind it', () => {
    // csvExport hides the buttons; these are the endpoints they call.
    expect(isPlanAllowed('reports/export/rankings', 'lite')).toBe(false);
    expect(isPlanAllowed('analytics/export', 'lite')).toBe(false);
    // roiSettings hides the form; this is the endpoint it reads and writes.
    expect(isPlanAllowed('analytics/roi', 'lite')).toBe(false);
  });

  it('the dead exports that caused the drift are gone', () => {
    // Asserts the DECLARATION, not the identifier — the replacement comment
    // names both constants to explain what it replaced, and matching on the
    // bare word failed against that comment.
    expect(frontendMap).not.toMatch(/export const PRO_SETTINGS_TABS/);
    expect(frontendMap).not.toMatch(/export const LITE_RANKINGS_HIDDEN/);
  });

  it('canUseFeature is typed so an unregistered key cannot compile', () => {
    // The root cause of this class of bug is default-allow. canAccess() still
    // defaults unlisted PAGES to allowed by design, but in-page features go
    // through a union type, so forgetting to register one is a build error
    // rather than a silent leak to Lite.
    expect(frontendMap).toMatch(/feature: ProFeature/);
  });
});
