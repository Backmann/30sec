/**
 * Integration tests: real Prisma against a real (throwaway) Postgres.
 *
 * Kept apart from the unit config because these have requirements the unit
 * tests deliberately do not: a database to point at, a schema pushed into it,
 * and enough time to talk to it. Mixing them would mean the fast tests could
 * no longer run anywhere.
 *
 * Run through scripts/test-integration.sh, which starts the database, pushes
 * the schema and stops it afterwards.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/apps/**/*.int-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // A database round-trip is slower than a pure function; the default 5s is
  // tight for a test that seeds a tournament first.
  testTimeout: 30_000,
  // These share one database, so they cannot run in parallel: truncating
  // tables under another worker's feet produces failures that look like logic
  // bugs and are not.
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/apps/api/test/setup-integration.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { warnOnly: true } }],
  },
};
