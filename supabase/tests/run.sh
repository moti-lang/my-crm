#!/usr/bin/env bash
# מריץ את כל חבילות הבדיקה מול הפוסטגרס המקומי.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
for suite in 02_rls_proof.sql 03_allocation_proof.sql 04_wa_dedupe_proof.sql 05_role_consistency_proof.sql 06_attendance_proof.sql 07_reminder_queue_proof.sql 08_command_rollback_proof.sql 09_business_rules_proof.sql 10_portability_proof.sql; do
  echo "═══ $suite ═══"
  psql -h /tmp -p 5433 -U postgres -d teichtal -v ON_ERROR_STOP=1 -f "$DIR/$suite" 2>&1 \
    | grep -E '✓|✗|ERROR|═|עברו|עקביים|:$' | sed 's/^psql.*NOTICE:  //'
done

echo "═══ משטח ציבורי ═══"
node "$DIR/public-surface.test.mjs" 2>&1 | grep -E "✓|✗|משטח|נכשלו"

echo "═══ סודות בצד הלקוח ═══"
(cd "$DIR/../.." && node scripts/check-secrets.mjs) 2>&1 | grep -E "✓|✗|סודות|דליפות"

echo "═══ כיסוי פונקציות ═══"
node "$DIR/function-coverage.test.mjs" 2>&1 | grep -E "✓|✗|לכל פונקציה|ללא בדיקה"

echo "═══ הבקשה ל-API ═══"
node "$DIR/ai-wire.test.mjs" 2>&1 | grep -E "✓|✗|!|תקינה|נכשלו"

echo "═══ טוהר ai-command ═══"
node "$DIR/ai-command-purity.test.mjs" 2>&1 | grep -E "✓|✗|נקייה|נכשלו"

echo "═══ נתב הפקודות ═══"
node "$DIR/command-router.test.mjs" 2>&1 | grep -E "✓|✗|עברו|נכשלו" | grep -v AI_DRY_RUN

echo "═══ מרוץ אישורים ═══"
node "$DIR/command-race.test.mjs" 2>&1 | grep -E "✓|✗|עברו|נכשלו"

echo "═══ מנוע התבניות ═══"
node "$DIR/template-parity.test.mjs" 2>&1 | grep -E "✓|✗|זהים|הבדלים"

echo "═══ חוזה whatsapp-hub ═══"
node "$DIR/wa-contract.test.mjs" 2>&1 | grep -E "✓|✗|עברו|נכשלו"
