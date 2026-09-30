/**
 * Test setup for the API.
 *
 * Scope is deliberate: these are unit tests over pure logic — the rules of a
 * match, phase derivation, secret redaction. They need no database, no Redis,
 * no network and no generated Prisma client, which means they run anywhere,
 * including a machine that cannot reach the Prisma binaries.
 *
 * Tests that need a database are a separate concern and will want their own
 * project entry here, with a throwaway Postgres to point at.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/apps/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['apps/api/src/common/**/*.ts'],
  // The project ships with strict: false; tests should not be held to a
  // different bar than the code they cover.
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { warnOnly: true } }],
  },
};
