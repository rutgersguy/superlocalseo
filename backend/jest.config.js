/**
 * Two projects, because not every test needs a database.
 *
 * `setupFilesAfterEnv` runs knex migrations before every suite, so a test of a
 * pure function could not run without a live Postgres — which meant the
 * citation matching gates (#174) were unrunnable despite touching no I/O at
 * all. Unit tests live in __tests__/unit and skip that setup entirely.
 */
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/db/migrations/**', '!src/db/seeds/**'],
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['**/__tests__/unit/**/*.test.ts'],
      setupFiles: ['<rootDir>/src/__tests__/unit/env.ts'],
      testTimeout: 10000,
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['**/__tests__/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
      testTimeout: 10000,
    },
  ],
};
