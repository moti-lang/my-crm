-- 0036 — SUMIT: רק התשלומים שלנו, ובמעט קריאות.
--
-- ★ פרטיות: עד עכשיו הסנכרון שלף את רשימת כל התשלומים בחשבון ה-SUMIT של הלקוחה
--   ופתח תשלומים וקבלות של לקוחות אחרים כדי למצוא את שלנו. זה נסגר:
--   · תשלום מזוהה רק לפי מזהה ש-SUMIT מסרה עבור הקישור שלנו — בחזרה מדף התשלום
--     (OG-PaymentID + OG-CustomerID + OG-ExternalIdentifier) או ב-IPN שזוהה כשלנו.
--   · בלי מזהה — אין פנייה ל-SUMIT בכלל. אין רשימות, אין סריקה.
--   · IPN שאינו שלנו — לא נשמר (רק נספר).
--   · הוראות קבע: חיוב מזוהה מהלקוחה שלנו (listforcustomer), לא מרשימת כל התשלומים.
-- ★ מכסה: קישור פתוח בלי מזהה לא עולה כלום; הוראות קבע נבדקות פעם ביום, ורק כשיש סיבה.

alter table payment_links
  add column if not exists sumit_pid_candidate text,
  add column if not exists sumit_cid_candidate text,
  add column if not exists candidate_source text check (candidate_source is null or candidate_source in ('redirect', 'ipn')),
  add column if not exists confirm_attempts int not null default 0;

-- מזהה לקוחה ב-SUMIT שכבר אומת עבור התלמידה (מתשלום קודם שלנו / מהוראת קבע).
create or replace function f_student_sumit_customer(p_student uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select l.sumit_customer_id from payment_links l where l.student_id = p_student and l.status = 'paid'
        and nullif(l.sumit_customer_id, '') is not null order by l.paid_at desc nulls last limit 1),
    (select o.sumit_customer_id::text from standing_orders o where o.student_id = p_student and o.sumit_customer_id is not null
        order by o.created_at desc limit 1))
$$;
revoke all on function f_student_sumit_customer(uuid) from public, anon, authenticated;

create or replace function f_link_ref(l payment_links) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('token', l.token, 'external_identifier', l.external_identifier, 'amount', l.amount, 'status', l.status,
    'created_at', l.created_at, 'payment_id', l.sumit_pid_candidate, 'customer_candidate', l.sumit_cid_candidate,
    'known_customer_id', f_student_sumit_customer(l.student_id), 'redirect_id', l.sumit_redirect_id,
    'source', l.candidate_source)
$$;
revoke all on function f_link_ref(payment_links) from public, anon, authenticated;

/**
 * מזהה תשלום ש-SUMIT מסרה לקישור שלנו. מהדפדפן (redirect): רק עם ה-ExternalIdentifier של
 * הקישור, רק לקישור פתוח, ועד 3 ניסיונות — כדי שהורה לא תוכל "לנחש" מזהים של אחרים.
 * מה-IPN (סוד משותף, שרת-לשרת): בלי מגבלת ניסיונות.
 */
create or replace function rpc_payment_link_candidate(p_token text, p_external_identifier text, p_payment_id text,
                                                      p_customer_id text, p_source text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype;
begin
  select * into l from payment_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  if l.status = 'paid' then return jsonb_build_object('ok', true, 'already_paid', true); end if;
  if l.status not in ('pending', 'opened') then return jsonb_build_object('ok', false, 'error', 'הקישור אינו פתוח'); end if;
  if p_external_identifier is distinct from l.external_identifier then
    return jsonb_build_object('ok', false, 'error', 'המזהה אינו של הקישור הזה');
  end if;
  if coalesce(p_payment_id, '') !~ '^[0-9]{1,18}$' or (p_customer_id is not null and p_customer_id !~ '^[0-9]{1,18}$') then
    return jsonb_build_object('ok', false, 'error', 'מזהה תשלום לא תקין');
  end if;
  if p_source = 'redirect' and l.confirm_attempts >= 3 and l.sumit_pid_candidate is distinct from p_payment_id then
    return jsonb_build_object('ok', false, 'error', 'יותר מדי ניסיונות אישור לקישור הזה');
  end if;
  update payment_links set sumit_pid_candidate = p_payment_id, sumit_cid_candidate = p_customer_id, candidate_source = p_source,
         confirm_attempts = confirm_attempts + case when p_source = 'redirect' and sumit_pid_candidate is distinct from p_payment_id then 1 else 0 end
   where id = l.id returning * into l;
  return jsonb_build_object('ok', true, 'link', f_link_ref(l));
end $$;
revoke all on function rpc_payment_link_candidate(text, text, text, text, text) from public, anon, authenticated;
grant execute on function rpc_payment_link_candidate(text, text, text, text, text) to service_role;

/** המזהה לא אומת (לקוחה/סכום/קבלה לא שלנו) — מוחקים אותו, שלא ייבדק שוב. */
create or replace function rpc_payment_link_candidate_rejected(p_token text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payment_links set sumit_pid_candidate = null, sumit_cid_candidate = null, candidate_source = null where token = p_token;
  insert into system_alerts (kind, severity, title, body, meta)
  select 'sumit_candidate_rejected', 'warning', 'מזהה תשלום שהתקבל לקישור לא אומת',
         format('קישור %s: %s. לא נרשם תשלום. אם ההורה שילמה — לבדוק ב-SUMIT ולסמן ידנית.', l.external_identifier, p_reason),
         jsonb_build_object('token', l.token, 'reason', p_reason)
    from payment_links l where l.token = p_token;
end $$;
revoke all on function rpc_payment_link_candidate_rejected(text, text) from public, anon, authenticated;
grant execute on function rpc_payment_link_candidate_rejected(text, text) to service_role;

-- ★ הסנכרון: רק קישורים שיש להם מזהה מ-SUMIT שעוד לא אומת. השאר — אפס קריאות.
create or replace function rpc_payment_links_to_sync() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(f_link_ref(l)), '[]'::jsonb)
  from payment_links l
  where l.status in ('pending', 'opened') and l.sumit_pid_candidate is not null and l.expires_at > now() - interval '2 days'
$$;

-- ★ IPN: נשמר רק אם הוא של קישור שלנו. IPN של לקוח אחר — רק נספר, בלי גוף ובלי מועמדים.
alter table sumit_ipn_log alter column body drop not null;
create or replace function rpc_sumit_ipn_received(p_content_type text, p_body text, p_candidates jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; l payment_links%rowtype;
begin
  select * into l from payment_links
   where (p_candidates ->> 'external_identifier' is not null and external_identifier = p_candidates ->> 'external_identifier')
      or (p_candidates ->> 'redirect_id' is not null and sumit_redirect_id = p_candidates ->> 'redirect_id')
      or (p_candidates ->> 'token' is not null and token = p_candidates ->> 'token')
   order by created_at desc limit 1;
  if l.id is null then
    insert into sumit_ipn_log (content_type, body, candidates, outcome) values (null, null, null, 'not_ours');
    return jsonb_build_object('link', null);
  end if;
  insert into sumit_ipn_log (content_type, body, candidates, outcome)
  values (p_content_type, left(p_body, 20000), p_candidates, 'matched:' || l.external_identifier) returning id into v_id;
  return jsonb_build_object('log_id', v_id, 'link', f_link_ref(l));
end $$;

-- ─────────── הוראות קבע ───────────
-- נבדקות פעם ביום לכל היותר, ורק כשיש סיבה: מועד חיוב הגיע / עבר, עוד לא חויבה
-- לראשונה, נעצרה לאחרונה (אימות הביטול), או שעבר שבוע מהבדיקה האחרונה.
create or replace function rpc_standing_orders_to_check() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'customer_id', o.sumit_customer_id, 'recurring_id', o.sumit_recurring_id,
           'amount', o.amount, 'date_start', o.date_start, 'last_checked_at', o.last_checked_at, 'status', o.status)), '[]'::jsonb)
  from standing_orders o
  where o.sumit_recurring_id is not null
    and (o.status in ('active', 'retrying', 'failed')
         or (o.status = 'cancelled' and o.cancelled_at > now() - interval '14 days'))
    and (o.last_checked_at is null or o.last_checked_at < now() - interval '20 hours')
    and (o.status = 'cancelled' or o.next_billing is null or o.next_billing <= current_date + 1
         or o.last_checked_at is null or o.last_checked_at < now() - interval '7 days')
$$;

/**
 * מה ש-SUMIT מדווחת על ההוראה (listforcustomer, הלקוחה שלנו בלבד). חיוב מזוהה כאן:
 * Date_PreviousBilling שהתקדם מעבר למה שידענו = חיוב חדש באותו תאריך. מזהה התשלום
 * הסינתטי (שלילי: הוראה × תאריך) שומר על אידמפוטנטיות בלי לגעת ברשימת התשלומים.
 * חיוב שנכשל מזוהה מהסטטוס (rpc_standing_order_status מתריע).
 */
create or replace function rpc_standing_billing_observed(p_id uuid, p_sumit_status int, p_next date, p_prev date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_charge jsonb := null; v_status text;
begin
  select * into o from standing_orders where id = p_id;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  v_status := coalesce(f_standing_status(p_sumit_status), o.status);
  if p_prev is not null and (o.last_billing is null or p_prev > o.last_billing)
     and v_status in ('active', 'completed')
     and not exists (select 1 from standing_order_charges c where c.standing_order_id = o.id and c.charged_at::date = p_prev) then
    v_charge := rpc_record_standing_charge(o.id, -(o.sumit_recurring_id::bigint * 100000000 + to_char(p_prev, 'YYYYMMDD')::bigint),
                                           o.amount, p_prev::timestamptz, true, null);
  end if;
  return jsonb_build_object('ok', true, 'charge', v_charge, 'status', rpc_standing_order_status(p_id, p_sumit_status, p_next, p_prev));
end $$;
revoke all on function rpc_standing_billing_observed(uuid, int, date, date) from public, anon, authenticated;
grant execute on function rpc_standing_billing_observed(uuid, int, date, date) to service_role;
