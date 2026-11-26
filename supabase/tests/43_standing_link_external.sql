-- 43_standing_link_external.sql — חיבור הוראת קבע שנפתחה ידנית ב-SUMIT, והערות בכרטיס (0066).
--   המקרה (26/11): הורה בלי טופס הרשמה; הוראה ידנית ב-SUMIT של 10 × 210. המערכת לא ידעה עליה.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_lk(p_sql text, p_role user_role default 'owner') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;
-- שירה (ביתר): 10 × 210, החיוב הבא בעוד 10 ימים, האחרון 6 חודשים אחריו → נותרו 7, בוצעו 3.
create or replace function t_lk_go(p_total int default 10, p_status int default 0, p_months int default 6, p_recurring bigint default 5550001,
                                   p_student uuid default 'dddddddd-0000-0000-0000-000000000001') returns jsonb language sql as $$
  select rpc_standing_link_external(p_student, 9990001, p_recurring, 210, p_total, p_status, f_today_il() + 10,
                                    f_today_il() - 21, (f_today_il() + 10 + make_interval(months => p_months))::date, t_user('owner'::user_role))
$$;

\echo 'שלב 1 — ההרשאה (בהרשאות המשתמשת):'
begin;
select assert_true(t_lk(format('select rpc_standing_link_request(%L, 9990001)::text', 'dddddddd-0000-0000-0000-000000000001'), 'branch_manager') like 'ERROR: רק הבעלים%',
                   '★ מנהלת סניף — לא');
select assert_true((t_lk(format('select rpc_standing_link_request(%L, 9990001)::text', 'dddddddd-0000-0000-0000-000000000001'))::jsonb ->> 'ok')::boolean, 'בעלים — כן');
select assert_true(t_lk(format('select rpc_standing_link_request(%L, 0)::text', 'dddddddd-0000-0000-0000-000000000001')) like 'ERROR: מספר הלקוח%', 'מספר לקוח 0 — לא');
rollback;

\echo 'החיבור — 10 × 210, בוצעו 3:'
begin;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);   -- v_standing_orders מסונן לפי תפקיד
create temp table t_r as select t_lk_go() r;
select assert_true((select (r ->> 'done')::int = 3 and (r ->> 'left')::int = 7 and (r ->> 'total')::int = 10 from t_r), '★ לפי SUMIT: בוצעו 3, נותרו 7');
select assert_true((select source = 'sumit_import' and payment_link_id is null and amount = 210 and installments = 9 and installments_total = 10
                           and charged_count = 2 and status = 'active' and next_billing = f_today_il() + 10 and last_billing = f_today_il() - 21
                      from standing_orders where sumit_recurring_id = 5550001), 'נשמרה: מקור SUMIT, בלי קישור, הסכום והתאריכים');
select assert_true((select charged_total = 3 and remaining = 7 from v_standing_orders where id = (select id from standing_orders where sumit_recurring_id = 5550001)),
                   '★ במסך: "חיוב 3 מתוך 10", נותרו 7');
select assert_true((select kind = 'linked' and actor_label is not null and note like '%3 מתוך 10%' from standing_order_events
                      where standing_order_id = (select id from standing_orders where sumit_recurring_id = 5550001)), 'ביומן ההוראה: "חוברה מ-SUMIT" — מי');
select assert_true(exists (select 1 from audit_log where action = 'standing_link_external'), 'ביומן הפעולות');
-- ★ הסנכרון רואה את החיוב שכבר עבר לפני החיבור — לא נרשם שוב (ההורה כבר שילמה אותו, אולי נרשם ידנית).
select rpc_standing_billing_observed((select id from standing_orders where sumit_recurring_id = 5550001), 0,
                                     f_today_il() + 10, f_today_il() - 21, (f_today_il() + 10 + interval '6 months')::date);
select assert_true((select count(*) = 0 from payments where student_id = 'dddddddd-0000-0000-0000-000000000001' and note like 'הוראת קבע SUMIT%'),
                   '★ חיוב מלפני החיבור — לא נרשם שוב (לא תשלום כפול)');
-- ★ החיוב הבא עובר — הסנכרון רושם אותו כתשלום, "חיוב 4 מתוך 10", בלי התראת אי-התאמה.
select rpc_standing_billing_observed((select id from standing_orders where sumit_recurring_id = 5550001), 0,
                                     (f_today_il() + 10 + interval '1 month')::date, f_today_il() + 10, (f_today_il() + 10 + interval '6 months')::date);
select assert_true((select count(*) = 1 from payments where student_id = 'dddddddd-0000-0000-0000-000000000001' and amount = 210
                      and note = 'הוראת קבע SUMIT · חיוב 4 מתוך 10'), '★ החיוב הבא נרשם כתשלום: "חיוב 4 מתוך 10"');
select assert_true((select charged_total = 4 and remaining = 6 from v_standing_orders where id = (select id from standing_orders where sumit_recurring_id = 5550001)),
                   'ואחריו: 4 מתוך 10, נותרו 6');
select assert_true(not exists (select 1 from system_alerts where kind = 'standing_order_remaining_mismatch'), '★ אין התראת "מספר החיובים שונה מ-SUMIT" (המיפוי נכון)');
select assert_true(t_lk(format('select rpc_standing_link_request(%L, 9990001)::text', 'dddddddd-0000-0000-0000-000000000001')) like 'ERROR: לתלמידה כבר יש הוראת קבע%',
                   'אחרי החיבור — אין חיבור שני לאותה תלמידה');
rollback;

\echo 'עוד לא חויב כלום — 10 נותרו:'
begin;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
create temp table t_r as select t_lk_go(10, 12, 9) r;
select assert_true((select (r ->> 'done')::int = 0 from t_r) and (select charged_total = 0 and remaining = 10 from v_standing_orders where id = (select id from standing_orders where sumit_recurring_id = 5550001)),
                   '★ בוצעו 0 מתוך 10');
select rpc_standing_billing_observed((select id from standing_orders where sumit_recurring_id = 5550001), 0,
                                     (f_today_il() + 10 + interval '1 month')::date, f_today_il() + 10, (f_today_il() + 10 + interval '9 months')::date);
select assert_true((select count(*) = 1 from payments where note = 'הוראת קבע SUMIT · חיוב 1 מתוך 10'), '★ החיוב הראשון: "חיוב 1 מתוך 10"');
rollback;

\echo 'הוראה מושבתת ב-SUMIT — נכנסת כמושבתת (וטופלת כרגיל):'
begin;
select t_lk_go(10, 3);
select assert_true((select status = 'failed' from standing_orders where sumit_recurring_id = 5550001), '★ קוד 3 → "הושבתה אחרי כישלון" (ניסיון חוזר / החלפת כרטיס)');
rollback;

\echo 'מתי אי אפשר:'
create or replace function t_lk_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return 'ERROR: ' || sqlerrm; end $$;
begin;
select assert_true(t_lk_err('select t_lk_go(5, 0, 6)') like 'ERROR: לפי SUMIT נותרו 7 חיובים — יותר%', '★ נותרו ב-SUMIT יותר מסך התשלומים שהוזן — לא');
select assert_true(t_lk_err('select t_lk_go(10, 1)') like 'ERROR: ההוראה ב-SUMIT בוטלה%', 'בוטלה ב-SUMIT — לא');
select assert_true(t_lk_err('select t_lk_go(1)') like 'ERROR: מספר התשלומים בהוראה%', 'תשלום אחד — לא (זו לא הוראת קבע)');
select assert_true(t_lk_err($q$select rpc_standing_link_external('dddddddd-0000-0000-0000-000000000001', 9990001, 1, 210, 10, 0, null, null, null, null)$q$) like 'ERROR: SUMIT לא החזירה%',
                   'בלי תאריכים מ-SUMIT — לא');
select t_lk_go();
select assert_true(t_lk_err($q$select t_lk_go(10, 0, 6, 5550001, 'dddddddd-0000-0000-0000-000000000003')$q$) like 'ERROR: ההוראה הזו כבר מחוברת%', '★ אותה הוראה לתלמידה שנייה — לא');
select assert_true(t_lk_err($q$update standing_orders set source = 'link' where sumit_recurring_id = 5550001$q$) like 'ERROR:%standing_orders_source_check%',
                   'הוראה "מקישור" בלי קישור — אסור (המקור והקישור תואמים)');
rollback;

\echo 'הערות בכרטיס:'
begin;
select assert_true((t_lk(format('select rpc_student_set_notes(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', '  משלם בהוראת קבע שנפתחה ב-SUMIT  '))::jsonb ->> 'changed')::boolean,
                   'בעלים — נשמר');
select assert_true((select notes = 'משלם בהוראת קבע שנפתחה ב-SUMIT' from students where id = 'dddddddd-0000-0000-0000-000000000001'), 'נשמר בלי רווחים בקצוות');
select assert_true(exists (select 1 from audit_log where action = 'student_notes' and row_id = 'dddddddd-0000-0000-0000-000000000001'), 'ביומן');
select assert_true((t_lk(format('select rpc_student_set_notes(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', 'מנהלת'), 'branch_manager')::jsonb ->> 'ok')::boolean,
                   '★ מנהלת הסניף של התלמידה — כן');
select assert_true(t_lk(format('select rpc_student_set_notes(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', 'x'), 'accountant') like 'ERROR: אין הרשאה%', '★ רואת חשבון — לא');
update students set branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true(t_lk(format('select rpc_student_set_notes(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', 'x'), 'branch_manager') like 'ERROR: אין הרשאה%',
                   '★ מנהלת סניף אחר — לא');
select assert_true(t_lk(format('select rpc_student_set_notes(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', repeat('א', 2001))) like 'ERROR: ההערות ארוכות מדי%', 'ארוך מדי — לא');
select assert_true((t_lk(format('select rpc_student_set_notes(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', ''))::jsonb ->> 'changed')::boolean,
                   'מחיקת ההערות — מתקבלת');
-- בשאילתה נפרדת: בתוך אותו ביטוי, תת-השאילתה יכולה להיות מחושבת לפני הקריאה.
select assert_true((select notes is null from students where id = 'dddddddd-0000-0000-0000-000000000001'), '...והשדה ריק');
rollback;

select assert_no_execute('anon', 'rpc_standing_link_request(uuid, bigint)');
select assert_no_execute('authenticated', 'rpc_standing_link_external(uuid, bigint, bigint, numeric, integer, integer, date, date, date, uuid)');
select assert_no_execute('anon', 'rpc_student_set_notes(uuid, text)');
drop function t_lk_go(int, int, int, bigint, uuid); drop function t_lk(text, user_role); drop function t_lk_err(text);
select drop_assert_helpers();
\echo '  חיבור הוראת קבע מ-SUMIT והערות: הכל עבר'
