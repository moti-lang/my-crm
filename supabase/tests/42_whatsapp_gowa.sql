-- 42_whatsapp_gowa.sql — 0065: קצב השליחה (מההגדרות, נאכף במסד), והסרת השרת הישן.
\set ON_ERROR_STOP on
\ir _assert.sql

\echo 'קצב שליחה — מרווח מינימלי ותקרה לדקה:'
begin;
delete from settings where key = 'wa_pacing_state';
select assert_true((select (f_wa_pacing() ->> 'min_gap_seconds')::int = 8 and (f_wa_pacing() ->> 'max_gap_seconds')::int = 20
                           and (f_wa_pacing() ->> 'max_per_minute')::int = 4), 'ברירת המחדל: 8–20 שניות, עד 4 בדקה');
select assert_true(rpc_wa_pacing() = f_wa_pacing(), 'ההגדרות לתור (rpc_wa_pacing) — אותן הגדרות אחרי חיתוך');
select assert_true((rpc_wa_reserve_send() ->> 'ok')::boolean, 'שליחה ראשונה — יש מקום');
select assert_true((select r ->> 'reason' = 'gap' and (r ->> 'wait_seconds')::int between 1 and 8 from (select rpc_wa_reserve_send() r) x),
                   '★ מיד אחריה — "לחכות" (מרווח מינימלי)');
-- התקרה: מרווח 1, תקרה 2 בדקה; שתי שליחות "לפני 10 ו-20 שניות" → השלישית נחסמת.
update settings set value = '{"min_gap_seconds": 1, "max_gap_seconds": 2, "max_per_minute": 2}' where key = 'wa_pacing';
update settings set value = jsonb_build_object('recent', jsonb_build_array(now() - interval '20 seconds', now() - interval '10 seconds')) where key = 'wa_pacing_state';
select assert_true((select r ->> 'reason' = 'per_minute' and (r ->> 'wait_seconds')::int between 39 and 41 from (select rpc_wa_reserve_send() r) x),
                   '★ התקרה לדקה מלאה — "לחכות" עד שהראשונה יוצאת מהדקה');
update settings set value = jsonb_build_object('recent', jsonb_build_array(now() - interval '70 seconds', now() - interval '10 seconds')) where key = 'wa_pacing_state';
select assert_true((rpc_wa_reserve_send() ->> 'ok')::boolean, 'מה שיצא לפני יותר מדקה — לא נספר');
select assert_true((select jsonb_array_length(value -> 'recent') = 2 from settings where key = 'wa_pacing_state'), 'ונמחק מהרשימה');
rollback;

begin;
update settings set value = '{"min_gap_seconds": "abc", "max_gap_seconds": 99999, "max_per_minute": 0, "run_budget_seconds": 5000}' where key = 'wa_pacing';
select assert_true((select (p ->> 'min_gap_seconds')::int = 8 and (p ->> 'max_gap_seconds')::int = 20 and (p ->> 'max_per_minute')::int = 1
                           and (p ->> 'run_budget_seconds')::int = 140 from (select f_wa_pacing() p) x),
                   '★ ערכים לא תקינים / קיצוניים בהגדרות — ברירת מחדל או חיתוך לטווח (לא נשבר, לא שולח בלי הגבלה)');
update settings set value = '{"min_gap_seconds": 30, "max_gap_seconds": 5}' where key = 'wa_pacing';
select assert_true((f_wa_pacing() ->> 'max_gap_seconds')::int = 30, 'מקסימום קטן ממינימום — לפחות המינימום');
delete from settings where key = 'wa_pacing';
select assert_true((f_wa_pacing() ->> 'max_per_minute')::int = 4, 'אין הגדרה בכלל — ברירת המחדל');
rollback;

\echo 'השרת הישן — הוסר:'
select assert_true(to_regclass('public.wa_config') is null, '★ wa_config לא קיימת');
select assert_true(not exists (select 1 from pg_proc where proname in ('rpc_wa_provision', 'rpc_wa_issue_provision_token', 'rpc_wa_setup_report')),
                   'פונקציות ההקמה — לא קיימות');

select assert_no_execute('anon', 'rpc_wa_reserve_send()');
select assert_no_execute('authenticated', 'rpc_wa_reserve_send()');
select assert_no_execute('authenticated', 'rpc_wa_pacing()');
select assert_no_execute('authenticated', 'f_wa_pacing()');
select drop_assert_helpers();
\echo '  וואטסאפ על GOWA (מסד): הכל עבר'
