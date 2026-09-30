#!/bin/sh
# Run the integration tests against a throwaway database.
#
# There is no Node on this host, so everything happens in containers: a
# disposable Postgres for the data, and the project's own builder image for the
# test run — that image already has node_modules and a generated Prisma client,
# so nothing is installed here.
#
#   ./scripts/test-integration.sh
#
# Two details worth knowing, both learned the hard way:
#
#   * Its own compose project name. Both compose files live in this directory,
#     so without one Docker treats them as the same project and reports the
#     running stack as orphaned containers.
#
#   * No published port. This machine already runs Postgres on 5432 and 5433;
#     a third would collide. The test container joins the test project's
#     network and reaches the database by service name instead.
#
# The database is started fresh, the schema is pushed into it, the tests run,
# and it is torn down afterwards whether they passed or not. Its data lives in
# tmpfs and never touches disk.
#
# Exits non-zero if any test fails.

set -e

cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.test.yml
PROJECT=30sec-test
TEST_IMAGE=30sec-api-test
NETWORK="${PROJECT}_default"
TEST_DB_URL="postgresql://test:test@postgres-test:5432/sec30_test?schema=public"

cleanup() {
  echo ""
  echo "Removing the throwaway database…"
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
}
# Runs on success, on failure and on Ctrl-C, so a failed run never leaves a
# stray container behind.
trap cleanup EXIT INT TERM

echo "Starting throwaway database…"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --wait

echo "Building the test image…"
# --target builder stops before the production stage: dev dependencies, which
# is where jest lives, are still present there.
docker build --target builder -t "$TEST_IMAGE" . >/dev/null

echo "Pushing schema and running tests…"
echo ""
docker run --rm --network "$NETWORK" \
  -e DATABASE_URL="$TEST_DB_URL" \
  "$TEST_IMAGE" \
  sh -c "npx prisma db push --skip-generate --accept-data-loss >/dev/null && npx jest --config jest.integration.config.js"
