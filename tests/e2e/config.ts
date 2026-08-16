/**
 * Single source of truth for where the e2e suite points.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until 2026-08-16 the suite hardcoded `http://localhost:5173` in three places
 * (playwright.config.ts, global-setup.ts, helpers/auth.ts). That worked while the
 * web container ran the Vite dev server, which proxied /api to the API container.
 *
 * Commit 1ce0f32 (2026-07-10) switched the web container to `target: production`
 * — a static nginx build whose config deliberately does NOT proxy /api, because
 * the OUTER reverse proxy (n8n-nginx) does that on the public domain instead.
 *
 * Result: POST http://localhost:5173/api/auth/login → 405 Not Allowed. Every login
 * failed, global setup timed out, and all 56 tests were unrunnable for five weeks
 * without anyone noticing (CI never invokes Playwright).
 *
 * So the default base URL is the public origin, which is the only origin that
 * currently serves both the SPA and /api. Override with E2E_BASE_URL once a
 * dedicated test stack exists — that stack should proxy /api in its own frontend
 * nginx config so the suite can run fully offline against a disposable database.
 *
 * ⚠️  The default target is PRODUCTION. These specs register real users in the
 *     live database and delete them in afterEach/globalTeardown. Point
 *     E2E_BASE_URL at a test stack as soon as one exists.
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? 'https://superlocalseo.com';

/** API origin. Derived from BASE_URL so the two can never drift apart again. */
export const API_URL = process.env.E2E_API_URL ?? `${BASE_URL}/api`;

/** True when the suite is pointed at the live production stack. */
export const IS_PRODUCTION_TARGET = /superlocalseo\.com/.test(BASE_URL);

/**
 * Opt-in flag for tests that cost real money or cause off-machine side effects:
 * completing onboarding provisions an EmbedMyReviews organization and enqueues
 * BrightLocal + DataForSEO pulls. Run with RUN_COSTLY=1 deliberately, never in CI.
 */
export const RUN_COSTLY = process.env.RUN_COSTLY === '1';
