/**
 * Dummy config for unit tests.
 *
 * `src/config.ts` throws at import time for any missing variable, and it is
 * pulled in transitively by the logger — so importing a module to test one pure
 * function required a fully configured environment. These values are never used
 * for anything: unit tests must not perform I/O, and any test that needs real
 * credentials belongs in the integration project.
 */
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/unit';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
process.env.JWT_SECRET ??= 'unit-test-secret';
process.env.JWT_REFRESH_SECRET ??= 'unit-test-refresh-secret';
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ??= 'sk_test_unit';
process.env.STRIPE_PUBLISHABLE_KEY ??= 'pk_test_unit';
process.env.RESEND_API_KEY ??= 're_test_unit';
