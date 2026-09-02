-- 03_allocation_proof.sql — חלוקת הוצאות כלליות.
-- הטענה הנבדקת: סכום ההקצאות שווה בדיוק לסכום ההוצאה, לכל שיטת חלוקה
-- ולכל סכום, כולל כאלה שאינם מתחלקים.

\set ON_ERROR_STOP on
\set SEASON '''aaaaaaaa-0000-0000-0000-000000000001'''

\ir _assert.sql

create or replace function assert_money(actual numeric, expected numeric, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception E'\n  ✗ %\n    התקבל: %   ציפינו: %   הפרש: %',
      label, actual, expected, actual - expected;
  end if;
  raise notice '  ✓ % (%)', label, actual;
end $$;

/** מחליף את ההוצאות הכלליות ברשומה אחת ומחזיר את סך ההקצאה. */
create or replace function t_alloc(p_amount numeric, p_method split_method, p_manual jsonb default null)
returns numeric language plpgsql as $$
declare v numeric;
begin
  delete from ledger_entries where scope = 'general' and kind = 'expense';
  insert into ledger_entries (season_id, kind, scope, entry_date, category, amount, split_method, split_manual)
  values ('aaaaaaaa-0000-0000-0000-000000000001','expense','general', current_date, 'בדיקה', p_amount, p_method, p_manual);
  select coalesce(sum(allocated_amount),0) into v
    from f_general_allocation('aaaaaaaa-0000-0000-0000-000000000001');
  return v;
end $$;

begin;

-- ═════════ חמישה סניפים (מצב ה-seed) ═════════
\echo '5 סניפים:'
select assert_money(t_alloc(12000,'equal'),       12000, 'שווה · 12,000 ל-5 סניפים');
select assert_money(t_alloc(12000,'by_students'), 12000, 'לפי תלמידות · 12,000');
select assert_money(t_alloc(12000,'manual',
  '{"bbbbbbbb-0000-0000-0000-000000000001":0.3,"bbbbbbbb-0000-0000-0000-000000000002":0.2,
    "bbbbbbbb-0000-0000-0000-000000000003":0.2,"bbbbbbbb-0000-0000-0000-000000000004":0.15,
    "bbbbbbbb-0000-0000-0000-000000000005":0.15}'::jsonb), 12000, 'ידני · שברים שמסתכמים ב-1');
-- משקלים שאינם מסתכמים ב-1 מנורמלים ולא מאבדים סכום
select assert_money(t_alloc(12000,'manual',
  '{"bbbbbbbb-0000-0000-0000-000000000001":3,"bbbbbbbb-0000-0000-0000-000000000002":2,
    "bbbbbbbb-0000-0000-0000-000000000003":2}'::jsonb), 12000, 'ידני · משקלים 3:2:2 (מנורמלים)');
select assert_money(t_alloc(12000,'none'), 0, 'ללא חלוקה · לא מוקצה כלום');

-- סכומים שאינם מתחלקים
select assert_money(t_alloc(100.01,'equal'),  100.01, 'שווה · 100.01 (לא מתחלק)');
select assert_money(t_alloc(0.03,'equal'),      0.03, 'שווה · 0.03 (פחות מאגורה לסניף)');
select assert_money(t_alloc(0.01,'equal'),      0.01, 'שווה · 0.01 (אגורה בודדת)');
select assert_money(t_alloc(1,'by_students'),      1, 'לפי תלמידות · שקל אחד');

-- ═════════ שבעה סניפים ═════════
insert into branches (id, name, city, default_tuition) values
  ('bbbbbbbb-0000-0000-0000-000000000006','בדיקה ו','—',0),
  ('bbbbbbbb-0000-0000-0000-000000000007','בדיקה ז','—',0);

\echo '7 סניפים:'
select assert_money(t_alloc(12000,'equal'),   12000, 'שווה · 12,000 ל-7 סניפים');
select assert_money(t_alloc(10000,'equal'),   10000, 'שווה · 10,000 ל-7 סניפים');
select assert_money(t_alloc(100,'equal'),       100, 'שווה · 100 ל-7 סניפים');
select assert_money(t_alloc(12000,'by_students'), 12000, 'לפי תלמידות · 7 סניפים, 2 בלי תלמידות');

-- אף סניף אינו מקבל הקצאה שלילית בגלל השארית
do $$ declare n int; begin
  perform t_alloc(0.01,'equal');
  select count(*) into n from f_general_allocation('aaaaaaaa-0000-0000-0000-000000000001')
   where allocated_amount < 0;
  if n <> 0 then raise exception E'\n  ✗ % סניפים קיבלו הקצאה שלילית', n; end if;
  raise notice '  ✓ אין הקצאות שליליות';
end $$;

-- ═════════ כמה רשומות יחד ═════════
delete from ledger_entries where scope = 'general' and kind = 'expense';
insert into ledger_entries (season_id, kind, scope, entry_date, category, amount, split_method, split_manual) values
  (:SEASON,'expense','general',current_date,'א',  6000,'equal',       null),
  (:SEASON,'expense','general',current_date,'ב',  3600,'by_students', null),
  (:SEASON,'expense','general',current_date,'ג',  2400,'manual',
    '{"bbbbbbbb-0000-0000-0000-000000000001":0.3,"bbbbbbbb-0000-0000-0000-000000000002":0.2,
      "bbbbbbbb-0000-0000-0000-000000000003":0.2,"bbbbbbbb-0000-0000-0000-000000000004":0.15,
      "bbbbbbbb-0000-0000-0000-000000000005":0.15}'::jsonb),
  (:SEASON,'expense','general',current_date,'ד',  1800,'none',        null),
  (:SEASON,'expense','general',current_date,'ה', 99.99,'equal',       null);

select assert_money(
  (select coalesce(sum(allocated_amount),0) from f_general_allocation(:SEASON)),
  6000 + 3600 + 2400 + 99.99,
  'חמש רשומות מעורבות · הסכום המדויק (ללא ה-none)');

rollback;

drop function t_alloc(numeric, split_method, jsonb);
drop function assert_money(numeric, numeric, text);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות חלוקת ההוצאות עברו'
\echo '─────────────────────────────────────────'
