-- 08_command_rollback_proof.sql — ביטול הפיך באמת.
--
-- הטענה: לכל intent, ביצוע ואז ביטול מחזירים את המסד **בדיוק** למצב
-- הקודם. לא "השורה נמחקה" — אלא שכל מה שנגזר ממנה חזר: יתרת התלמידה,
-- רווחיות הסניף, מספר החייבות, סך התשלומים.
--
-- הצילום נלקח כאובייקט אחד ומושווה כאובייקט אחד. כך שדה שנשכח
-- מפיל את הבדיקה, במקום להיות מכוסה בטעות.

\set ON_ERROR_STOP on
\ir _assert.sql
\set OWNER ''t_user('owner'::user_role)''

/** צילום מלא של המצב הכספי. נקרא בזהות הבעלים כדי שהתצוגות יחזירו נתונים. */
create or replace function t_snapshot()
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    t_claims('owner'::user_role), true);
  select jsonb_build_object(
    'ledger_count',   (select count(*) from ledger_entries where deleted_at is null),
    'ledger_sum',     (select coalesce(sum(amount),0) from ledger_entries where deleted_at is null),
    'payments_count', (select count(*) from payments where deleted_at is null),
    'payments_sum',   (select coalesce(sum(amount),0) from payments where deleted_at is null),
    'students_count', (select count(*) from students where deleted_at is null),
    'reminders_open', (select count(*) from reminders where status = 'scheduled'),
    'balances',       (select coalesce(jsonb_object_agg(full_name, balance), '{}'::jsonb)
                         from v_student_balance),
    'branch_pnl',     (select coalesce(jsonb_object_agg(name,
                                jsonb_build_object('income', income_students + income_other,
                                                   'expenses', expenses,
                                                   'debt', open_debt)), '{}'::jsonb)
                         from v_branch_pnl),
    'debtors',        (select count(*) from v_debtors),
    'student_rows',   (select coalesce(jsonb_object_agg(full_name,
                                jsonb_build_object('status', status, 'grade', grade,
                                                   'phone', parent_phone,
                                                   'tuition', tuition_total, 'notes', notes)), '{}'::jsonb)
                         from students where deleted_at is null)
  ) into v;
  return v;
end $$;

/** מריץ פקודה, מבטל אותה, ומוודא שהצילום זהה. */
create or replace function t_roundtrip(p_label text, p_intent text, p_fields jsonb)
returns void language plpgsql as $$
declare v_before jsonb; v_after jsonb; v_mid jsonb; v_cmd uuid; v_exec jsonb; v_cancel jsonb;
begin
  v_before := t_snapshot();

  v_cmd := rpc_create_pending_command('972501234567', p_label,
    jsonb_build_object('intent', p_intent, 'confidence', 0.95, 'fields', p_fields,
                       'missing', '[]'::jsonb, 'human_summary', p_label),
    p_intent);

  v_exec := rpc_execute_command(v_cmd);
  if not (v_exec ->> 'ok')::boolean then
    raise exception E'\n  ✗ % — הביצוע נכשל: %', p_label, v_exec;
  end if;

  v_mid := t_snapshot();
  if v_mid = v_before then
    raise exception E'\n  ✗ % — הביצוע לא שינה דבר. הבדיקה ריקה.', p_label;
  end if;

  v_cancel := rpc_cancel_command(v_cmd);
  if not (v_cancel ->> 'ok')::boolean then
    raise exception E'\n  ✗ % — הביטול נכשל: %', p_label, v_cancel;
  end if;

  v_after := t_snapshot();

  if v_after is distinct from v_before then
    raise exception E'\n  ✗ ★ % — המסד לא חזר למצב הקודם\n    לפני: %\n    אחרי: %',
      p_label,
      (select jsonb_object_agg(k, v) from jsonb_each(v_before) where v_before -> k is distinct from v_after -> k),
      (select jsonb_object_agg(k, v) from jsonb_each(v_after)  where v_before -> k is distinct from v_after -> k);
  end if;

  raise notice '  ✓ ★ % — בוצע, בוטל, והמצב זהה', p_label;
end $$;

begin;

\echo 'ביצוע וביטול לכל כוונה:'
select t_roundtrip('הוצאה בסניף', 'expense',
  '{"amount": 860, "branch": "ביתר עילית", "category": "תלבושות", "vendor": "אולפני תפארת"}'::jsonb);

select t_roundtrip('הוצאה כללית (בלי סניף)', 'expense',
  '{"amount": 1500, "branch": null, "category": "אחר"}'::jsonb);

select t_roundtrip('הכנסה', 'income',
  '{"amount": 5000, "branch": null, "category": "חסויות", "description": "חסות"}'::jsonb);

-- ★ הבדיקה המרכזית: תשלום משנה יתרה, רווחיות סניף ומספר חייבות.
-- ביטול חייב להחזיר את שלושתם.
select t_roundtrip('תשלום', 'payment',
  '{"student_name": "אסתי וייס", "amount": 2000, "method": "bit"}'::jsonb);

select t_roundtrip('תשלום חלקי', 'payment',
  '{"student_name": "אסתי וייס", "amount": 500, "method": "cash"}'::jsonb);

select t_roundtrip('תלמידה חדשה', 'new_student',
  '{"full_name": "בדיקה חדשה", "branch": "ביתר עילית", "grade": "ד",
    "parent_name": "אמא", "parent_phone": "972521000099", "tuition": 2000}'::jsonb);

select t_roundtrip('תזכורת', 'reminder',
  '{"target": "רחלי", "phone": "972521000001", "body": "תזכורת בדיקה", "offset_days": 1}'::jsonb);

\echo 'עדכון תלמידה — כל שדה בנפרד:'
select t_roundtrip('עדכון סטטוס', 'update_student',
  '{"student_name": "שירה כהן", "field": "status", "value": "stopped"}'::jsonb);
select t_roundtrip('עדכון כיתה', 'update_student',
  '{"student_name": "שירה כהן", "field": "grade", "value": "ז"}'::jsonb);
select t_roundtrip('עדכון טלפון', 'update_student',
  '{"student_name": "שירה כהן", "field": "parent_phone", "value": "972529999999"}'::jsonb);
-- ★ שינוי שכר לימוד משנה את היתרה. ביטול חייב להחזיר גם אותה.
select t_roundtrip('עדכון שכר לימוד', 'update_student',
  '{"student_name": "שירה כהן", "field": "tuition_total", "value": 3500}'::jsonb);
select t_roundtrip('עדכון הערות', 'update_student',
  '{"student_name": "שירה כהן", "field": "notes", "value": "הערה חדשה"}'::jsonb);

\echo 'רצף פעולות:'
-- שלוש פקודות, ביטול בסדר הפוך — כל אחת מחזירה את השכבה שלה.
do $$
declare v0 jsonb; c1 uuid; c2 uuid; c3 uuid;
begin
  v0 := t_snapshot();
  c1 := rpc_create_pending_command('972501234567','א',
    '{"intent":"expense","confidence":0.9,"fields":{"amount":100,"branch":"ביתר עילית","category":"כיבוד"},"missing":[],"human_summary":"א"}'::jsonb,'expense');
  perform rpc_execute_command(c1);
  c2 := rpc_create_pending_command('972501234567','ב',
    '{"intent":"payment","confidence":0.9,"fields":{"student_name":"מלכי ברגר","amount":300,"method":"cash"},"missing":[],"human_summary":"ב"}'::jsonb,'payment');
  perform rpc_execute_command(c2);
  c3 := rpc_create_pending_command('972501234567','ג',
    '{"intent":"expense","confidence":0.9,"fields":{"amount":250,"branch":"אשדוד","category":"אחר"},"missing":[],"human_summary":"ג"}'::jsonb,'expense');
  perform rpc_execute_command(c3);

  perform rpc_cancel_command(c3);
  perform rpc_cancel_command(c2);
  perform rpc_cancel_command(c1);

  if t_snapshot() is distinct from v0 then
    raise exception E'\n  ✗ ★ רצף של שלוש פעולות לא הוחזר במלואו';
  end if;
  raise notice '  ✓ ★ שלוש פעולות בוטלו והמצב חזר במדויק';
end $$;

\echo 'מקרי קצה בביטול:'
do $$
declare v_cmd uuid; r jsonb;
begin
  v_cmd := rpc_create_pending_command('972501234567','ישן',
    '{"intent":"expense","confidence":0.9,"fields":{"amount":90,"branch":"ביתר עילית","category":"אחר"},"missing":[],"human_summary":"x"}'::jsonb,'expense');
  perform rpc_execute_command(v_cmd);
  update commands set created_at = now() - interval '25 hours' where id = v_cmd;

  r := rpc_cancel_command(v_cmd);
  perform assert_true((r ->> 'ok')::boolean is false, '★ פקודה בת יותר מ-24 שעות אינה ניתנת לביטול');
  perform assert_true(r ->> 'reason' = 'too_old', 'הסיבה: too_old');
  perform assert_true(r ->> 'message' like '%ישנה מדי%', 'ההודעה מנוסחת לשליחה');
end $$;

do $$
declare r jsonb;
begin
  r := rpc_cancel_last_command('972509999999');
  perform assert_true((r ->> 'ok')::boolean is false, 'אין מה לבטל למספר ללא היסטוריה');
  perform assert_true(r ->> 'reason' = 'nothing_to_cancel', 'הסיבה: nothing_to_cancel');
end $$;

rollback;

drop function t_roundtrip(text, text, jsonb);
drop function t_snapshot();
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות הביצוע והביטול עברו'
\echo '─────────────────────────────────────────'
