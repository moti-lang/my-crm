#!/usr/bin/env bash
# בקרת שלילה. בדיקה שתמיד עוברת אינה מוכיחה כלום.
# לכל חור: בונים מאפס, פותחים את החור בכוונה, ומוודאים שהחבילה נופלת.
# אם חור כלשהו לא מפיל את החבילה — לבדיקה הזו אין ערך והיא צריכה תיקון.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL="psql -h /tmp -p 5433 -U postgres -d teichtal -v ON_ERROR_STOP=1 -q"
fails=0
ran=0

SUITE="02_rls_proof.sql"

run_suite() {
  psql -h /tmp -p 5433 -U postgres -d teichtal -v ON_ERROR_STOP=1 \
    -f "$DIR/$SUITE" >/tmp/nc-suite.out 2>&1
}

expect_pass() {
  ran=$((ran+1))
  "$DIR/reset.sh" >/dev/null
  for s in 02_rls_proof.sql 03_allocation_proof.sql 04_wa_dedupe_proof.sql 05_role_consistency_proof.sql 06_attendance_proof.sql 07_reminder_queue_proof.sql 08_command_rollback_proof.sql 09_business_rules_proof.sql 10_portability_proof.sql; do
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
  ran=$((ran+1))
  local label="$1" sql="$2"
  SUITE="${3:-02_rls_proof.sql}"
  "$DIR/reset.sh" >/dev/null
  $PSQL -c "$sql" >/dev/null 2>&1 || { echo "  ! לא הצלחתי לפתוח את החור: $label"; fails=$((fails+1)); return; }
  if [[ "$SUITE" == __NODE__* ]]; then
    local cmd="${SUITE#__NODE__ }"
    if (cd "$DIR/../.." && eval "$cmd") >/tmp/nc-suite.out 2>&1; then
      echo "  ✗ $label — החור נפתח והבדיקה עדיין עברה!"
      fails=$((fails+1))
    else
      echo "  ✓ $label — הבדיקה נפלה כמצופה: $(grep -m1 '✗' /tmp/nc-suite.out | sed 's/^ *//')"
    fi
    return
  fi
  if run_suite; then
    echo "  ✗ $label — החור נפתח והחבילה עדיין עברה. הבדיקה לא מכסה אותו!"
    fails=$((fails+1))
  else
    echo "  ✓ $label — החבילה נפלה כמצופה: $(grep -m1 '✗' /tmp/nc-suite.out | sed 's/^ *//')"
  fi
}

# expect_fail_code <תיאור> <קובץ> <פקודת שינוי> <פקודת בדיקה>
# פקודת השינוי מקבלת את נתיב הקובץ ב-$F ומשנה אותו במקום.
expect_fail_code() {
  ran=$((ran+1))
  local label="$1" file="$2" mutate="$3" cmd="$4"
  cp "$file" "$file.bak"
  if ! (export F="$file"; eval "$mutate") >/dev/null 2>&1; then
    echo "  ! לא הצלחתי לפתוח את החור: $label"; fails=$((fails+1))
    mv "$file.bak" "$file"; return
  fi
  if cmp -s "$file" "$file.bak"; then
    echo "  ! השינוי לא שינה את הקובץ: $label"; fails=$((fails+1))
    mv "$file.bak" "$file"; return
  fi
  if (cd "$DIR/../.." && eval "$cmd") >/dev/null 2>&1; then
    echo "  ✗ $label — החור נפתח והבדיקה עדיין עברה!"
    fails=$((fails+1))
  else
    echo "  ✓ $label — הבדיקה נפלה כמצופה"
  fi
  mv "$file.bak" "$file"
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

expect_fail "החזרת הדוחות הכספיים לתלות ב-RLS של students" \
  "\\i $DIR/holes/invoker_financial_views.sql" \
  "05_role_consistency_proof.sql"

expect_fail "ריקון הנתונים — בדיקת עקביות שמשווה שני אפסים" \
  "delete from payments" \
  "05_role_consistency_proof.sql"

expect_fail "פתיחת טבלת students בפני anon" \
  "grant select on students to anon" \
  "06_attendance_proof.sql"

expect_fail_code "פונקציה חדשה בלי בדיקה חיובית" \
  "$DIR/../migrations/0013_function_privileges.sql" \
  'printf "\\ncreate or replace function rpc_untested_example() returns int language sql as \$\$ select 1 \$\$;\\n" >> "$F"' \
  "./supabase/tests/reset.sh >/dev/null 2>&1 && node supabase/tests/function-coverage.test.mjs"

expect_fail "פתיחת פונקציית RPC ל-anon" \
  "grant execute on function rpc_execute_command(uuid) to anon" \
  "10_portability_proof.sql"

expect_fail "ביטול נעילת search_path בפונקציה security definer" \
  "alter function rpc_attendance_sheet(text) reset search_path" \
  "10_portability_proof.sql"

expect_fail "החזרת ההרחבות ל-public (shim לא נאמן)" \
  "alter extension pgcrypto set schema public" \
  "10_portability_proof.sql"

expect_fail "ביטול חסימת אישור הצילום" \
  "drop trigger production_cast_consent on production_cast" \
  "09_business_rules_proof.sql"

expect_fail "ביטול טריגר updated_at" \
  "drop trigger students_touch on students" \
  "09_business_rules_proof.sql"

expect_fail "החזרת התלות ב-pgcrypto בסכמה שאינה קיימת בענן" \
  "\\i $DIR/holes/pgcrypto_search_path.sql" \
  "06_attendance_proof.sql"

expect_fail "הסרת בדיקת שיוך השיעור לסניף בדיווח הנוכחות" \
  "\\i $DIR/holes/attendance_no_branch_check.sql" \
  "06_attendance_proof.sql"

# ─── חורים ברמת הקוד, לא ברמת המסד ───

expect_fail "הסרת מפתח הייחודיות של התזכורות (הצפת הורים)" \
  "drop index reminders_dedupe_idx" \
  "07_reminder_queue_proof.sql"

# ★ הבקרות המרכזיות של סבב 6ב.
expect_fail "ביטול התפיסה האטומית באישור (הוצאה נרשמת פעמיים)" \
  "create or replace function rpc_execute_command(p_command_id uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$f\$
   declare c commands; f jsonb; v_season uuid; v_branch uuid; v_id uuid;
   begin
     select * into c from commands where id = p_command_id;
     if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
     update commands set status='applied', confirmed_at=now() where id = p_command_id;
     f := coalesce(c.parsed -> 'fields', '{}'::jsonb);
     select id into v_season from seasons where is_current;
     select id into v_branch from branches where name = f ->> 'branch' and deleted_at is null;
     insert into ledger_entries (season_id, kind, scope, branch_id, entry_date, category, amount, source)
     values (v_season, 'expense', 'branch', v_branch, current_date, coalesce(f ->> 'category','אחר'), (f ->> 'amount')::numeric, 'whatsapp')
     returning id into v_id;
     update commands set result_table='ledger_entries', result_id=v_id where id=c.id;
     return jsonb_build_object('ok', true, 'result_table', 'ledger_entries', 'result_id', v_id);
   end \$f\$" \
  "__NODE__ node supabase/tests/command-race.test.mjs"

expect_fail "ביטול בדיקת פקיעת התוקף" \
  "create or replace function rpc_execute_command(p_command_id uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$f\$
   declare c commands; f jsonb; v_season uuid; v_branch uuid; v_id uuid;
   begin
     update commands set status='applied', confirmed_at=now()
      where id = p_command_id and status='pending_confirm' returning * into c;
     if not found then return jsonb_build_object('ok', false, 'reason', 'already_handled'); end if;
     f := coalesce(c.parsed -> 'fields', '{}'::jsonb);
     select id into v_season from seasons where is_current;
     select id into v_branch from branches where name = f ->> 'branch' and deleted_at is null;
     insert into ledger_entries (season_id, kind, scope, branch_id, entry_date, category, amount, source)
     values (v_season, 'expense', 'branch', v_branch, current_date, coalesce(f ->> 'category','אחר'), (f ->> 'amount')::numeric, 'whatsapp')
     returning id into v_id;
     update commands set result_table='ledger_entries', result_id=v_id where id=c.id;
     return jsonb_build_object('ok', true, 'result_table','ledger_entries','result_id', v_id);
   end \$f\$" \
  "__NODE__ node supabase/tests/command-race.test.mjs"

expect_fail "ביטול שאינו מחזיר את המצב הקודם של תלמידה" \
  "create or replace function rpc_cancel_command(p_command_id uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$f\$
   declare c commands;
   begin
     update commands set status='cancelled'
      where id = p_command_id and status='applied' returning * into c;
     if not found then return jsonb_build_object('ok', false, 'reason','not_applied'); end if;
     if c.result_table = 'ledger_entries' then update ledger_entries set deleted_at=now() where id=c.result_id;
     elsif c.result_table = 'payments' then update payments set deleted_at=now() where id=c.result_id;
     elsif c.result_table = 'reminders' then update reminders set status='cancelled' where id=c.result_id;
     elsif c.result_table = 'students' then update students set deleted_at=now() where id=c.result_id;
     end if;
     return jsonb_build_object('ok', true);
   end \$f\$" \
  "08_command_rollback_proof.sql"

# ★ הבקרה המרכזית של סבב 6א: כתיבה למסד בתוך מסלול כישלון הפרסור.
expect_fail_code "כתיבה למסד בתוך מסלול כישלון הפרסור" \
  "$DIR/../functions/_shared/router.ts" \
  'sed -i "s|    return { route: .command_parse_failed., caller: authorizedNumber, parse };|    await db.from(\"commands\").insert({ phone: message.phone, raw_text: message.body, status: \"failed\" }); return { route: \"command_parse_failed\", caller: authorizedNumber, parse };|" "$F"' \
  "node supabase/tests/command-router.test.mjs"

expect_fail_code "לקוח מסד בתוך ai-command" \
  "$DIR/../functions/ai-command/index.ts" \
  'sed -i "1i import { adminClient } from \"../_shared/supabase.ts\";" "$F"' \
  "node supabase/tests/ai-command-purity.test.mjs"

expect_fail_code "ביטול סף הביטחון" \
  "$DIR/../functions/_shared/command-schema.ts" \
  'sed -i "s|export const MIN_CONFIDENCE = 0.6;|export const MIN_CONFIDENCE = 0;|" "$F"' \
  "node supabase/tests/command-router.test.mjs"

expect_fail_code "ביטול בדיקת המחיקה בהרשאות" \
  "$DIR/../functions/_shared/authorize.ts" \
  'sed -i "s|if (isDeletion(command) \&\& !caller.can_delete) {|if (false) {|" "$F"' \
  "node supabase/tests/command-router.test.mjs"

expect_fail_code "ביטול הגבלת scope=finance" \
  "$DIR/../functions/_shared/authorize.ts" \
  "sed -i \"s|if (caller.scope === 'finance' \&\& !FINANCE_INTENTS.has(command.intent)) {|if (false) {|\" \"\$F\"" \
  "node supabase/tests/command-router.test.mjs"

expect_fail_code "שינוי מנוע התבניות בצד אחד בלבד" \
  "$DIR/../functions/_shared/template.ts" \
  'sed -i "s/    .trim();/    ;/" "$F"' \
  "node supabase/tests/template-parity.test.mjs"

expect_fail_code "חיבור ערוץ ההתראות לוואטסאפ" \
  "$DIR/../functions/_shared/alerts.ts" \
  'printf "\\nexport async function badAlert(){ await fetch(\"/functions/v1/wa-send\"); }\\n" >> "$F"' \
  "node supabase/tests/alert-independence.test.mjs"

"$DIR/reset.sh" >/dev/null
# ★ אימות שהסקריפט עצמו לא בלע בקרה.
# פונקציה שהוגדרה אחרי הקריאה נותנת "command not found" ש-bash
# מדפיס לשגיאה וממשיך — והסקריפט היה מדווח שהכל עבר בזמן שבקרה
# שלמה לא רצה. זה בדיוק הדפוס שאנחנו מחפשים, ברמת הסקריפט.
expected=$(grep -cE '^expect_(pass|fail|fail_code)( |$)' "$0")
echo "───────────────────────────────────────────────"
if [ "$ran" -ne "$expected" ]; then
  echo "  ✗ רצו $ran בקרות מתוך $expected שמוגדרות בקובץ — אחת נבלעה"
  fails=$((fails + expected - ran))
fi
if [ "$fails" -eq 0 ]; then
  echo "כל בקרות השלילה עברו — כל חור מפיל את החבילה"
else
  echo "$fails בקרות שלילה נכשלו"; exit 1
fi
