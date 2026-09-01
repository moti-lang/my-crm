#!/usr/bin/env bash
# מדמה `supabase db reset` על פוסטגרס מקומי: מפיל, בונה מאפס, מריץ מיגרציות + seed.
# מאמת שהסכמה וה-seed עולים נקי בלי להיות תלויים בפרויקט Supabase חי.
set -euo pipefail
PSQL="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists teichtal" >/dev/null
$PSQL -d postgres -c "create database teichtal" >/dev/null
$PSQL -d teichtal -f "$(dirname "$0")/00_local_auth_shim.sql"
for f in "$(dirname "$0")"/../migrations/*.sql; do
  echo "  → $(basename "$f")"; $PSQL -d teichtal -f "$f"
done
echo "  → seed.sql"; $PSQL -d teichtal -f "$(dirname "$0")/../seed.sql"
echo "db reset OK"
