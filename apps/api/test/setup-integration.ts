import { PrismaClient } from '@prisma/client';

/**
 * Shared setup for integration tests.
 *
 * One client for the whole run, and every table emptied between tests. The
 * alternative — each test tidying up after itself — fails the moment a test
 * fails midway and leaves its rows behind, after which every later test is
 * suspect. Truncating up front means a failure stays local to the test that
 * caused it.
 *
 * The URL is fixed rather than read from the environment: pointing these at
 * the real database would wipe it, and an environment variable is exactly the
 * kind of thing that gets set wrong once. The host name is the compose
 * service, reachable because the runner joins that project's network — no
 * port is published, so nothing can collide with the databases already
 * running on this machine.
 */
const TEST_DATABASE_URL = 'postgresql://test:test@postgres-test:5432/sec30_test?schema=public';

export const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

/** Every table the schema owns, discovered rather than listed by hand. */
async function tableNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT LIKE '_prisma%'
  `;
  return rows.map((r) => r.tablename);
}

let tables: string[] = [];

beforeAll(async () => {
  await prisma.$connect();

  // Refuse to run against anything that is not the throwaway database. This
  // check is cheap and the mistake it prevents is not recoverable.
  const [{ current_database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  if (current_database !== 'sec30_test') {
    throw new Error(
      `Integration tests are pointed at "${current_database}", not sec30_test. Refusing to truncate.`,
    );
  }

  tables = await tableNames();
  if (tables.length === 0) {
    throw new Error('No tables found — has the schema been pushed? See scripts/test-integration.sh');
  }
});

beforeEach(async () => {
  // CASCADE so foreign keys do not dictate the order; RESTART IDENTITY so
  // sequences do not drift between tests.
  const list = tables.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
