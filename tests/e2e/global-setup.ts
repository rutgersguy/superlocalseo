import { cleanupTestUsers } from './helpers/db';
import { BASE_URL, IS_PRODUCTION_TARGET } from './config';

/**
 * Global setup is deliberately minimal.
 *
 * It used to UI-login the admin and a throwaway client and write storageState to
 * tests/e2e/.auth/*.json — roughly 30s of browser work per run producing artifacts
 * that NO spec ever read (`grep -rn storageState tests/` → zero hits). Specs log in
 * fresh in beforeEach instead, because the refresh token is single-use and rotates:
 * a reused storageState logs the next test out mid-run.
 *
 * That dead code also made the whole suite fail hard if the hardcoded admin
 * password ever changed. Removed 2026-08-16.
 */
async function globalSetup() {
  if (IS_PRODUCTION_TARGET) {
    // Loud, because it is: these specs write to the live customer database.
    console.warn(
      `\n  ⚠  e2e target is PRODUCTION (${BASE_URL}).\n` +
      `     Test users (pw-*@test.com) are created and deleted in the live DB.\n` +
      `     Set E2E_BASE_URL to a test stack as soon as one exists.\n`
    );
  }
  cleanupTestUsers();
}

export default globalSetup;
