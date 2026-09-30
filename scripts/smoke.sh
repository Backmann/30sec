#!/bin/sh
# Run the smoke checks without Node on the host.
#
# This server has no Node.js installed — the API only ever runs inside Docker.
# So the checks run in a throwaway container built from the same base image the
# project already pulls, which means no download and no install.
#
#   ./scripts/smoke.sh                        # checks https://30sec.org
#   ./scripts/smoke.sh http://127.0.0.1:3000  # checks the container directly
#
# --network host is what lets the second form reach a port bound to localhost.
# Exits non-zero when a check fails, so it can gate a deploy.

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET=${1:-https://30sec.org}

exec docker run --rm --network host \
  -v "$SCRIPT_DIR":/scripts:ro \
  node:20-alpine node /scripts/smoke.mjs "$TARGET"
