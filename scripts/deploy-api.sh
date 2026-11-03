#!/bin/sh
# Release the API on the server, prove it works, and undo it if it does not.
#
# Called by .github/workflows/deploy.yml right after `git pull`, from
# /root/30sec. Kept in the repository rather than inline in the workflow so it
# can be read, reviewed and tested like any other code.
#
# Why each step exists:
#   - The Docker healthcheck only asks /api/health, which answers without
#     touching the database. A release that cannot reach Postgres — a broken
#     Prisma engine after a Node upgrade, say — still turns "healthy". So the
#     smoke checks (scripts/smoke.mjs) run afterwards: they read ranks and the
#     leaderboard from the database, confirm anonymous users are refused, and
#     confirm no live tournament leaks a correct answer.
#   - Before building, the image the running container actually uses is
#     tagged 30sec-api:previous. If the new release is not healthy, or fails a
#     smoke check, that image is put back — no rebuild, no guessing which
#     commit it came from. The run still ends red, so the failure is seen.
#   - There is no database migration to undo: prisma/migrations does not exist
#     (schema changes are applied by hand from prisma/migrations-manual), so
#     the `prisma migrate deploy` in the image's CMD has nothing to apply.
#
# Test hooks: DOCKER (the docker command) and WAIT_SECONDS (pause between
# health polls) can be overridden; production uses the defaults.

set -eu

DOCKER=${DOCKER:-docker}
WAIT_SECONDS=${WAIT_SECONDS:-10}
CONTAINER=30sec-api
IMAGE=30sec-api
SMOKE_TARGET=http://127.0.0.1:3000

wait_healthy() {
  i=1
  while [ "$i" -le 12 ]; do
    sleep "$WAIT_SECONDS"
    status=$($DOCKER inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)
    echo "   [attempt $i/12] status: $status"
    [ "$status" = healthy ] && return 0
    i=$((i + 1))
  done
  return 1
}

# The smoke script runs inside the image just built: same Node, nothing to
# download. --network host reaches the API on 127.0.0.1:3000 directly, so the
# check does not depend on nginx or Cloudflare.
smoke() {
  $DOCKER run --rm --network host \
    -v "$(pwd)/scripts:/scripts:ro" \
    --entrypoint node "$IMAGE" /scripts/smoke.mjs "$SMOKE_TARGET"
}

# A recreated container gets a new address; nginx keeps the old one until
# restarted, and answers 502 meanwhile.
restart_nginx() {
  $DOCKER restart 30sec-nginx >/dev/null && sleep 3
}

rollback() {
  reason=$1
  echo ""
  echo "FAIL: $reason"
  $DOCKER compose logs api --tail 50 || true
  if [ -z "$PREVIOUS" ]; then
    echo "No earlier image to return to. The new release stays as it is."
    exit 1
  fi
  echo ""
  echo "-> ROLLBACK: putting back the image that ran before this release..."
  $DOCKER tag "$IMAGE:previous" "$IMAGE:latest"
  $DOCKER compose up -d --force-recreate --no-deps api
  if wait_healthy; then
    restart_nginx
    echo "-> Smoke checks on the restored release:"
    if smoke; then
      echo "ROLLED BACK: the previous release is running and passes its checks."
    else
      echo "ROLLED BACK, but the previous release fails its checks too — look now."
    fi
  else
    echo "ROLLBACK FAILED: the previous release did not become healthy — look now."
  fi
  exit 1
}

echo "-> Remembering the image the API runs now..."
PREVIOUS=$($DOCKER inspect --format='{{.Image}}' "$CONTAINER" 2>/dev/null || true)
if [ -n "$PREVIOUS" ]; then
  $DOCKER tag "$PREVIOUS" "$IMAGE:previous"
  echo "   kept as $IMAGE:previous"
else
  echo "   no running API — nothing to roll back to on failure"
fi

echo "-> Clean up any stale API containers..."
$DOCKER ps -a --filter "name=$CONTAINER" --format "{{.Names}}" | xargs -r $DOCKER rm -f || true

echo "-> Rebuilding and starting API container..."
$DOCKER compose up -d --build --force-recreate --no-deps api

echo "-> Waiting for health check (up to 120s)..."
wait_healthy || rollback "API did not become healthy in time"
echo "OK: API is healthy. Restarting nginx..."
restart_nginx

echo "-> Smoke checks against the new release..."
smoke || rollback "smoke checks failed on the new release"

echo "DEPLOYED: healthy and passing smoke checks."
