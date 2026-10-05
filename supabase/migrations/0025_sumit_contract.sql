-- 0025 — מה שנלמד מ-SUMIT בפועל (docs/sumit-contract.md):
--   · beginredirect מחזירה redirectid — נשמר על הקישור, למקרה שה-IPN יצטט אותו.
--   · SUMIT לא בהכרח שומרת את ה-ExternalIdentifier שלנו על התשלום. ההתאמה
--     היא לפי מזהה כשיש, ואחרת לפי שם הלקוחה + סכום + זמן (רק כשיש מועמד יחיד).
--   · כל IPN נכנס נרשם גולמי — הראיה הראשונה לפורמט תגיע מהשטח.
alter table payment_links
  add column if not exists sumit_redirect_id text,
  add column if not exists sumit_customer_id text,
  add column if not exists sumit_document_url text,
  add column if not exists match_method text check (match_method in ('external_identifier','redirect_id','payment_id','heuristic'));
create index if not exists payment_links_redirect_idx on payment_links (sumit_redirect_id) where sumit_redirect_id is not null;

create table sumit_ipn_log (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  content_type  text,
  body          text not null,
  candidates    jsonb,
  outcome       text
);
alter table sumit_ipn_log enable row level security;
revoke all on sumit_ipn_log from anon, public;
grant select on sumit_ipn_log to authenticated;
create policy sumit_ipn_owner on sumit_ipn_log for select using (auth_role() = 'owner');
grant all on sumit_ipn_log to service_role;

-- הדף נוצר: שומרים גם את redirectid.
create or replace function rpc_payment_link_set_page(p_token text, p_url text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; v_name text; v_phone text; v_branch text; v_rid text;
begin
  select * into l from payment_links where token = p_token;
  if l.id is null or not f_payment_link_alive(l) then return jsonb_build_object('ok', false, 'error', 'הקישור פג תוקף או בוטל'); end if;
  if p_url is not null then
    v_rid := substring(p_url from 'redirectid=([0-9a-fA-F-]+)');
    update payment_links set sumit_page_url = p_url, sumit_redirect_id = coalesce(v_rid, sumit_redirect_id) where id = l.id;
  end if;
  select full_name, parent_phone into v_name, v_phone from students where id = l.student_id;
  select name into v_branch from branches where id = l.branch_id;
  return jsonb_build_object('ok', true, 'external_identifier', l.external_identifier, 'amount', l.amount,
                            'student_name', v_name, 'parent_phone', v_phone, 'branch', v_branch,
                            'sumit_page_url', coalesce(p_url, l.sumit_page_url), 'created_at', l.created_at);
end $$;

-- הקישורים לסנכרון, עם מה שצריך להתאמה: שם הלקוחה, סכום, זמן יצירה, redirectid.
create or replace function rpc_payment_links_to_sync() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'token', l.token, 'external_identifier', l.external_identifier, 'amount', l.amount, 'status', l.status,
    'created_at', l.created_at, 'customer_name', s.full_name, 'redirect_id', l.sumit_redirect_id)), '[]'::jsonb)
  from payment_links l join students s on s.id = l.student_id
  where l.status in ('pending', 'opened') and l.expires_at > now() - interval '2 days'
$$;

-- IPN: רישום גולמי + איתור קישור לפי כל מועמד.
create or replace function rpc_sumit_ipn_received(p_content_type text, p_body text, p_candidates jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; l payment_links%rowtype; s record;
begin
  insert into sumit_ipn_log (content_type, body, candidates) values (p_content_type, left(p_body, 20000), p_candidates) returning id into v_id;
  select * into l from payment_links
   where (p_candidates ->> 'external_identifier' is not null and external_identifier = p_candidates ->> 'external_identifier')
      or (p_candidates ->> 'redirect_id' is not null and sumit_redirect_id = p_candidates ->> 'redirect_id')
      or (p_candidates ->> 'token' is not null and token = p_candidates ->> 'token')
   order by created_at desc limit 1;
  if l.id is null then
    update sumit_ipn_log set outcome = 'no_link' where id = v_id;
    return jsonb_build_object('log_id', v_id, 'link', null);
  end if;
  select full_name into s from students where id = l.student_id;
  update sumit_ipn_log set outcome = 'matched:' || l.external_identifier where id = v_id;
  return jsonb_build_object('log_id', v_id, 'link', jsonb_build_object('token', l.token, 'external_identifier', l.external_identifier,
    'amount', l.amount, 'status', l.status, 'created_at', l.created_at, 'customer_name', s.full_name, 'redirect_id', l.sumit_redirect_id));
end $$;
revoke all on function rpc_sumit_ipn_received(text, text, jsonb) from public, anon, authenticated;
grant execute on function rpc_sumit_ipn_received(text, text, jsonb) to service_role;

-- הרישום מקבל גם את שיטת ההתאמה ואת מזהה הלקוח ב-SUMIT. הגרסה הקודמת
-- הופכת לליבה פנימית (אין עומס-יתר: חתימה אחת בשם rpc_record_sumit_payment).
alter function rpc_record_sumit_payment(text, text, numeric, timestamptz, text) rename to f_record_sumit_payment_core;
revoke all on function f_record_sumit_payment_core(text, text, numeric, timestamptz, text) from public, anon, authenticated, service_role;
create function rpc_record_sumit_payment(
  p_external_identifier text, p_sumit_payment_id text, p_amount numeric, p_paid_at timestamptz, p_document_id text default null,
  p_match_method text default 'external_identifier', p_sumit_customer_id text default null, p_document_url text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  r := f_record_sumit_payment_core(p_external_identifier, p_sumit_payment_id, p_amount, p_paid_at, p_document_id);
  if (r ->> 'ok')::boolean and not coalesce((r ->> 'duplicate')::boolean, false) then
    update payment_links set match_method = p_match_method, sumit_customer_id = p_sumit_customer_id, sumit_document_url = p_document_url
     where external_identifier = p_external_identifier;
    if p_match_method = 'heuristic' then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('sumit_heuristic_match', 'info', 'תשלום SUMIT הותאם לפי שם וסכום (לא לפי מזהה)',
              format('הקישור %s הותאם לתשלום %s לפי שם הלקוחה, הסכום והזמן. לוודא במסך ההתאמה.', p_external_identifier, p_sumit_payment_id),
              jsonb_build_object('external_identifier', p_external_identifier, 'sumit_payment_id', p_sumit_payment_id));
    end if;
  end if;
  return r;
end $$;
revoke all on function rpc_record_sumit_payment(text, text, numeric, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function rpc_record_sumit_payment(text, text, numeric, timestamptz, text, text, text, text) to service_role;

-- מסך ההתאמה: קישור לקבלה.
drop view if exists v_payment_reconciliation;
create view v_payment_reconciliation as
select l.id, l.created_at, l.expires_at, l.status, l.amount as link_amount,
       l.sumit_amount, l.sumit_payment_id, l.sumit_document_id, l.sumit_document_url, l.match_method, l.paid_at, l.last_checked_at,
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
