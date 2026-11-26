-- 40_student_transfer.sql — העברת תלמידה לסניף אחר (0063).
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_tr(p_sql text, p_role user_role default 'owner') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;
-- שירה (ביתר) → מודיעין.
create or replace function t_tr_go(p_role user_role default 'owner', p_branch uuid default 'bbbbbbbb-0000-0000-0000-000000000002') returns text language sql as $$
  select t_tr(format('select rpc_transfer_student(%L, %L)::text', 'dddddddd-0000-0000-0000-000000000001', p_branch), p_role)
$$;

\echo 'העברה לסניף אחר:'
begin;
-- לפני: קבוצה, תשלום מהעבר, הוראת קבע פעילה וגם אחת שהסתיימה, קישור פתוח עם הודעה, ותזכורת אחרת.
update students set group_name = 'קבוצה א' where id = 'dddddddd-0000-0000-0000-000000000001';
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
values ('eeeeeeee-0000-0000-0000-000000000400', repeat('7', 60) || '0400', 'tr-1', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 210, 'paid', now() - interval '40 days'),
       ('eeeeeeee-0000-0000-0000-000000000402', repeat('7', 60) || '0402', 'tr-2', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 210, 'paid', now() - interval '400 days');
insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                             installments_total, date_start, consent_text, consented_at, status, next_billing, charged_count)
values ('eeeeeeee-0000-0000-0000-000000000401', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000400', 1, 2, 110, 9, 10, current_date - 10, 'אישור', now() - interval '40 days', 'active', current_date + 20, 1),
       ('eeeeeeee-0000-0000-0000-000000000403', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000402', 1, 3, 110, 9, 10, current_date - 400, 'אישור', now() - interval '400 days', 'completed', null, 9);
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status)
values ('eeeeeeee-0000-0000-0000-000000000404', repeat('7', 60) || '0404', 'tr-3', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 300, 'pending');
insert into reminders (id, kind, student_id, branch_id, to_phone, body, scheduled_at, dedupe_key)
values ('eeeeeeee-0000-0000-0000-000000000405', 'payment_link', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '972521000001', 'קישור', now() + interval '1 hour', 'tr-link'),
       ('eeeeeeee-0000-0000-0000-000000000406', 'debt', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '972521000001', 'תזכורת', now() + interval '1 day', 'tr-other');
create temp table t_paid as select id, branch_id from payments where student_id = 'dddddddd-0000-0000-0000-000000000001';

select assert_true(t_tr_go('branch_manager') like 'ERROR: רק הבעלים%', '★ מנהלת סניף — לא');
select assert_true(t_tr_go('owner', 'bbbbbbbb-0000-0000-0000-000000000001') like 'ERROR: התלמידה כבר בסניף הזה%', 'לאותו סניף — לא');
create temp table t_r as select t_tr_go()::jsonb r;
select assert_true((select r ->> 'from' = 'ביתר עילית' and r ->> 'to' = 'מודיעין עילית' and (r ->> 'links_cancelled')::int = 1
                           and (r ->> 'standing_moved')::int = 1 and (r ->> 'reminders_moved')::int = 1 and (r ->> 'group_cleared')::boolean from t_r),
                   '★ התשובה: מאיפה, לאן, ומה השתנה');
select assert_true((select branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' and group_name is null from students where id = 'dddddddd-0000-0000-0000-000000000001'),
                   '★ התלמידה בסניף החדש, בלי הקבוצה של הקודם');
select assert_true((select count(*) > 0 and bool_and(p.branch_id = t.branch_id) from payments p join t_paid t on t.id = p.id),
                   '★ תשלומים מהעבר נשארו בסניף שבו שולמו (הדוחות לא זזים)');
select assert_true((select branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000401'),
                   '★ הוראת קבע פעילה — החיובים הבאים בסניף החדש');
select assert_true((select branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000403'),
                   'הוראה שהסתיימה — נשארה (היסטוריה)');
select rpc_record_standing_charge('eeeeeeee-0000-0000-0000-000000000401', 990001, 110, now(), true, null);
select assert_true((select branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' from payments where student_id = 'dddddddd-0000-0000-0000-000000000001'
                      and note like 'הוראת קבע SUMIT%' order by created_at desc limit 1), '★ חיוב הוראת קבע אחרי ההעברה — נרשם בסניף החדש');
select assert_true((select status = 'cancelled' from payment_links where id = 'eeeeeeee-0000-0000-0000-000000000404'), '★ קישור פתוח (שם הסניף הקודם) — בוטל');
select assert_true((select status = 'cancelled' from reminders where id = 'eeeeeeee-0000-0000-0000-000000000405'), '...וההודעה שלו לא יוצאת');
select assert_true((select status = 'scheduled' and branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' from reminders where id = 'eeeeeeee-0000-0000-0000-000000000406'),
                   'תזכורת אחרת שעוד לא יצאה — עברה לסניף החדש');
select assert_true((select count(*) = 1 from t_tr(format('select string_agg(from_branch || ''>'' || to_branch || ''|'' || changed_by, '','') from rpc_student_branch_history(%L)',
                                                      'dddddddd-0000-0000-0000-000000000001')) x(v)
                      where v = 'ביתר עילית>מודיעין עילית|' || (select full_name from profiles where id = t_user('owner'::user_role))),
                   '★ בהיסטוריה: מאיזה סניף, לאיזה, ומי');
-- ★ מנהלת הסניף הקודם כבר לא רואה את התלמידה — וגם לא את ההיסטוריה שלה.
select assert_true(t_tr(format('select count(*)::text from students where id = %L', 'dddddddd-0000-0000-0000-000000000001'), 'branch_manager') = '0',
                   '★ מנהלת הסניף הקודם — לא רואה אותה יותר');
select assert_true(t_tr(format('select count(*)::text from rpc_student_branch_history(%L)', 'dddddddd-0000-0000-0000-000000000001'), 'branch_manager') = '0',
                   '...וגם לא את ההיסטוריה');
rollback;

\echo 'יומן — גם בעדכון ישיר:'
begin;
update students set branch_id = 'bbbbbbbb-0000-0000-0000-000000000003' where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true((select count(*) = 1 from audit_log where action = 'transfer_student' and row_id = 'dddddddd-0000-0000-0000-000000000001'
                      and before ->> 'branch_name' = 'ביתר עילית' and after ->> 'branch_name' = 'ירושלים רמות'), '★ כל שינוי סניף נרשם ביומן');
update students set full_name = full_name where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true((select count(*) = 1 from audit_log where action = 'transfer_student' and row_id = 'dddddddd-0000-0000-0000-000000000001'), 'עדכון בלי שינוי סניף — לא נרשם');
rollback;

\echo 'מתי אי אפשר:'
begin;
update branches set is_active = false where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select assert_true(t_tr_go() like 'ERROR: הסניף שנבחר לא קיים או סגור%', 'סניף סגור — לא');
rollback;
begin;
insert into students (season_id, branch_id, full_name, status)
select season_id, 'bbbbbbbb-0000-0000-0000-000000000002', full_name, 'active' from students where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true(t_tr_go() like 'ERROR: בסניף מודיעין עילית כבר יש תלמידה בשם%', '★ בסניף החדש יש תלמידה באותו שם — לא (כפילות)');
rollback;
begin;
update students set deleted_at = now() where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true(t_tr_go() like 'ERROR: התלמידה נמחקה%', 'תלמידה מחוקה — לא');
rollback;

select assert_no_execute('anon', 'rpc_transfer_student(uuid, uuid)');
select assert_no_execute('anon', 'rpc_student_branch_history(uuid)');
select assert_no_execute('authenticated', 'f_student_branch_audit()');
drop function t_tr_go(user_role, uuid); drop function t_tr(text, user_role);
select drop_assert_helpers();
\echo '  העברת תלמידה לסניף אחר: הכל עבר'
