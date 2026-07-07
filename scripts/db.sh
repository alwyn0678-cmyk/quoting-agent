#!/usr/bin/env bash
# Run a .sql file against the live Supabase project via the Management API SQL endpoint.
# Usage: scripts/db.sh <path/to/file.sql>
# Reads SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN from .env (gitignored). No secrets are printed.
set -euo pipefail
file="${1:?usage: scripts/db.sh <file.sql>}"
case "$file" in /*) ;; *) file="$PWD/$file" ;; esac # keep caller-relative sql paths working after the cd
cd "$(dirname "$0")/.."                             # repo root: always source THIS repo's .env, from any cwd
set -a; . ./.env; set +a
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF missing from .env}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN missing from .env}"
response=$(python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$file" \
  | curl -s -w '\n%{http_code}' -X POST \
      "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      -H "Content-Type: application/json" --data @-)
status="${response##*$'\n'}"
body="${response%$'\n'*}"
printf '%s\n[HTTP %s]\n' "$body" "$status"
case "$status" in
  2??) ;;
  *) echo "db.sh: FAILED — HTTP ${status:-?} from the Management API (response body above)" >&2; exit 1 ;;
esac
