-- 0028 — הוראת קבע ב-SUMIT (סבב 3).
--
-- הזרימה:
--  1. /pay של קישור הרשמה במסלול הוראת קבע מציג את הנוסח המלא — "אני מאשרת
--     חיוב של X ש"ח היום, ו-N חיובים חודשיים של Y ש"ח בתאריכים הבאים: ..." —
--     עם התאריכים בפועל, ותיבה לא מסומנת. בלי סימון אין דף תשלום.
--     הנוסח המדויק נשמר על הקישור (standing_consent_text) ברגע האישור.
--  2. ההורה משלמת את החיוב הראשון בדף של SUMIT. SUMIT שומרת את הכרטיס אצל
--     הלקוחה (ברירת המחדל של beginredirect).
--  3. הסנכרון רואה את הקישור שולם → יוצר הוראת קבע ב-SUMIT
--     (billing/recurring/charge) על הכרטיס השמור, מהחודש הבא, ליתר התשלומים.
--  4. בכל ריצה: מצב ההוראה מ-SUMIT (listforcustomer) והחיובים שנקלטו
--     (payments/list לפי הלקוחה). חיוב תקין → תשלום ויתרה. חיוב שנדחה →
--     התראה לבעלים. התלמידה לא הופכת ללא-פעילה אוטומטית.
--  5. עצירה: הבעלים, דרך הפונקציה standing-order-cancel — מבטלת ב-SUMIT
--     קודם, ורק אם SUMIT אישרה מסמנת אצלנו.

alter table payment_links
  add column if not exists standing_consent_text text,
  add column if not exists standing_consented_at timestamptz;

create table if not exists standing_orders (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  branch_id         uuid not null references branches(id),
  payment_link_id   uuid not null unique references payment_links(id),
  sumit_customer_id bigint not null,
  sumit_recurring_id bigint,
  amount            numeric(10,2) not null check (amount > 0),
  installments      int not null check (installments > 0),   -- כמה חיובים בהוראה (בלי החיוב הראשון)
  installments_total int not null,                           -- כולל החיוב הראשון — "חיוב X מתוך N"
  date_start        date not null,
  status            text not null default 'active'
                    check (status in ('active', 'retrying', 'failed', 'setup_failed', 'cancelled', 'completed')),
  sumit_status      int,
  next_billing      date,
  last_billing      date,
  charged_count     int not null default 0,
  failed_count      int not null default 0,
  consent_text      text not null,
  consented_at      timestamptz not null,
  last_error        text,
  last_checked_at   timestamptz,
  cancelled_at      timestamptz,
  cancelled_by      uuid references profiles(id),
  created_at        timestamptz not null default now()
);
create index if not exists standing_orders_student_idx on standing_orders(student_id);

-- כל חיוב של הוראת קבע, פעם אחת (מזהה התשלום ב-SUMIT ייחודי).
create table if not exists standing_order_charges (
  id               uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  sumit_payment_id bigint not null unique,
  amount           numeric(10,2) not null,
  charged_at       timestamptz,
  valid            boolean not null,
  payment_id       uuid references payments(id),
  document_url     text,
  created_at       timestamptz not null default now()
);

alter table standing_orders enable row level security;
alter table standing_order_charges enable row level security;
revoke all on standing_orders, standing_order_charges from anon, public;
grant select on standing_orders, standing_order_charges to authenticated;
grant all on standing_orders, standing_order_charges to service_role;
create policy standing_orders_read on standing_orders for select using (
  auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and branch_id in (select my_branches())));
create policy standing_order_charges_read on standing_order_charges for select using (
  exists (select 1 from standing_orders o where o.id = standing_order_id
           and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches())))));

-- ─────────── התאריכים והנוסח — מקור אחד ───────────
-- החיובים החודשיים: מהחודש הבא, באותו יום בחודש (חודש קצר → היום האחרון שלו).
create or replace function f_standing_dates(p_from date, p_count int) returns date[]
language sql immutable as $$
  select coalesce(array_agg((p_from + make_interval(months => i))::date order by i), '{}')
  from generate_series(1, greatest(p_count, 0)) i
$$;
revoke all on function f_standing_dates(date, int) from public, anon, authenticated;

-- הנוסח להורה, לפי המסלול שנשמר אצל התלמידה. null = הקישור אינו של הוראת קבע.
create or replace function f_standing_consent(p_link uuid, p_on date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; t jsonb; v_n int; v_each numeric; v_dates date[];
begin
  select * into l from payment_links where id = p_link;
  if l.id is null or l.purpose <> 'enrollment' then return null; end if;
  select payment_track into t from students where id = l.student_id;
  if t is null or t ->> 'method' <> 'standing_order' or (t ->> 'installments')::int < 2 then return null; end if;
  v_n := (t ->> 'installments')::int - 1;
  v_each := (t ->> 'installment_amount')::numeric;
  v_dates := f_standing_dates(p_on, v_n);
  return jsonb_build_object(
    'first', l.amount, 'count', v_n, 'each', v_each, 'dates', to_jsonb(v_dates),
    'text', format('אני מאשרת חיוב של %s ש"ח היום, ו-%s חיובים חודשיים של %s ש"ח בתאריכים הבאים: %s',
                   to_char(l.amount, 'FM999,990'), v_n, to_char(v_each, 'FM999,990'),
                   (select string_agg(to_char(d, 'DD/MM/YYYY'), ', ' order by d) from unnest(v_dates) d)));
end $$;
revoke all on function f_standing_consent(uuid, date) from public, anon, authenticated;

-- ─────────── /pay: גם הנוסח של הוראת הקבע ───────────
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
                            'expires_at', l.expires_at, 'sumit_page_url', l.sumit_page_url,
                            -- הוראת קבע: הנוסח והתאריכים. אחרי שאושר — מה שאושר.
                            'standing', case when l.standing_consented_at is not null
                                             then jsonb_build_object('text', l.standing_consent_text, 'consented', true)
                                             else f_standing_consent(l.id) end);
end $$;
revoke all on function rpc_payment_link_public(text) from public;
grant execute on function rpc_payment_link_public(text) to anon, authenticated;

-- sumit-checkout (service_role): ההורה סימנה את התיבה → שומרים את הנוסח המדויק.
create or replace function rpc_standing_consent(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; c jsonb;
begin
  select * into l from payment_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  if l.standing_consented_at is not null then return jsonb_build_object('ok', true, 'required', true, 'text', l.standing_consent_text); end if;
  c := f_standing_consent(l.id);
  if c is null then return jsonb_build_object('ok', true, 'required', false); end if;
  update payment_links set standing_consent_text = c ->> 'text', standing_consented_at = now() where id = l.id;
  return jsonb_build_object('ok', true, 'required', true, 'text', c ->> 'text');
end $$;
revoke all on function rpc_standing_consent(text) from public, anon, authenticated;
grant execute on function rpc_standing_consent(text) to service_role;

-- האם הקישור דורש אישור הוראת קבע לפני דף התשלום (sumit-checkout שואלת).
create or replace function rpc_standing_consent_required(p_token text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select f_standing_consent(id) is not null and standing_consented_at is null from payment_links where token = p_token
$$;
revoke all on function rpc_standing_consent_required(text) from public, anon, authenticated;
grant execute on function rpc_standing_consent_required(text) to service_role;

-- ─────────── הסנכרון (service_role) ───────────
-- קישורים ששולמו, עם אישור הוראת קבע, שעוד אין להם הוראה.
create or replace function rpc_standing_orders_to_setup() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'link_id', l.id, 'student_id', s.id, 'student_name', s.full_name, 'branch', b.name,
    'customer_id', l.sumit_customer_id, 'external_identifier', l.external_identifier,
    'amount', (s.payment_track ->> 'installment_amount')::numeric,
    'installments', (s.payment_track ->> 'installments')::int - 1,
    'installments_total', (s.payment_track ->> 'installments')::int,
    'date_start', (l.standing_consented_at::date + interval '1 month')::date,
    'consent_text', l.standing_consent_text, 'consented_at', l.standing_consented_at)), '[]'::jsonb)
  from payment_links l
  join students s on s.id = l.student_id
  join branches b on b.id = l.branch_id
  where l.status in ('paid', 'mismatch') and l.standing_consented_at is not null
    and s.payment_track ->> 'method' = 'standing_order' and s.cancelled_at is null
    and not exists (select 1 from standing_orders o where o.payment_link_id = l.id)
$$;
revoke all on function rpc_standing_orders_to_setup() from public, anon, authenticated;
grant execute on function rpc_standing_orders_to_setup() to service_role;

-- תוצאת היצירה ב-SUMIT: הוראה פעילה, או "יצירה נכשלה" + התראה.
create or replace function rpc_standing_order_created(p_link uuid, p_ok boolean, p_customer_id bigint, p_recurring_id bigint, p_error text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; s students%rowtype; v_id uuid;
begin
  select * into l from payment_links where id = p_link;
  select * into s from students where id = l.student_id;
  insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, status, next_billing, charged_count, consent_text, consented_at, last_error)
  values (s.id, l.branch_id, l.id, p_customer_id, p_recurring_id, (s.payment_track ->> 'installment_amount')::numeric,
          (s.payment_track ->> 'installments')::int - 1, (s.payment_track ->> 'installments')::int,
          (l.standing_consented_at::date + interval '1 month')::date,
          case when p_ok then 'active' else 'setup_failed' end,
          case when p_ok then (l.standing_consented_at::date + interval '1 month')::date end, 0,
          l.standing_consent_text, l.standing_consented_at, p_error)
  on conflict (payment_link_id) do nothing
  returning id into v_id;
  if not p_ok then
    insert into system_alerts (kind, severity, title, body, meta)
    values ('standing_order_setup_failed', 'critical', 'הוראת קבע לא נוצרה ב-SUMIT',
            format('%s שילמה את החיוב הראשון, אבל יצירת הוראת הקבע נכשלה: %s. יש ליצור ידנית ב-SUMIT או לפנות להורה.', s.full_name, coalesce(p_error, 'לא ידוע')),
            jsonb_build_object('student_id', s.id, 'link_id', l.id));
  end if;
  return v_id;
end $$;
revoke all on function rpc_standing_order_created(uuid, boolean, bigint, bigint, text) from public, anon, authenticated;
grant execute on function rpc_standing_order_created(uuid, boolean, bigint, bigint, text) to service_role;

-- הוראות לבדיקה בריצה.
create or replace function rpc_standing_orders_to_check() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'customer_id', o.sumit_customer_id, 'recurring_id', o.sumit_recurring_id,
           'amount', o.amount, 'date_start', o.date_start, 'last_checked_at', o.last_checked_at, 'status', o.status)), '[]'::jsonb)
  from standing_orders o where o.status in ('active', 'retrying', 'failed') and o.sumit_recurring_id is not null
$$;
revoke all on function rpc_standing_orders_to_check() from public, anon, authenticated;
grant execute on function rpc_standing_orders_to_check() to service_role;

-- מצב ההוראה ב-SUMIT → המצב אצלנו. מעבר לכישלון/ניסיון חוזר → התראה באותה ריצה.
-- קודי SUMIT: 0 פעילה · 1 בוטלה · 3 הושבתה אחרי כישלון · 9 הסתיימה · 11 תקופת חסד ·
-- 12 ממתינה לחיוב ראשון · 13 בוטלה ע"י הלקוחה · 14 ממתינה לניסיון חוזר.
create or replace function f_standing_status(p_sumit int) returns text language sql immutable as $$
  select case p_sumit when 0 then 'active' when 12 then 'active' when 1 then 'cancelled' when 13 then 'cancelled'
                      when 3 then 'failed' when 9 then 'completed' when 11 then 'retrying' when 14 then 'retrying' else null end
$$;
revoke all on function f_standing_status(int) from public, anon, authenticated;

create or replace function rpc_standing_order_status(p_id uuid, p_sumit_status int, p_next date, p_last date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_new text; v_name text;
begin
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  v_new := coalesce(f_standing_status(p_sumit_status), o.status);
  update standing_orders set sumit_status = p_sumit_status, status = v_new, next_billing = p_next,
         last_billing = coalesce(p_last, last_billing), last_checked_at = now(),
         cancelled_at = case when v_new = 'cancelled' and cancelled_at is null then now() else cancelled_at end
   where id = o.id;
  if v_new <> o.status then
    select full_name into v_name from students where id = o.student_id;
    if v_new in ('failed', 'retrying') then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_failed', case when v_new = 'failed' then 'critical' else 'warning' end,
              case when v_new = 'failed' then 'הוראת קבע הושבתה אחרי חיוב שנכשל' else 'חיוב בהוראת קבע נדחה — SUMIT תנסה שוב' end,
              format('%s: %s. התלמידה נשארת פעילה. כדאי ליצור קשר עם ההורה (ייתכן כרטיס שפג תוקפו).', v_name,
                     case when v_new = 'failed' then 'SUMIT הפסיקה לחייב' else 'החיוב לא עבר' end),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_status', p_sumit_status));
    elsif v_new = 'cancelled' and o.status <> 'cancelled' then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_cancelled', 'warning', 'הוראת קבע בוטלה ב-SUMIT',
              format('%s: הוראת הקבע בוטלה ב-SUMIT (קוד %s). החיובים הבאים לא ייגבו.', v_name, p_sumit_status),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', v_new, 'changed', v_new <> o.status);
end $$;
revoke all on function rpc_standing_order_status(uuid, int, date, date) from public, anon, authenticated;
grant execute on function rpc_standing_order_status(uuid, int, date, date) to service_role;

-- ★ חיוב שנקלט: תקין → תשלום ויתרה (פעם אחת לכל מזהה). נדחה → התראה (פעם אחת).
create or replace function rpc_record_standing_charge(p_order uuid, p_sumit_payment_id bigint, p_amount numeric,
                                                      p_charged_at timestamptz, p_valid boolean, p_document_url text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_payment uuid; v_name text;
begin
  select * into o from standing_orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;
  if exists (select 1 from standing_order_charges where sumit_payment_id = p_sumit_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_valid then
    insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
    values (o.student_id, o.branch_id, coalesce(p_charged_at, now())::date, p_amount, 'credit', 'sumit',
            format('הוראת קבע SUMIT · חיוב %s מתוך %s', o.charged_count + 2, o.installments_total))
    returning id into v_payment;
    update standing_orders set charged_count = charged_count + 1 where id = o.id;
  else
    update standing_orders set failed_count = failed_count + 1 where id = o.id;
    select full_name into v_name from students where id = o.student_id;
    insert into system_alerts (kind, severity, title, body, meta)
    values ('standing_charge_declined', 'warning', 'חיוב בהוראת קבע נדחה',
            format('%s: חיוב של %s ₪ נדחה ב-%s. התלמידה נשארת פעילה; SUMIT מנסה שוב לפי ההגדרות שלה. כדאי ליצור קשר עם ההורה.',
                   v_name, p_amount, to_char(coalesce(p_charged_at, now()), 'DD/MM/YYYY')),
            jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_payment_id', p_sumit_payment_id));
  end if;
  insert into standing_order_charges (standing_order_id, sumit_payment_id, amount, charged_at, valid, payment_id, document_url)
  values (o.id, p_sumit_payment_id, p_amount, p_charged_at, p_valid, v_payment, p_document_url);
  return jsonb_build_object('ok', true, 'duplicate', false, 'valid', p_valid);
end $$;
revoke all on function rpc_record_standing_charge(uuid, bigint, numeric, timestamptz, boolean, text) from public, anon, authenticated;
grant execute on function rpc_record_standing_charge(uuid, bigint, numeric, timestamptz, boolean, text) to service_role;

-- ─────────── עצירה (הבעלים) ───────────
-- שלב 1: הבעלים מבקשת — מחזירים את המזהים ל-SUMIT. בלי לסמן כלום.
create or replace function rpc_standing_order_cancel_request(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לעצור הוראת קבע' using errcode = '42501'; end if;
  select * into o from standing_orders where id = p_id;
  if o.id is null then raise exception 'הוראת הקבע לא נמצאה'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'הוראת הקבע כבר אינה פעילה'; end if;
  if o.sumit_recurring_id is null then raise exception 'להוראה הזו אין מזהה ב-SUMIT (היצירה נכשלה) — אין מה לעצור שם'; end if;
  return jsonb_build_object('customer_id', o.sumit_customer_id, 'recurring_id', o.sumit_recurring_id);
end $$;
revoke all on function rpc_standing_order_cancel_request(uuid) from public, anon;
grant execute on function rpc_standing_order_cancel_request(uuid) to authenticated;

-- שלב 2 (service_role): רק אחרי ש-SUMIT אישרה את הביטול.
create or replace function rpc_standing_order_cancelled(p_id uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update standing_orders set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by, next_billing = null where id = p_id;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(p_by::text, '?'), 'cancel_standing_order', 'standing_orders', p_id, jsonb_build_object('cancelled_in_sumit', true));
end $$;
revoke all on function rpc_standing_order_cancelled(uuid, uuid) from public, anon, authenticated;
grant execute on function rpc_standing_order_cancelled(uuid, uuid) to service_role;

-- ─────────── מסך "הוראות קבע" ───────────
create or replace view v_standing_orders as
select o.id, o.student_id, s.full_name, o.branch_id, b.name as branch_name, o.status, o.sumit_status,
       o.amount, o.installments_total, o.charged_count + 1 as charged_total,   -- כולל החיוב הראשון
       o.failed_count, o.date_start, o.next_billing, o.last_billing, o.last_error, o.last_checked_at,
       o.cancelled_at, o.created_at,
       (o.status in ('failed', 'retrying', 'setup_failed')) as needs_attention
from standing_orders o join students s on s.id = o.student_id join branches b on b.id = o.branch_id
where auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches()));
alter view v_standing_orders set (security_invoker = false);
revoke all on v_standing_orders from anon, public;
grant select on v_standing_orders to authenticated;
