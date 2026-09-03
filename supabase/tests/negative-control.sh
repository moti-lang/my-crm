#!/usr/bin/env bash
# בקרת שלילה. בדיקה שתמיד עוברת אינה מוכיחה כלום.
# לכל חור: בונים מאפס, פותחים את החור בכוונה, ומוודאים שהחבילה נופלת.
# אם חור כלשהו לא מפיל את החבילה — לבדיקה הזו אין ערך והיא צריכה תיקון.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# ניתן להצביע על פוסטגרס אחר (CI) בלי לשנות את הסקריפטים.
PG_HOST="${PGHOST:-/tmp}"; PG_PORT="${PGPORT:-5433}"; PG_USER="${PGUSER:-postgres}"
PSQL="psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d teichtal -v ON_ERROR_STOP=1 -q"
fails=0
ran=0

SUITE="02_rls_proof.sql"

run_suite() {
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d teichtal -v ON_ERROR_STOP=1 \
    -f "$DIR/$SUITE" >/tmp/nc-suite.out 2>&1
}

expect_pass() {
  ran=$((ran+1))
  "$DIR/reset.sh" >/dev/null
  for s in 02_rls_proof.sql 03_allocation_proof.sql 04_wa_dedupe_proof.sql 05_role_consistency_proof.sql 06_attendance_proof.sql 07_reminder_queue_proof.sql 08_command_rollback_proof.sql 09_business_rules_proof.sql 10_portability_proof.sql 11_allowlist_proof.sql 12_reports_proof.sql; do
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

expect_fail_code "חשיפת מסך נוסף מחוץ לשער ההתחברות" \
  "$DIR/../../src/App.tsx" \
  'sed -i "s|<Route path=\"/a/:token\" element={<AttendanceSheet />} />|<Route path=\"/a/:token\" element={<AttendanceSheet />} />\\n          <Route path=\"/students\" element={<Students />} />|" "$F"' \
  "node supabase/tests/public-surface.test.mjs"

expect_fail_code "פתיחת הרשמה באימייל וסיסמה בקונפיג" \
  "$DIR/../config.toml" \
  'sed -i "/^\[auth.email\]/,/^\[/ s|enable_signup = false|enable_signup = true|" "$F"' \
  "node supabase/tests/public-surface.test.mjs"

expect_fail_code "כיבוי ספק גוגל בקונפיג" \
  "$DIR/../config.toml" \
  'sed -i "/^\[auth.external.google\]/,/^\[/ s|enabled = true|enabled = false|" "$F"' \
  "node supabase/tests/public-surface.test.mjs"

expect_fail_code "החזרת כניסה בסיסמה לקוד הלקוח" \
  "$DIR/../../src/auth/AuthProvider.tsx" \
  'sed -i "s|signOut: async () => {|signInLegacy: async (e: string, p: string) => { await supabase.auth.signInWithPassword({ email: e, password: p }); },\n    signOut: async () => {|" "$F"' \
  "node supabase/tests/public-surface.test.mjs"

expect_fail_code "Gate מכניס פרופיל מושבת" \
  "$DIR/../../src/App.tsx" \
  'sed -i "s/if (!profile || !profile.is_active)/if (!profile)/" "$F"' \
  "node supabase/tests/public-surface.test.mjs"

expect_fail_code "מסך המשתמשים נפתח לכל תפקיד" \
  "$DIR/../../src/App.tsx" \
  'sed -i "s/{profile.role === .owner. \&\& <Route path=\"\/users\"/{<Route path=\"\/users\"/" "$F"' \
  "node supabase/tests/public-surface.test.mjs"

# ─── רשימת המורשים: הדלת עצמה ───

expect_fail "הסרת השער מ-auth.users (כל אימייל בגוגל מקבל חשבון)" \
  "drop trigger auth_user_gate on auth.users" \
  "11_allowlist_proof.sql"

expect_fail "השער מתעלם מהספק (סיסמה למורשה עוברת)" \
  "\\i $DIR/holes/gate_no_provider_check.sql" \
  "11_allowlist_proof.sql"

expect_fail "auth_role מחזירה תפקיד גם למושבתת" \
  "\\i $DIR/holes/auth_role_ignores_inactive.sql" \
  "11_allowlist_proof.sql"

expect_fail "ניתוק הסנכרון רשימה → פרופיל (שינוי תפקיד לא נאכף)" \
  "drop trigger allowed_users_after on allowed_users" \
  "11_allowlist_proof.sql"

expect_fail "הסרת נעילת הבעלים האחרונה (נעילה בחוץ)" \
  "\\i $DIR/holes/no_last_owner_lock.sql" \
  "11_allowlist_proof.sql"

expect_fail "רשימת המורשים גלויה לכל מחובר" \
  "create policy hole_allowlist_read on allowed_users for select using (true)" \
  "11_allowlist_proof.sql"

expect_fail "ניטרול RLS על רשימת המורשים" \
  "alter table allowed_users disable row level security" \
  "11_allowlist_proof.sql"

# ─── דוחות סבב 8 ───

expect_fail "רווח הפקה סופר רשומות שנמחקו" \
  "\\i $DIR/holes/production_pnl_counts_deleted.sql" \
  "12_reports_proof.sql"

expect_fail "רווח אחרי הקצאה מתעלם מההקצאה" \
  "\\i $DIR/holes/profit_after_ignores_allocation.sql" \
  "12_reports_proof.sql"

expect_fail "דוח המרת הפניות נפתח למנהלת סניף" \
  "create or replace view v_lead_funnel as select date_trunc('month', s.created_at at time zone 'Asia/Jerusalem')::date as month, count(*) as leads, count(*) filter (where s.status='active') as converted, count(*) filter (where s.status='pending') as pending, count(*) filter (where s.status in ('stopped','graduated')) as lost, 0::numeric as conversion_pct from students s where s.source='whatsapp' and s.deleted_at is null group by 1" \
  "12_reports_proof.sql"

expect_fail_code "דוח מאבד את עמודות הייצוא שלו" \
  "$DIR/../../src/reports/definitions.ts" \
  'sed -i "/^export const LEADS/,/^};/ s/^  columns: \[/  columns: [] as never[], _c: [/" "$F"' \
  "node supabase/tests/reports-export.test.mjs"

expect_fail_code "הייצוא מוציא סכום כטקסט מעוצב במקום מספר" \
  "$DIR/../../src/reports/definitions.ts" \
  'sed -i "s/{ label: .רווח., value: (r) => n(r.profit), numeric: true },/{ label: \"רווח\", value: (r) => formatILS(n(r.profit)), numeric: true },/" "$F"' \
  "node supabase/tests/reports-export.test.mjs"

# ─── סוכן הלקוחות ───

expect_fail_code "הסרת שומר המחירים מהסוכן" \
  "$DIR/../../supabase/functions/_shared/customer.ts" \
  'sed -i "s/if (!mayQuotePrices \&\& quotesPrice(reply)) {/if (false) {/" "$F"' \
  "node supabase/tests/customer-agent.test.mjs"

expect_fail_code "הסוכן עונה גם בהשתלטות אנושית" \
  "$DIR/../../supabase/functions/_shared/customer.ts" \
  'sed -i "s/if (conversation?.is_human_takeover) {/if (false) {/" "$F"' \
  "node supabase/tests/customer-agent.test.mjs"

expect_fail_code "שאלה ללא מענה לא נרשמת ולא מתריעה" \
  "$DIR/../../supabase/functions/_shared/customer.ts" \
  'sed -i "s/if (answer.kind === .no_answer.) {/if (answer.kind === \"no_answer\") { return { route: \"customer_no_answer\", phone, reply: NO_ANSWER_REPLY }; }\n  if (false) {/" "$F"' \
  "node supabase/tests/customer-agent.test.mjs"

expect_fail_code "תלמידה נוצרת גם כשהליד לא שלם" \
  "$DIR/../../supabase/functions/_shared/customer.ts" \
  'sed -i "s/if (!isLeadComplete(merged) || !branch) {/if (!branch) {/" "$F"' \
  "node supabase/tests/customer-agent.test.mjs"

expect_fail_code "פלט פגום של המודל מגיע להורה" \
  "$DIR/../../supabase/functions/_shared/answer-schema.ts" \
  'sed -i "s/if (typeof v.reply !== .string.) problems.push(.reply: חייב להיות מחרוזת.);/problems.length = 0;/" "$F"' \
  "node supabase/tests/customer-agent.test.mjs"

expect_fail_code "wa-webhook מפסיק לנתב לקוחות לסוכן" \
  "$DIR/../../supabase/functions/wa-webhook/index.ts" \
  'sed -i "s/? await answerCustomer(db, { alert: (a) => alertOwner(db, a) }, { phone, body: message.body })/? decision/" "$F"' \
  "node supabase/tests/customer-agent.test.mjs"

expect_fail "JWT בלי פרופיל רואה סניפים" \
  "create policy hole_branches_any_jwt on branches for select using (auth.uid() is not null)" \
  "11_allowlist_proof.sql"

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

# ★ הקביים שהסתירו באג אמיתי: search_path של המסד שכולל extensions.
expect_fail "החזרת extensions ל-search_path של המסד (מסתיר אזכורים לא-מוסמכים)" \
  "alter database teichtal set search_path to public, extensions" \
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

# ★ הבקרה של הממצא: ניתוק החיבור בין ההחלטה לשליחה.
#    זה בדיוק המצב שהיה בייצור — ההחלטה חושבה ואיש לא שלח אותה.
expect_fail_code "ניתוק המסירה מ-wa-webhook" \
  "$DIR/../functions/wa-webhook/index.ts" \
  'sed -i "s|  const delivery = await deliverReply(|  const delivery = { delivered: false, reason: \"no_reply\" }; const _unused = (|" "$F"' \
  "node supabase/tests/reply-delivery.test.mjs"

expect_fail_code "deliverReply מפסיקה לשלוח בפועל" \
  "$DIR/../functions/_shared/reply.ts" \
  'sed -i "s|  const sent = await wa.sendText(phone, reply, idempotencyKey);|  const sent = { ok: true };|" "$F"' \
  "node supabase/tests/reply-delivery.test.mjs"

expect_fail_code "מסלול חדש בלי כיסוי מסירה" \
  "$DIR/../functions/_shared/router.ts" \
  "sed -i \"s|  const text = message.body.trim();|  const text = message.body.trim();\\n  if (text === '__NEW_ROUTE__') return { route: 'brand_new', caller: authorizedNumber, reply: 'x' } as never;|\" \"\$F\"" \
  "node supabase/tests/reply-delivery.test.mjs"

# ★ הכלל החדש: בדיקה שמחפשת מחרוזת שיכולה להופיע בהערה.
expect_fail_code "בדיקה שקוראת מקור בלי להסיר הערות" \
  "$DIR/ai-command-purity.test.mjs" \
  "sed -i \"s|import { codeOf } from './_code.mjs';|import { codeOf } from './_code.mjs';\\nimport { readFileSync } from 'node:fs';\\nconst _raw = readFileSync('package.json', 'utf8');|\" \"\$F\"" \
  "node supabase/tests/test-hygiene.test.mjs"

# ★ בקרות תקרת הזמן. הדרישה: קריאה שלא חוזרת לא משאירה את השולחת בשקט.
expect_fail_code "ביטול תקרת הזמן בקריאה למודל" \
  "$DIR/../functions/_shared/ai.ts" \
  'sed -i "s|const abort = new AbortController();|const abort = { signal: undefined, abort() {} }; // הוסר|" "$F"' \
  "node supabase/tests/ai-wire.test.mjs"

expect_fail_code "תלייה בלי תשובה לשולחת" \
  "$DIR/../functions/_shared/router.ts" \
  "sed -i \"s|      reply: 'רגע, בודקת…',|      reply: '',|\" \"\$F\"" \
  "node supabase/tests/command-router.test.mjs"

# ★ הבקרות של המסלול אל ה-API. שתיהן מכסות באג שעלה 60 קריאות כושלות.
expect_fail_code "החזרת output_config שה-API דוחה" \
  "$DIR/../functions/_shared/ai.ts" \
  'sed -i "s|        messages: \[{ role: .user., content: buildUserMessage(ctx) }\],|        messages: [{ role: \"user\", content: buildUserMessage(ctx) }],\\n        output_config: { format: { type: \"json_schema\", schema: {} } },|" "$F"' \
  "node supabase/tests/ai-wire.test.mjs"

expect_fail_code "ביטול חילוץ ה-JSON מהעטיפה" \
  "$DIR/../functions/_shared/command-schema.ts" \
  'sed -i "s|JSON.parse(extractJson(raw))|JSON.parse(raw)|" "$F"' \
  "node supabase/tests/command-router.test.mjs"

expect_fail_code "חיבור ערוץ ההתראות לוואטסאפ" \
  "$DIR/../functions/_shared/alerts.ts" \
  'printf "\\nexport async function badAlert(){ await fetch(\"/functions/v1/wa-send\"); }\\n" >> "$F"' \
  "node supabase/tests/alert-independence.test.mjs"

# ★ הבאג שהקביים הסתירו: מחלקת אופרטורים לא מוסמכת. על מסד טרי,
# בדיוק כמו פרויקט סופבייס חדש, מיגרציה 0001 נופלת.
expect_fail_code "אזכור לא-מוסמך לאובייקט מסכמת extensions" \
  "$DIR/../migrations/0001_init.sql" \
  'sed -i "s|full_name extensions\.gin_trgm_ops|full_name gin_trgm_ops|" "$F"' \
  "./supabase/tests/reset.sh"

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
