#!/usr/bin/env bash
# מדמה `supabase db reset` על פוסטגרס מקומי: מפיל, בונה מאפס, מריץ מיגרציות + seed.
#
# ה-shim מחקה את סופבייס גם במבנה הסכמות — הרחבות ב-extensions ולא
# ב-public — כדי שכשל שתלוי בכך ייתפס כאן ולא בענן.
#
# בענן הזרימה היא:  supabase db push  →  node scripts/seed-users.mjs
# כאן אין GoTrue, ולכן 01_local_users.sql ממלא את מקום הסקריפט.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export PGOPTIONS="-c client_min_messages=warning"
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
