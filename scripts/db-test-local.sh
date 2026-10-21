#!/usr/bin/env bash
# Run every SQL proof in supabase/tests/ against the LOCAL Supabase stack (`supabase start`).
# Each test raises on failure; psql's ON_ERROR_STOP turns that into a non-zero exit. Tests run in
# their own transactions and roll back, so the order does not matter and reruns are clean.
# Usage: scripts/db-test-local.sh [test.sql ...]   (default: all tests)
set -euo pipefail
cd "$(dirname "$0")/.."
container="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
docker inspect "$container" >/dev/null 2>&1 || { echo "db-test-local: $container is not running — run 'supabase start' first" >&2; exit 1; }
files=("$@"); [ ${#files[@]} -eq 0 ] && files=(supabase/tests/*.sql)
pass=0; fail=0
for f in "${files[@]}"; do
  if out=$(docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X < "$f" 2>&1); then
    pass=$((pass+1)); echo "PASS  $f"
  else
    fail=$((fail+1)); echo "FAIL  $f"; echo "$out" | sed 's/^/      /' | tail -8
  fi
done
echo "SQL tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
