#!/usr/bin/env bash
# סבב האבטחה — לפני כל מסירה ללקוחה. שש הקטגוריות ב-SECURITY.md.
# מריץ את החלק האוטומטי; מה שדורש עיניים כתוב שם.
set -uo pipefail
cd "$(dirname "$0")/.."
F=0; s() { echo ""; echo "═══ $1 ═══"; }; r() { "$@" || F=1; }

s "1 · קישור הנוכחות (06, 13)"
./supabase/tests/reset.sh >/dev/null 2>&1 || { echo "  ✗ reset.sh"; exit 1; }
for f in 06_attendance_proof 13_attendance_link_hardening; do
  psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d teichtal -v ON_ERROR_STOP=1 -f "supabase/tests/$f.sql" >/tmp/sec.out 2>&1 \
    && echo "  ✓ $f" || { echo "  ✗ $f"; grep -E '✗|ERROR' /tmp/sec.out | head -3; F=1; }
done
s "2 · הזרקה ו-XSS (ייצוא, ייבוא, סוכן)"
r node supabase/tests/reports-export.test.mjs >/dev/null && echo "  ✓ הזרקת נוסחאות בייצוא"
r node supabase/tests/students-import.test.mjs >/dev/null && echo "  ✓ ייבוא"
r node supabase/tests/customer-agent.test.mjs >/dev/null && echo "  ✓ סוכן: פלט פגום לא מגיע להורה"
grep -rn "dangerouslySetInnerHTML\|innerHTML" src && { echo "  ✗ innerHTML בקוד"; F=1; } || echo "  ✓ אין innerHTML"
s "3 · גבולות הרשאה (02, 05, 11, 12)"
for f in 02_rls_proof 05_role_consistency_proof 11_allowlist_proof 12_reports_proof; do
  psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d teichtal -v ON_ERROR_STOP=1 -f "supabase/tests/$f.sql" >/tmp/sec.out 2>&1 \
    && echo "  ✓ $f" || { echo "  ✗ $f"; F=1; }
done
s "4 · חשוף בלי התחברות (10, שומרי פונקציות, משטח ציבורי)"
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d teichtal -v ON_ERROR_STOP=1 -f supabase/tests/10_portability_proof.sql >/tmp/sec.out 2>&1 && echo "  ✓ 10_portability_proof" || { echo "  ✗ 10_portability_proof"; F=1; }
r node supabase/tests/function-guards.test.mjs >/dev/null && echo "  ✓ כל פונקציה עם שומר"
r node supabase/tests/public-surface.test.mjs >/dev/null && echo "  ✓ משטח ציבורי: דף אחד"
s "5 · סודות (ריפו, בילד, היסטוריה)"
PAT='sk-ant-[A-Za-z0-9_-]{20,}|sbp_[0-9a-f]{20,}|nfp_[A-Za-z0-9]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC )?PRIVATE KEY'
git log -p --all | grep -qE "$PAT" && { echo "  ✗ סוד בהיסטוריית הגיט"; F=1; } || echo "  ✓ היסטוריית הגיט נקייה"
grep -rqE "$PAT" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=backups --exclude=.env.verify --exclude=.env.local . && { echo "  ✗ סוד בעץ העבודה"; F=1; } || echo "  ✓ עץ העבודה נקי"
[ -d dist ] && { node scripts/check-secrets.mjs --dist >/dev/null 2>&1 && echo "  ✓ dist/ נקי" || { echo "  ✗ dist/"; F=1; }; }
s "6 · הסוכן (בידוד ההקשר)"
r node supabase/tests/ai-command-purity.test.mjs >/dev/null && echo "  ✓ ai-answer ו-ai-command בלי מסד"
grep -qE "from\('(students|payments|v_student|ledger)" supabase/functions/_shared/customer.ts && grep -qE "from\('students'\)\.insert" supabase/functions/_shared/customer.ts && ! grep -qE "from\('(students|payments|v_student|ledger)[^']*'\)\.select" supabase/functions/_shared/customer.ts && echo "  ✓ הסוכן כותב ליד אבל לא קורא תלמידות/תשלומים" || { echo "  ✗ הסוכן קורא מטבלאות אישיות"; F=1; }
echo ""
echo "═══════════════════════════════════════"
[ "$F" -eq 0 ] && echo " החלק האוטומטי של סבב האבטחה עבר. עכשיו החלק הידני ב-SECURITY.md, ושלב 8 של סבב האימות מול הענן." || echo " סבב האבטחה נכשל — ראה למעלה"
exit "$F"
