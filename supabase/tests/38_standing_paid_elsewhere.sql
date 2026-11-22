-- 38_standing_paid_elsewhere.sql — "החיוב שולם בנפרד": רושמים בלי לחייב, ומחדשים בלי לחייב (0061).
--   המקרה (שלוש אחיות, 22/11): החיוב של 19/11 נכשל, ההוראה הושבתה, והחיוב עבר אחר כך בנפרד (חיוב ידני
--   ב-SUMIT). "ניסיון חיוב חוזר" היה מחייב שוב.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_pe_order() returns uuid language plpgsql as $$
declare v_link uuid := 'eeeeeeee-0000-0000-0000-000000000380'; v_id uuid := 'eeeeeeee-0000-0000-0000-000000000381';
begin
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
  values (v_link, repeat('9', 60) || '0380', 'pe-1', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
          210, 'paid', (f_today_il() - 34)::timestamptz);
  insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, consent_text, consented_at, status, sumit_status, next_billing, charged_count, billing_day)
  values (v_id, 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', v_link, 2538691184, 2539578888, 110,
          9, 10, f_today_il() - 3, 'אישור', now() - interval '34 days', 'failed', 3, f_today_il() - 3, 0,
          least(extract(day from f_today_il() - 3)::int, 28));
  return v_id;
end $$;
create or replace function t_pe(p_sql text, p_role user_role default 'owner') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;

\echo 'שולם בנפרד — נרשם בלי לחייב, ואחריו רק חידוש:'
begin;
select t_pe_order();
select assert_true(t_pe(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000381', f_today_il(), ' ')) like 'ERROR: יש לכתוב איך שולם%',
                   '★ בלי "איך שולם" — לא נרשם');
select assert_true(t_pe(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000381', f_today_il(), 'x'), 'branch_manager') like 'ERROR: רק הבעלים%',
                   '★ מנהלת סניף — לא');
select assert_true(t_pe(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000381', f_today_il() + 1, 'x')) like 'ERROR: תאריך התשלום%',
                   'תאריך בעתיד — לא');
create temp table t_r as select t_pe(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000381', f_today_il(),
                                            'חיוב ידני בכרטיס ב-SUMIT, קבלה 4321'))::jsonb as r;
select assert_true((select (r ->> 'amount')::numeric = 110 and (r ->> 'remaining')::int = 8 and (r ->> 'needs_renewal')::boolean from t_r),
                   '★ נרשם: 110 (החודשי), נותרו 8, וצריך לחדש');
select assert_true((select amount = 110 and method = 'credit' and source = 'manual' and paid_on = f_today_il()
                           and note like 'הוראת קבע · החיוב של % שולם בנפרד · חיוב 2 מתוך 10 · חיוב ידני בכרטיס ב-SUMIT, קבלה 4321'
                      from payments where student_id = 'dddddddd-0000-0000-0000-000000000001' and note like '%שולם בנפרד%'),
                   '★ התשלום בכרטיס התלמידה — עם ההסבר');
select assert_true((select status = 'failed' and needs_renewal and charged_count = 1 and last_billing = f_today_il()
                      from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000381'), 'ההוראה: חיוב 2 מתוך 10, "צריך לחדש"');
select assert_true((select kind = 'paid_elsewhere' and actor = t_user('owner'::user_role)
                           and actor_label = (select full_name from profiles where id = t_user('owner'::user_role)) and note like 'חיוב ידני%'
                      from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000381'),
                   '★ ביומן ההוראה: "שולם בנפרד" — מי (השם מהטריגר) ואיך');
-- ★ אחר כך "ניסיון חיוב חוזר" — רק חידוש, בלי חיוב, מהחודש הבא.
select assert_true((select p ->> 'stage' = 'renew' and (p ->> 'remaining_after')::int = 8 and (p ->> 'next')::date > f_today_il()
                           and (p ->> 'next')::date <= (f_today_il() + interval '1 month')::date and p ->> 'lines' like '%בנפרד%'
                      from (select f_standing_retry_plan('eeeeeeee-0000-0000-0000-000000000381', f_today_il()) p) x),
                   '★ התוכנית אחרי הרישום: חידוש בלבד (בלי חיוב), 8 חיובים, מהחודש הבא');
select assert_true(t_pe(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000381', f_today_il(), 'שוב')) like 'ERROR: רק בהוראה שהושבתה%',
                   '★ פעמיים — לא (רישום כפול)');
rollback;

\echo 'הוראה פעילה — אין "שולם בנפרד":'
begin;
select t_pe_order();
update standing_orders set status = 'active', sumit_status = 0 where id = 'eeeeeeee-0000-0000-0000-000000000381';
select assert_true(t_pe(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000381', f_today_il(), 'x')) like 'ERROR: רק בהוראה שהושבתה%',
                   'פעילה — לא');
rollback;

select assert_no_execute('anon', 'rpc_standing_paid_elsewhere(uuid, date, text)');
select assert_no_execute('authenticated', 'f_standing_event_actor_label()');
drop function t_pe_order(); drop function t_pe(text, user_role);
select drop_assert_helpers();
\echo '  החיוב שולם בנפרד: הכל עבר'
