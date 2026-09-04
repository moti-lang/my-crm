#!/usr/bin/env bash
# שלב 4 — כל חבילות ה-SQL מול הענן.
#
# אותם קבצים בדיוק שרצים מקומית. ההבדל היחיד הוא היעד.
# זהות המשתמשים נפתרת לפי תפקיד (t_user), ולכן ה-UUID שמייצר
# GoTrue אינו משנה.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# בלי חיבור Postgres ישיר (פורט 5432 חסום) — אותן חבילות דרך ה-Management API.
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  exec node "$DIR/run-cloud-api.mjs"
fi
: "${SUPABASE_DB_URL:?חסר SUPABASE_DB_URL (או SUPABASE_ACCESS_TOKEN)}"

fails=0
for suite in 02_rls_proof.sql 03_allocation_proof.sql 04_wa_dedupe_proof.sql \
             05_role_consistency_proof.sql 06_attendance_proof.sql \
             07_reminder_queue_proof.sql 08_command_rollback_proof.sql \
             11_allowlist_proof.sql 12_reports_proof.sql 13_attendance_link_hardening.sql; do
  echo "═══ $suite ═══"
  if PGOPTIONS="-c client_min_messages=warning" \
     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$DIR/$suite" 2>&1 \
       | grep -E '✓|✗|ERROR|═|עברו' | sed 's/^psql.*NOTICE:  //'; then
    :
  fi
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    echo "  ✗ $suite נפלה מול הענן"
    fails=$((fails+1))
  fi
done

echo "═══ מרוץ אישורים ═══"
PGURL="$SUPABASE_DB_URL" node "$DIR/command-race.test.mjs" || fails=$((fails+1))

echo "═══════════════════════════════════════"
[ "$fails" -eq 0 ] && echo "כל החבילות עברו מול הענן" || echo "$fails חבילות נפלו"
exit "$fails"
