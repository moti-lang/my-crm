-- 12_reports_proof.sql — הדוחות של סבב 8 מחשבים נכון.
--
-- כל תצוגת דוח נבדקת מול המקור שלה: ספר הכספים, התשלומים, ההקצאה.
-- ובנוסף: רגישות למחיקה רכה (רשומה שנמחקה יוצאת מהדוח), וסגירה בפני
-- מנהלת סניף (אפס שורות, לא שורות חלקיות).

\set ON_ERROR_STOP on
\ir _assert.sql

-- ═════════════ רווח לפי הפקה ═════════════
\echo 'רווח לפי הפקה:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);

select assert_eq((select count(*) from v_production_pnl), 3, 'שלוש הפקות בדוח');

do $$
declare p record; v_exp numeric; v_inc numeric;
begin
  for p in select * from v_production_pnl order by name loop
    select coalesce(sum(amount) filter (where kind='expense'),0),
           coalesce(sum(amount) filter (where kind='income'),0)
      into v_exp, v_inc
      from ledger_entries where scope='production' and production_id = p.production_id and deleted_at is null;
    if p.expenses <> v_exp then
      raise exception E'\n  ✗ ★ % — הוצאות בדוח % ובספר %', p.name, p.expenses, v_exp;
    end if;
    if p.income <> v_inc then
      raise exception E'\n  ✗ ★ % — הכנסות בדוח % ובספר %', p.name, p.income, v_inc;
    end if;
    if p.profit <> v_inc - v_exp then
      raise exception E'\n  ✗ ★ % — רווח % אינו הכנסות פחות הוצאות (%)', p.name, p.profit, v_inc - v_exp;
    end if;
    raise notice '  ✓ ★ % — הוצאות %, הכנסות %, רווח %', p.name, p.expenses, p.income, p.profit;
  end loop;
end $$;

select assert_eq((select count(*) from v_production_pnl where status = 'released' and profit > 0), 2,
                 '★ שתי ההפקות שהופצו רווחיות (כמו ב-seed)');
select assert_true((select budget_used_pct is not null from v_production_pnl where name = 'הלב שבחלון'),
                   'אחוז ניצול תקציב מחושב כשיש תקציב');
select assert_true((select cast_count > 0 from v_production_pnl where name = 'הלב שבחלון'),
                   'מספר המשתתפות נספר');
rollback;

-- רגישות למחיקה רכה
begin;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
do $$
declare v_before numeric; v_after numeric; v_amount numeric; v_id uuid;
begin
  select expenses into v_before from v_production_pnl where name = 'הדרך הביתה';
  select id, amount into v_id, v_amount from ledger_entries
   where scope='production' and kind='expense'
     and production_id = (select id from productions where name = 'הדרך הביתה')
   limit 1;
  update ledger_entries set deleted_at = now() where id = v_id;
  select expenses into v_after from v_production_pnl where name = 'הדרך הביתה';
  perform assert_eq(v_after::bigint, (v_before - v_amount)::bigint,
                    '★ הוצאה שנמחקה רכה יוצאת מרווח ההפקה');
end $$;
rollback;

-- ═════════════ רווח והפסד לפי חודש ═════════════
\echo 'רווח והפסד חודשי:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select sum(income_students)::bigint from v_pnl_monthly),
                 (select sum(amount)::bigint from payments where deleted_at is null),
                 '★ סך ההכנסות מתלמידות בחודשים = סך התשלומים');
select assert_eq((select sum(expenses)::bigint from v_pnl_monthly),
                 (select sum(amount)::bigint from ledger_entries where kind='expense' and deleted_at is null),
                 '★ סך ההוצאות בחודשים = ספר הכספים');
select assert_eq((select sum(income_other)::bigint from v_pnl_monthly),
                 (select sum(amount)::bigint from ledger_entries where kind='income' and deleted_at is null),
                 '★ סך ההכנסות האחרות בחודשים = ספר הכספים');
select assert_eq((select sum(expenses_branch + expenses_general + expenses_production)::bigint from v_pnl_monthly),
                 (select sum(expenses)::bigint from v_pnl_monthly),
                 'פירוט ההוצאות לפי היקף מסתכם להוצאות');
select assert_true((select bool_and(profit = income_students + income_other - expenses) from v_pnl_monthly),
                   'רווח חודשי = הכנסות פחות הוצאות בכל חודש');
select assert_true((select count(distinct month) >= 2 from v_pnl_monthly), 'יש לפחות שני חודשים בדוח');
rollback;

-- ═════════════ רווחיות לפי סניף לפני ואחרי הקצאה ═════════════
\echo 'רווחיות לפי סניף:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select count(*) from v_branch_profitability), 5, 'חמישה סניפים');
select assert_true((select bool_and(profit_after = profit_before - allocated) from v_branch_profitability),
                   '★ רווח אחרי = רווח לפני פחות ההקצאה, בכל סניף');
select assert_eq((select round(sum(allocated))::bigint from v_branch_profitability),
                 (select round(sum(allocated_amount))::bigint from v_general_allocation),
                 '★ סך ההקצאה בדוח = סך החלוקה (12,000)');
select assert_eq((select round(sum(profit_before))::bigint from v_branch_profitability),
                 (select round(sum(income_students + income_other - expenses))::bigint from v_branch_pnl),
                 'סך הרווח לפני = דוח הסניפים');
rollback;

-- ═════════════ המרת פניות ═════════════
\echo 'המרת פניות:'
begin;
-- ה-seed אינו מכיל לידים מוואטסאפ; יוצרים שלושה בטרנזקציה.
insert into students (season_id, branch_id, full_name, status, source) values
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','ליד א','active','whatsapp'),
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','ליד ב','pending','whatsapp'),
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','ליד ג','stopped','whatsapp');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
-- ההשוואה מול הטבלה עצמה: ה-seed עשוי להכיל לידים משלו.
select assert_eq((select sum(leads)::bigint from v_lead_funnel),
                 (select count(*) from students where source='whatsapp' and deleted_at is null),
                 '★ מספר הלידים = תלמידות שמקורן וואטסאפ');
select assert_true((select sum(leads) >= 3 from v_lead_funnel), 'לפחות שלושת הלידים שנוצרו כאן');
select assert_eq((select sum(converted)::bigint from v_lead_funnel),
                 (select count(*) from students where source='whatsapp' and deleted_at is null and status='active'),
                 '★ הומרו = לידים פעילים');
select assert_eq((select sum(pending)::bigint from v_lead_funnel),
                 (select count(*) from students where source='whatsapp' and deleted_at is null and status='pending'),
                 'ממתינים = לידים ממתינים');
select assert_eq((select sum(lost)::bigint from v_lead_funnel),
                 (select count(*) from students where source='whatsapp' and deleted_at is null and status in ('stopped','graduated')),
                 'אבדו = לידים שהפסיקו');
select assert_true((select bool_and(conversion_pct = round(100.0 * converted / leads)) from v_lead_funnel),
                   'אחוז ההמרה מחושב נכון בכל חודש');
rollback;

-- ═════════════ סגור בפני מנהלת סניף ═════════════
\echo 'מנהלת סניף:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from v_production_pnl), 0, '★ מנהלת אינה רואה רווח הפקות');
select assert_eq((select count(*) from v_pnl_monthly), 0, '★ מנהלת אינה רואה רווח והפסד');
select assert_eq((select count(*) from v_branch_profitability), 0, '★ מנהלת אינה רואה רווחיות סניפים');
select assert_eq((select count(*) from v_lead_funnel), 0, '★ מנהלת אינה רואה המרת פניות');
rollback;

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות הדוחות עברו'
\echo '─────────────────────────────────────────'
