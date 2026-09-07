-- 0022 — קישורי תשלום (SUMIT, שלב א).
--
-- הקישור שיוצא להורה הוא שלנו: /pay/<טוקן>. הוא נעול לתלמידה אחת ולסכום
-- שנקבע ברגע היצירה, ופג אחרי 7 ימים. דף SUMIT נוצר רק כשההורה לוחצת,
-- עם הסכום מהרשומה שלנו — אי אפשר לשנות סכום או לנחש קישור של אחרת.
--
-- ★ אישור תשלום מגיע רק מ-SUMIT (webhook כרמז + בדיקה יזומה), לעולם לא
--   מהדפדפן. הרישום אצלנו הוא rpc_record_sumit_payment — אידמפוטנטי:
--   payment_id יחיד לקישור, ומזהה תשלום SUMIT ייחודי — הודעה שמגיעה
--   פעמיים נרשמת פעם אחת.

alter type reminder_kind add value if not exists 'payment_link';

create table payment_links (
  id                  uuid primary key default gen_random_uuid(),
  token               text not null unique,
  -- מה שנשלח ל-SUMIT כ-ExternalIdentifier. שלנו, לא שלהם.
  external_identifier text not null unique,
  student_id          uuid not null references students(id),
  branch_id           uuid not null references branches(id),
  amount              numeric(10,2) not null check (amount > 0),
  status              text not null default 'pending'
                      check (status in ('pending','opened','paid','mismatch','expired','cancelled')),
  expires_at          timestamptz not null default now() + interval '7 days',
  opened_at           timestamptz,
  sumit_page_url      text,
  sumit_payment_id    text unique,
  sumit_document_id   text,
  sumit_amount        numeric(10,2),
  paid_at             timestamptz,
  payment_id          uuid unique references payments(id),
  last_checked_at     timestamptz,
  reminder_id         uuid references reminders(id),
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index payment_links_open_idx on payment_links (expires_at) where status in ('pending','opened');
create index payment_links_student_idx on payment_links (student_id);
create trigger payment_links_touch before update on payment_links
  for each row execute function f_touch_updated_at();

alter table payment_links enable row level security;
revoke all on payment_links from anon, public;
grant select on payment_links to authenticated;
grant all on payment_links to service_role;
create policy payment_links_owner_acct on payment_links for select
  using (auth_role() in ('owner', 'accountant'));
create policy payment_links_manager on payment_links for select
  using (auth_role() = 'branch_manager' and branch_id in (select my_branches()));

-- כתובת האתר, לבניית הקישור בהודעה. הבעלים משנה בהגדרות.
insert into settings (key, value) values ('app_base_url', to_jsonb('https://teichtal-crm.netlify.app'::text))
on conflict (key) do nothing;

create or replace function f_payment_link_alive(l payment_links) returns boolean
language sql stable as $$
  select l.status in ('pending', 'opened') and l.expires_at > now()
$$;
revoke all on function f_payment_link_alive(payment_links) from public, anon, authenticated;

-- ─── יצירה: הבעלים, או מנהלת של הסניף. הסכום = היתרה הפתוחה ברגע זה. ───
create or replace function rpc_create_payment_link(p_student uuid, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students%rowtype; v_balance numeric; v_amount numeric; v_token text; v_id uuid;
  v_base text; v_url text; v_reminder uuid; v_branch_name text; v_first text;
begin
  select * into v_student from students where id = p_student and deleted_at is null;
  if v_student.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and v_student.branch_id in (select my_branches())) then
    raise exception 'אין הרשאה לשלוח קישור תשלום לתלמידה הזו' using errcode = '42501';
  end if;
  if v_student.parent_phone is null then
    raise exception 'לתלמידה אין טלפון של הורה — אין למי לשלוח את הקישור';
  end if;
  select balance into v_balance from v_student_balance where student_id = p_student;
  v_amount := coalesce(p_amount, v_balance);
  if v_amount is null or v_amount <= 0 then raise exception 'אין חוב פתוח לתלמידה הזו'; end if;
  if v_amount > v_balance then raise exception 'הסכום (%) גדול מהחוב הפתוח (%)', v_amount, v_balance; end if;

  -- קישור פתוח קודם לאותה תלמידה מתבטל: קישור אחד חי בכל רגע.
  update payment_links set status = 'cancelled' where student_id = p_student and status in ('pending', 'opened');

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id := gen_random_uuid();
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, created_by)
  values (v_id, v_token, 'tl-' || v_id, p_student, v_student.branch_id, v_amount, auth.uid());

  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  select name into v_branch_name from branches where id = v_student.branch_id;
  v_first := split_part(v_student.full_name, ' ', 1);

  -- ההודעה יוצאת דרך תור התזכורות (cron-reminders → wa-send), כמו כל הודעה אחרת.
  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, created_by, dedupe_key)
  values ('payment_link', p_student, v_student.branch_id, v_student.parent_phone,
          coalesce(v_student.parent_name, '') || ' · ' || v_student.full_name,
          format(E'שלום %s, זה קישור לתשלום עבור %s בחוג של הניה טייכטל (%s): %s\nהסכום: %s ₪. הקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 coalesce(v_student.parent_name, ''), v_first, v_branch_name, v_url, to_char(v_amount, 'FM999,999,990.00')),
          now(), auth.uid(), 'payment_link:' || v_id)
  returning id into v_reminder;
  update payment_links set reminder_id = v_reminder where id = v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'url', v_url, 'amount', v_amount, 'expires_at', now() + interval '7 days');
end $$;
revoke all on function rpc_create_payment_link(uuid, numeric) from public, anon;
grant execute on function rpc_create_payment_link(uuid, numeric) to authenticated;

-- ─── ביטול: הבעלים / מנהלת הסניף. ───
create or replace function rpc_cancel_payment_link(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from payment_links where id = p_id;
  if v_branch is null then raise exception 'הקישור לא נמצא'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and v_branch in (select my_branches())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  update payment_links set status = 'cancelled' where id = p_id and status in ('pending', 'opened');
end $$;
revoke all on function rpc_cancel_payment_link(uuid) from public, anon;
grant execute on function rpc_cancel_payment_link(uuid) to authenticated;

-- ─── הדף הציבורי /pay/<טוקן>: המינימום שההורה צריכה לראות. ───
-- שם פרטי של הבת, הסניף, הסכום, המצב. בלי טלפון, בלי יתרות של אחרות.
create or replace function rpc_payment_link_public(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; v_name text; v_branch text;
begin
  select * into l from payment_links where token = p_token;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  select split_part(full_name, ' ', 1) into v_name from students where id = l.student_id;
  select name into v_branch from branches where id = l.branch_id;
  if l.status in ('paid', 'mismatch') then
    return jsonb_build_object('ok', true, 'state', 'paid', 'student', v_name, 'branch', v_branch, 'amount', l.amount, 'paid_at', l.paid_at);
  end if;
  if not f_payment_link_alive(l) then
    return jsonb_build_object('ok', false, 'state', 'expired', 'error', 'הקישור פג תוקף או בוטל. אפשר לבקש קישור חדש מהחוג.');
  end if;
  if l.status = 'pending' then update payment_links set status = 'opened', opened_at = now() where id = l.id; end if;
  return jsonb_build_object('ok', true, 'state', 'open', 'student', v_name, 'branch', v_branch, 'amount', l.amount,
                            'expires_at', l.expires_at, 'sumit_page_url', l.sumit_page_url);
end $$;
revoke all on function rpc_payment_link_public(text) from public;
grant execute on function rpc_payment_link_public(text) to anon, authenticated;

-- ─── service_role בלבד: מה שהפונקציות עושות אחרי שדיברו עם SUMIT. ───
-- שמירת דף SUMIT שנוצר (sumit-checkout).
create or replace function rpc_payment_link_set_page(p_token text, p_url text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; v_name text; v_phone text; v_branch text;
begin
  select * into l from payment_links where token = p_token;
  if l.id is null or not f_payment_link_alive(l) then return jsonb_build_object('ok', false, 'error', 'הקישור פג תוקף או בוטל'); end if;
  if p_url is not null then update payment_links set sumit_page_url = p_url where id = l.id; end if;
  select full_name, parent_phone into v_name, v_phone from students where id = l.student_id;
  select name into v_branch from branches where id = l.branch_id;
  return jsonb_build_object('ok', true, 'external_identifier', l.external_identifier, 'amount', l.amount,
                            'student_name', v_name, 'parent_phone', v_phone, 'branch', v_branch, 'sumit_page_url', coalesce(p_url, l.sumit_page_url));
end $$;
revoke all on function rpc_payment_link_set_page(text, text) from public, anon, authenticated;
grant execute on function rpc_payment_link_set_page(text, text) to service_role;

-- הקישורים שצריך לבדוק מול SUMIT (cron-sumit-sync).
create or replace function rpc_payment_links_to_sync() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('token', token, 'external_identifier', external_identifier, 'amount', amount, 'status', status)), '[]'::jsonb)
  from payment_links
  -- גם קישורים שפגו לפני פחות מיומיים: תשלום ברגע האחרון עדיין נקלט.
  where status in ('pending', 'opened') and expires_at > now() - interval '2 days'
$$;
revoke all on function rpc_payment_links_to_sync() from public, anon, authenticated;
grant execute on function rpc_payment_links_to_sync() to service_role;

-- ★ רישום תשלום שאושר ב-SUMIT. אידמפוטנטי.
create or replace function rpc_record_sumit_payment(
  p_external_identifier text, p_sumit_payment_id text, p_amount numeric, p_paid_at timestamptz, p_document_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; v_payment uuid; v_status text; v_name text;
begin
  select * into l from payment_links where external_identifier = p_external_identifier for update;
  if l.id is null then
    insert into system_alerts (kind, severity, title, body, meta)
    values ('sumit_orphan_payment', 'critical', 'תשלום ב-SUMIT בלי קישור אצלנו',
            format('SUMIT מדווחת על תשלום %s של %s ₪ עם מזהה %s, ואין לו קישור תשלום במערכת. לבדוק במסך ההתאמה.', p_sumit_payment_id, p_amount, p_external_identifier),
            jsonb_build_object('external_identifier', p_external_identifier, 'sumit_payment_id', p_sumit_payment_id, 'amount', p_amount));
    return jsonb_build_object('ok', false, 'reason', 'no_link');
  end if;
  -- כבר נרשם (אותה הודעה פעמיים, או webhook + cron): לא נוגעים.
  if l.payment_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', l.payment_id, 'status', l.status);
  end if;
  if exists (select 1 from payment_links where sumit_payment_id = p_sumit_payment_id and id <> l.id) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'reason', 'sumit_payment_id_seen');
  end if;

  insert into payments (student_id, branch_id, paid_on, amount, method, source, receipt_no, note)
  values (l.student_id, l.branch_id, coalesce(p_paid_at, now())::date, p_amount, 'credit', 'sumit',
          p_document_id, 'תשלום בכרטיס דרך קישור SUMIT ' || l.external_identifier)
  returning id into v_payment;

  v_status := case when p_amount = l.amount then 'paid' else 'mismatch' end;
  update payment_links set status = v_status, payment_id = v_payment, sumit_payment_id = p_sumit_payment_id,
         sumit_document_id = p_document_id, sumit_amount = p_amount, paid_at = coalesce(p_paid_at, now()), last_checked_at = now()
   where id = l.id;

  select full_name into v_name from students where id = l.student_id;
  if v_status = 'mismatch' then
    insert into system_alerts (kind, severity, title, body, meta)
    values ('sumit_amount_mismatch', 'warning', format('תשלום SUMIT בסכום שונה מהקישור: %s', v_name),
            format('הקישור היה על %s ₪, ב-SUMIT נקלטו %s ₪. התשלום נרשם בסכום שנגבה בפועל. לבדוק במסך ההתאמה.', l.amount, p_amount),
            jsonb_build_object('link_id', l.id, 'expected', l.amount, 'actual', p_amount));
  end if;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('sumit', 'record_payment', 'payments', v_payment, jsonb_build_object('link_id', l.id, 'amount', p_amount, 'sumit_payment_id', p_sumit_payment_id));
  return jsonb_build_object('ok', true, 'duplicate', false, 'payment_id', v_payment, 'status', v_status);
end $$;
revoke all on function rpc_record_sumit_payment(text, text, numeric, timestamptz, text) from public, anon, authenticated;
grant execute on function rpc_record_sumit_payment(text, text, numeric, timestamptz, text) to service_role;

-- פקיעה + סימון "נבדק" (cron-sumit-sync).
create or replace function rpc_payment_links_mark_checked(p_tokens text[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update payment_links set last_checked_at = now() where token = any(p_tokens);
  update payment_links set status = 'expired' where status in ('pending', 'opened') and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function rpc_payment_links_mark_checked(text[]) from public, anon, authenticated;
grant execute on function rpc_payment_links_mark_checked(text[]) to service_role;

-- ─── מסך ההתאמה: מה נרשם ב-SUMIT מול מה שרשום אצלנו. ───
create view v_payment_reconciliation as
select l.id, l.created_at, l.expires_at, l.status, l.amount as link_amount,
       l.sumit_amount, l.sumit_payment_id, l.sumit_document_id, l.paid_at, l.last_checked_at,
       p.amount as recorded_amount, p.id as payment_id,
       s.full_name as student_name, s.parent_name, b.name as branch_name, l.branch_id, l.student_id,
       case
         when l.status = 'mismatch' then 'סכום שונה'
         when l.status = 'paid' and p.id is null then 'שולם ב-SUMIT ולא נרשם'
         when l.status = 'paid' and p.amount <> l.sumit_amount then 'נרשם בסכום אחר'
         when l.status in ('pending','opened') and l.expires_at <= now() then 'פג ולא סומן'
         else null
       end as issue
from payment_links l
join students s on s.id = l.student_id
join branches b on b.id = l.branch_id
left join payments p on p.id = l.payment_id
where auth_role() in ('owner', 'accountant')
   or (auth_role() = 'branch_manager' and l.branch_id in (select my_branches()));
alter view v_payment_reconciliation set (security_invoker = false);
revoke all on v_payment_reconciliation from anon, public;
grant select on v_payment_reconciliation to authenticated;
