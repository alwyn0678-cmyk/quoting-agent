#!/usr/bin/env bash
# Run a .sql file against the live Supabase project via the Management API SQL endpoint.
# Usage: scripts/db.sh <path/to/file.sql>
# Reads SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN from .env (gitignored). No secrets are printed.
set -euo pipefail
file="${1:?usage: scripts/db.sh <file.sql>}"
set -a; . ./.env; set +a
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF missing from .env}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN missing from .env}"
python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$file" \
  | curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
      "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      -H "Content-Type: application/json" --data @-
