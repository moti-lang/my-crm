#!/usr/bin/env bash
# בקרת שלילה. בדיקה שתמיד עוברת אינה מוכיחה כלום.
# לכל חור: בונים מאפס, פותחים את החור בכוונה, ומוודאים שהחבילה נופלת.
# אם חור כלשהו לא מפיל את החבילה — לבדיקה הזו אין ערך והיא צריכה תיקון.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL="psql -h /tmp -p 5433 -U postgres -d teichtal -v ON_ERROR_STOP=1 -q"
fails=0

SUITE="02_rls_proof.sql"

run_suite() {
  psql -h /tmp -p 5433 -U postgres -d teichtal -v ON_ERROR_STOP=1 \
    -f "$DIR/$SUITE" >/tmp/nc-suite.out 2>&1
}

expect_pass() {
  "$DIR/reset.sh" >/dev/null
  for s in 02_rls_proof.sql 03_allocation_proof.sql 04_wa_dedupe_proof.sql; do
    SUITE="$s"
    if run_suite; then
      echo "  ✓ בסיס נקי: $s עוברת"
    else
      echo "  ✗ בסיס נקי: $s נופלת בלי שנפתח שום חור!"; fails=$((fails+1))
    fi
  done
}

# expect_fail <תיאור> <SQL שפותח את החור> [קובץ חבילה]
expect_fail() {
  local label="$1" sql="$2"
  SUITE="${3:-02_rls_proof.sql}"
  "$DIR/reset.sh" >/dev/null
  $PSQL -c "$sql" >/dev/null 2>&1 || { echo "  ! לא הצלחתי לפתוח את החור: $label"; fails=$((fails+1)); return; }
  if run_suite; then
    echo "  ✗ $label — החור נפתח והחבילה עדיין עברה. הבדיקה לא מכסה אותו!"
    fails=$((fails+1))
  else
    echo "  ✓ $label — החבילה נפלה כמצופה: $(grep -m1 '✗' /tmp/nc-suite.out | sed 's/^ *//')"
  fi
}

echo "בקרת שלילה"
echo "───────────────────────────────────────────────"
expect_pass

expect_fail "ניטרול RLS על students" \
  "alter table students disable row level security"

expect_fail "מנהלת יכולה לשנות את התפקיד של עצמה" \
  "create policy hole_profiles_update on profiles for update using (id = auth.uid()) with check (true)"

expect_fail "מנהלת יכולה לשייך את עצמה לכל סניף" \
  "create policy hole_bs_insert on branch_staff for insert with check (user_id = auth.uid())"

expect_fail "כל משתמש מחובר רואה את כל התלמידות" \
  "create policy hole_students_read on students for select using (true)"

expect_fail "רואת חשבון מקבלת גישה ישירה לטבלת students" \
  "create policy hole_acct_students on students for select using (auth_role() = 'accountant')"

expect_fail "החזרת באג העיגול בחלוקת ההוצאות" \
  "\\i $DIR/holes/old_rounding_allocation.sql" \
  "03_allocation_proof.sql"

expect_fail "הסרת האינדקס שמונע הודעות כפולות" \
  "drop index wa_messages_provider_msg_id_uniq" \
  "04_wa_dedupe_proof.sql"

expect_fail "החזרת חלוקת ההוצאות להרשאות הקורא (מספר שגוי לרואת חשבון)" \
  "alter function f_general_allocation(uuid) security invoker"

# ─── חורים ברמת הקוד, לא ברמת המסד ───
# expect_fail_code <תיאור> <קובץ> <שורה לזריקה> <פקודת בדיקה>
expect_fail_code() {
  local label="$1" file="$2" inject="$3" cmd="$4"
  cp "$file" "$file.bak"
  printf '\n%s\n' "$inject" >> "$file"
  if (cd "$DIR/../.." && eval "$cmd") >/dev/null 2>&1; then
    echo "  ✗ $label — החור נפתח והבדיקה עדיין עברה!"
    fails=$((fails+1))
  else
    echo "  ✓ $label — הבדיקה נפלה כמצופה"
  fi
  mv "$file.bak" "$file"
}

expect_fail_code "חיבור ערוץ ההתראות לוואטסאפ" \
  "$DIR/../functions/_shared/alerts.ts" \
  'export async function badAlert(){ await fetch("/functions/v1/wa-send"); }' \
  "node supabase/tests/alert-independence.test.mjs"

"$DIR/reset.sh" >/dev/null
echo "───────────────────────────────────────────────"
if [ "$fails" -eq 0 ]; then
  echo "כל בקרות השלילה עברו — כל חור מפיל את החבילה"
else
  echo "$fails בקרות שלילה נכשלו"; exit 1
fi
