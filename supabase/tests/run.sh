#!/usr/bin/env bash
# מריץ את כל חבילות הבדיקה מול הפוסטגרס המקומי.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# ניתן להצביע על פוסטגרס אחר (CI) בלי לשנות את הסקריפטים.
PG_HOST="${PGHOST:-/tmp}"; PG_PORT="${PGPORT:-5433}"; PG_USER="${PGUSER:-postgres}"

# בדיקת node: הפלט מסונן, אבל כשל אינו שקט. הלקח מ-CI: בדיקה שקרסה לפני
# שהדפיסה שורה אחת נראתה כמו "אין פלט", ו-grep ריק הפיל את הריצה בלי
# להגיד למה. עכשיו כשל מדפיס את מה שהבדיקה אמרה, כולל השגיאה עצמה.
node_test() {
  local file="$1" pattern="$2" out
  if out=$(node "$DIR/$file" 2>&1); then
    echo "$out" | grep -E "$pattern" || true
  else
    echo "$out" | grep -E "✗|$pattern" || true
    echo "  ✗ $file נפלה — הפלט האחרון:"
    echo "$out" | tail -15 | sed 's/^/    /'
    return 1
  fi
}
for suite in 02_rls_proof.sql 03_allocation_proof.sql 04_wa_dedupe_proof.sql 05_role_consistency_proof.sql 06_attendance_proof.sql 07_reminder_queue_proof.sql 08_command_rollback_proof.sql 09_business_rules_proof.sql 10_portability_proof.sql 11_allowlist_proof.sql 12_reports_proof.sql 13_attendance_link_hardening.sql; do
  echo "═══ $suite ═══"
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d teichtal -v ON_ERROR_STOP=1 -f "$DIR/$suite" 2>&1 \
    | grep -E '✓|✗|ERROR|═|עברו|עקביים|:$' | sed 's/^psql.*NOTICE:  //'
done

echo "═══ משטח ציבורי ═══"
node_test "public-surface.test.mjs" "✓|✗|משטח|נכשלו"

echo "═══ שומרי הפונקציות ═══"
node_test "function-guards.test.mjs" "✗|מוגנות|נכשלו"

echo "═══ סודות בצד הלקוח ═══"
(cd "$DIR/../.." && node scripts/check-secrets.mjs) 2>&1 | grep -E "✓|✗|סודות|דליפות"

echo "═══ כיסוי פונקציות ═══"
node_test "function-coverage.test.mjs" "✓|✗|לכל פונקציה|ללא בדיקה"

echo "═══ הבקשה ל-API ═══"
node_test "ai-wire.test.mjs" "✓|✗|!|תקינה|נכשלו"

echo "═══ מסירת התשובות ═══"
node_test "reply-delivery.test.mjs" "✓|✗|מגיע לשליחה|נכשלו" | grep -v AI_DRY_RUN

echo "═══ היגיינת הבדיקות ═══"
node_test "test-hygiene.test.mjs" "✗|היגיינת|נכשלו"

echo "═══ טוהר ai-command ═══"
node_test "ai-command-purity.test.mjs" "✓|✗|נקייה|נכשלו"

echo "═══ נתב הפקודות ═══"
node_test "command-router.test.mjs" "✓|✗|עברו|נכשלו" | grep -v AI_DRY_RUN

echo "═══ מרוץ אישורים ═══"
node_test "command-race.test.mjs" "✓|✗|עברו|נכשלו"

echo "═══ מנוע התבניות ═══"
node_test "template-parity.test.mjs" "✓|✗|זהים|הבדלים"

echo "═══ סוכן הלקוחות ═══"
node_test "customer-agent.test.mjs" "✗|התרחישים|נכשלו"

echo "═══ ייצוא הדוחות ═══"
node_test "reports-export.test.mjs" "✗|מייצאים|נכשלו"

echo "═══ ייבוא תלמידות ═══"
node_test "students-import.test.mjs" "✗|ייבוא:|נכשלו"

echo "═══ הגיבוי היומי ═══"
node_test "backup-mail.test.mjs" "✗|ההחלטות|נכשלו"

echo "═══ גיבוי ושחזור ═══"
node_test "backup-roundtrip.test.mjs" "✗|זהה למקור|נכשלו"

echo "═══ חוזה whatsapp-hub ═══"
node_test "wa-contract.test.mjs" "✓|✗|עברו|נכשלו"
