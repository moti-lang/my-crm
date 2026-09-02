#!/usr/bin/env bash
# מדמה `supabase db reset` על פוסטגרס מקומי: מפיל, בונה מאפס, מריץ מיגרציות + seed.
# מאמת שהסכמה וה-seed עולים נקי בלי להיות תלויים בפרויקט Supabase חי.
#
# בענן הזרימה היא:  supabase db reset  →  node scripts/seed-users.mjs
# כאן אין GoTrue, ולכן 01_local_users.sql ממלא את מקום הסקריפט.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists teichtal" >/dev/null
$PSQL -d postgres -c "create database teichtal" >/dev/null
echo "  → 00_local_auth_shim.sql"; $PSQL -d teichtal -f "$DIR/00_local_auth_shim.sql"
for f in "$DIR"/../migrations/*.sql; do
  echo "  → $(basename "$f")"; $PSQL -d teichtal -f "$f"
done
echo "  → seed.sql";            $PSQL -d teichtal -f "$DIR/../seed.sql"
echo "  → 01_local_users.sql";  $PSQL -d teichtal -f "$DIR/01_local_users.sql"
echo "db reset OK"
