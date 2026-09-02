-- 05_role_consistency_proof.sql — כל דוח כספי מחזיר אותם מספרים לכל תפקיד
-- שרשאי לראותו.
--
-- הכלל: אם הבעלים ורואת החשבון רואות מספרים שונים לאותו דוח, זה באג
-- בהגדרה. לא "הרשאות", לא "תצוגה חלקית" — שני אנשים שמסתכלים על אותו
-- מספר ומקבלים תשובות שונות.
--
-- ההיסטוריה שהוליכה לכאן:
--   0008 — f_general_allocation: 8,400 במקום 12,000 לרואת חשבון.
--   0009 — v_branch_pnl: הכנסות 0 במקום 20,700, חוב 0 במקום 20,600.
-- שניהם מאותו שורש: דוח כספי שנשען על RLS של טבלה עם מידע אישי.
--
-- ★ להוסיף כאן שורה אחת לכל דוח כספי חדש שנבנה. ★

\set ON_ERROR_STOP on
\set OWNER '''cccccccc-0000-0000-0000-000000000001'''
\set ACCT  '''cccccccc-0000-0000-0000-000000000003'''

/**
 * מריץ את אותה שאילתה בתור בעלים ובתור רואת חשבון ומשווה.
 *
 * p_min_owner מונע בדיקה ריקה: אם שני התפקידים מחזירים 0 כי אין נתונים,
 * ההשוואה עוברת ולא מוכיחה כלום. דוח שאמור להכיל נתונים חייב להחזיר
 * ערך מעליו אצל הבעלים, אחרת הבדיקה נכשלת.
 */
create or replace function t_roles_agree(p_label text, p_sql text, p_min_owner numeric default null)
returns void language plpgsql as $$
declare v_owner numeric; v_acct numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute p_sql into v_owner;

  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
  execute p_sql into v_acct;

  if p_min_owner is not null and (v_owner is null or v_owner < p_min_owner) then
    raise exception E'\n  ✗ % — בדיקה ריקה\n    הבעלים קיבל % (מינימום נדרש %). השוואה בין שני אפסים אינה מוכיחה דבר.',
      p_label, coalesce(v_owner::text, 'null'), p_min_owner;
  end if;

  if v_owner is distinct from v_acct then
    raise exception E'\n  ✗ ★ % — שני התפקידים רואים מספרים שונים\n    בעלים: %\n    רואת חשבון: %\n    הפרש: %',
      p_label, coalesce(v_owner::text,'null'), coalesce(v_acct::text,'null'),
      coalesce((v_owner - v_acct)::text,'—');
  end if;

  raise notice '  ✓ % (%)', p_label, coalesce(v_owner::text, 'null');
end $$;

begin;
set local role authenticated;

\echo 'רווח והפסד לפי סניף:'
select t_roles_agree('מספר הסניפים בדוח',   'select count(*)::numeric from v_branch_pnl', 5);
select t_roles_agree('הכנסות מתלמידות',     'select sum(income_students) from v_branch_pnl', 1);
select t_roles_agree('הכנסות אחרות',        'select sum(income_other) from v_branch_pnl');
select t_roles_agree('הוצאות סניף',         'select sum(expenses) from v_branch_pnl', 1);
select t_roles_agree('חוב פתוח',            'select sum(open_debt) from v_branch_pnl', 1);
select t_roles_agree('תלמידות פעילות',      'select sum(active_students) from v_branch_pnl', 1);
select t_roles_agree('רווח כולל',
  'select sum(income_students + income_other - expenses) from v_branch_pnl');

\echo 'יתרות תלמידות:'
select t_roles_agree('מספר התלמידות ביתרות', 'select count(*)::numeric from v_student_balance', 20);
select t_roles_agree('סך שכר לימוד',         'select sum(due) from v_student_balance', 1);
select t_roles_agree('סך ששולם',             'select sum(paid) from v_student_balance', 1);
select t_roles_agree('סך היתרות',            'select sum(balance) from v_student_balance', 1);

\echo 'גבייה:'
select t_roles_agree('מספר החייבות',        'select count(*)::numeric from v_debtors', 1);
select t_roles_agree('סך החוב',             'select sum(balance) from v_debtors', 1);
select t_roles_agree('חוב מעל 90 יום',
  'select coalesce(sum(balance) filter (where aging_bucket = 90), 0) from v_debtors');
select t_roles_agree('חוב 60-89 יום',
  'select coalesce(sum(balance) filter (where aging_bucket = 60), 0) from v_debtors', 1);

\echo 'חלוקת הוצאות כלליות:'
select t_roles_agree('סך המוקצה לסניפים',   'select sum(allocated_amount) from v_general_allocation', 1);
select t_roles_agree('מספר הסניפים בחלוקה', 'select count(*)::numeric from v_general_allocation', 5);

\echo 'ספר הכספים:'
select t_roles_agree('סך ההוצאות',
  'select sum(amount) from ledger_entries where kind=''expense'' and deleted_at is null', 1);
select t_roles_agree('סך ההכנסות',
  'select sum(amount) from ledger_entries where kind=''income'' and deleted_at is null', 1);
select t_roles_agree('הוצאות כלליות',
  'select sum(amount) from ledger_entries where scope=''general'' and kind=''expense'' and deleted_at is null', 1);
select t_roles_agree('הוצאות הפקות',
  'select sum(amount) from ledger_entries where scope=''production'' and kind=''expense'' and deleted_at is null', 1);
select t_roles_agree('סך התשלומים',
  'select sum(amount) from payments where deleted_at is null', 1);

-- ─────────── פר סניף, לא רק בסך הכל ───────────
-- באג שמאפס סניף אחד ומנפח אחר היה עובר בהשוואת סכומים.
\echo 'פר סניף:'
do $$
declare b record; n int := 0;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
  for b in select branch_id, name from v_branch_pnl order by name loop
    perform t_roles_agree(
      format('%s · הכנסות', b.name),
      format('select income_students + income_other from v_branch_pnl where branch_id = %L', b.branch_id));
    perform t_roles_agree(
      format('%s · הוצאות', b.name),
      format('select expenses from v_branch_pnl where branch_id = %L', b.branch_id));
    perform t_roles_agree(
      format('%s · חוב פתוח', b.name),
      format('select open_debt from v_branch_pnl where branch_id = %L', b.branch_id));
    perform t_roles_agree(
      format('%s · הקצאת הנהלה', b.name),
      format('select allocated_amount from v_general_allocation where branch_id = %L', b.branch_id));
    -- חוזרים לזהות הבעלים כדי שהלולאה תמשיך לראות את כל הסניפים
    perform set_config('request.jwt.claims',
      '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
    n := n + 1;
  end loop;
  if n < 5 then raise exception E'\n  ✗ הלולאה עברה על % סניפים בלבד', n; end if;
end $$;

-- ─────────── מה שכן שונה בין התפקידים, ובצדק ───────────
-- שוויון במספרים אינו אומר שוויון בנתונים אישיים.
\echo 'הפרדת מידע אישי נשמרת:'
do $$
declare v int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
  select count(parent_phone) into v from v_debtors;
  if v <> 0 then
    raise exception E'\n  ✗ ★ רואת חשבון רואה % מספרי טלפון ברשימת החייבות', v;
  end if;
  raise notice '  ✓ ★ רואת חשבון רואה את אותם סכומים בלי אף מספר טלפון';

  select count(*) into v from students;
  if v <> 0 then
    raise exception E'\n  ✗ ★ רואת חשבון קוראת מטבלת students ישירות';
  end if;
  raise notice '  ✓ ★ הגישה הישירה ל-students עדיין חסומה בפניה';
end $$;

rollback;

drop function t_roles_agree(text, text, numeric);
\echo '─────────────────────────────────────────'
\echo ' כל הדוחות הכספיים עקביים בין התפקידים'
\echo '─────────────────────────────────────────'
