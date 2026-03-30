#!/usr/bin/env bash
# Start the Dilla server in development mode.
# Loads ../.env.dev for Sentry/OTel config, then runs with --insecure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.dev"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
  echo "[dev] Loaded $ENV_FILE"
fi

exec cargo run -- --insecure "$@"
