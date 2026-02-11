#!/usr/bin/env bash
set -euo pipefail

# Allow explicit env override; otherwise read from Skate.
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  OPENAI_API_KEY="$(skate get open-ai 2>/dev/null || true)"
  export OPENAI_API_KEY
fi

exec podman compose up --build "$@"
