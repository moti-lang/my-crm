#!/usr/bin/env bash
# תרגיל שחזור מלא — נוהל, לא בדיקה חד-פעמית. ראה docs/RESTORE.md.
#
#   ./scripts/restore-drill.sh [קובץ גיבוי]      (ברירת מחדל: האחרון ב-backups/)
#
# 1. "פרויקט" ריק: מסד חדש עם הסכמה בלבד (כל המיגרציות), בלי seed — כמו
#    פרויקט Supabase שנמחק ונבנה מחדש עם db push.
# 2. שחזור הגיבוי אליו (restore.mjs).
# 3. אימות שורה-שורה + זהויות, הרשאות, טוקנים, הגדרות (restore-verify.mjs).
# 4. חבילות ההרשאות (02, 05, 11) רצות על המסד המשוחזר — ההרשאות לא רק
#    "קיימות" אלא אוכפות.
# מודד את הזמן של כל שלב.
set -uo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-$(ls backups/teichtal-*.json 2>/dev/null | sort | tail -1)}"
[ -f "$FILE" ] || { echo "  ✗ אין קובץ גיבוי. npm run backup:pull"; exit 2; }
PG_HOST="${PGHOST:-/tmp}"; PG_PORT="${PGPORT:-5433}"; PG_USER="${PGUSER:-postgres}"
DB=teichtal_drill
PSQL="psql -h $PG_HOST -p $PG_PORT -U $PG_USER -v ON_ERROR_STOP=1 -q"
export PGOPTIONS="-c client_min_messages=warning"
T0=$(date +%s)
lap() { local now=$(date +%s); echo "    ⏱ $1: $((now - T_LAST)) שניות"; T_LAST=$now; }
T_LAST=$T0

echo "═══ תרגיל שחזור: $FILE ═══"
echo "── 1. פרויקט ריק (סכמה בלבד) ──"
$PSQL -d postgres -c "drop database if exists $DB" && $PSQL -d postgres -c "create database $DB" || exit 1
$PSQL -d $DB -f supabase/tests/00_local_auth_shim.sql || exit 1
for f in supabase/migrations/*.sql; do $PSQL -d $DB -f "$f" || { echo "  ✗ $f"; exit 1; }; done
echo "  ✓ $(ls supabase/migrations/*.sql | wc -l) מיגרציות, אפס נתונים"
lap "בניית הסכמה"

echo "── 2. שחזור ──"
export PGURL="postgresql://$PG_USER@localhost:$PG_PORT/$DB?host=$PG_HOST"
node scripts/restore.mjs "$FILE" --yes || exit 1
lap "שחזור"

echo "── 3. אימות מול הגיבוי ──"
node scripts/restore-verify.mjs "$FILE" || exit 1
lap "אימות"

echo "── 4. ההרשאות אוכפות על המסד המשוחזר ──"
for s in 02_rls_proof 05_role_consistency_proof 11_allowlist_proof; do
  $PSQL -d $DB -f "supabase/tests/$s.sql" >/tmp/drill.out 2>&1 && echo "  ✓ $s" || { echo "  ✗ $s"; grep -E '✗|ERROR' /tmp/drill.out | head -3; exit 1; }
done
lap "חבילות ההרשאות"
echo ""
echo "  ✓ תרגיל השחזור עבר. סה\"כ $(( $(date +%s) - T0 )) שניות."
