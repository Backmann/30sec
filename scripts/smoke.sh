#!/bin/sh
# Run the smoke checks without Node on the host.
#
# This server has no Node.js installed — the API only ever runs inside Docker.
# So the checks run in a throwaway container of the API's own image — the same
# Node the API runs on, nothing to download, nothing to install.
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
  --entrypoint node 30sec-api /scripts/smoke.mjs "$TARGET"
