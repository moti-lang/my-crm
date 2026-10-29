-- 0041 — יום החיוב בהוראת קבע.
--
-- ★ שלושה דברים:
--   1. הבעלים משנה את יום החיוב של הוראה קיימת ("שינוי יום חיוב"). הלב — התאריך הבא:
--        · חויבה כבר החודש (בהוראה, או בתשלום הראשון)  → היום שנבחר, בחודש הבא.
--        · לא חויבה החודש, והיום שנבחר עוד לפנינו       → היום שנבחר, החודש.
--        · לא חויבה החודש, והיום שנבחר עבר (או היום)     → היום שנבחר, בחודש הבא.
--      כך אין שני חיובים באותו חודש. מספר החיובים שנותרו לא משתנה — רק התאריכים.
--      ב-SUMIT: /billing/recurring/update/ עם NextPaymentDate ו-Recurrence (= החיובים שנותרו).
--      אומת מול SUMIT על הוראת הבדיקה (29/10/2026): התאריך הבא והאחרון זזו, הסכום לא השתנה.
--   2. ההורה בוחרת יום חיוב (1–28) בהרשמה. נוסח האישור מציג את היום ואת התאריכים בפועל,
--      והתאריך הראשון נשמר על הקישור ברגע האישור — ההוראה נוצרת בדיוק לפיו.
--   3. שינוי שנעשה ידנית ב-SUMIT: הסנכרון מזהה (התאריך הבא זז בלי חיוב), מעדכן, רושם ביומן
--      ומודיע — ולא רושם חיוב. ואם מספר החיובים שנותרו ב-SUMIT שונה מהתוכנית — התראה.
--   יומן הוראות הקבע (standing_order_events): מי שינה, מתי, מאיזה תאריך לאיזה.

-- היום בישראל (current_date של השרת הוא UTC: בחצות בישראל הוא עדיין "אתמול").
create or replace function f_today_il() returns date language sql stable as $$
  select (now() at time zone 'Asia/Jerusalem')::date
$$;

alter table standing_orders add column if not exists billing_day int check (billing_day between 1 and 31);
update standing_orders set billing_day = extract(day from coalesce(next_billing, date_start))::int where billing_day is null;
-- התאריך הראשון של הוראת הקבע כפי שהופיע בנוסח שההורה אישרה.
alter table payment_links add column if not exists standing_date_start date;

-- ─────────── יומן הוראות הקבע ───────────
create table if not exists standing_order_events (
  id                uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  -- reschedule: שינוי דרך המערכת · sumit_change: שינוי שנעשה ב-SUMIT ונקלט בסנכרון.
  kind              text not null check (kind in ('reschedule', 'sumit_change')),
  from_date         date,
  to_date           date,
  from_day          int,
  to_day            int,
  remaining         int,
  actor             uuid references profiles(id) on delete set null,
  actor_label       text not null,
  created_at        timestamptz not null default now()
);
create index if not exists standing_order_events_order_idx on standing_order_events (standing_order_id, created_at desc);
alter table standing_order_events enable row level security;
revoke all on standing_order_events from anon, public;
revoke insert, update, delete, truncate on standing_order_events from authenticated;
grant select on standing_order_events to authenticated;
grant all on standing_order_events to service_role;
create policy standing_order_events_read on standing_order_events for select using (
  exists (select 1 from standing_orders o where o.id = standing_order_id
           and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches())))));

-- ─────────── התאריכים — טהור ───────────
-- היום p_day בחודש של p_month (חודש קצר → היום האחרון שלו).
create or replace function f_month_day(p_month date, p_day int) returns date language sql immutable as $$
  select (date_trunc('month', p_month::timestamp)
          + make_interval(days => least(p_day, extract(day from date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::int) - 1))::date
$$;
-- האם התאריך נופל ביום החיוב (בחודש קצר — היום האחרון שלו).
create or replace function f_on_billing_day(p_date date, p_day int) returns boolean language sql immutable as $$
  select p_date = f_month_day(p_date, p_day)
$$;
-- הפרש בחודשים בין שני תאריכים (לפי חודש ושנה בלבד).
create or replace function f_months_between(p_from date, p_to date) returns int language sql immutable as $$
  select ((extract(year from p_to) - extract(year from p_from)) * 12 + extract(month from p_to) - extract(month from p_from))::int
$$;

-- ★ החיובים מהחודש שאחרי p_today, ביום p_day (1–28): החיוב הראשון בהרשמה הוא של החודש הזה.
create or replace function f_standing_dates_on_day(p_today date, p_day int, p_count int) returns date[]
language sql immutable as $$
  select coalesce(array_agg(f_month_day((p_today + make_interval(months => i))::date, p_day) order by i), '{}')
  from generate_series(1, greatest(p_count, 0)) i
$$;

-- ★ התאריך הבא כשמשנים את יום החיוב (ראו הכללים בראש הקובץ).
create or replace function f_standing_next_on_day(p_day int, p_today date, p_last_charge date) returns date
language sql immutable as $$
  select case
    when p_last_charge is not null and p_last_charge >= date_trunc('month', p_today::timestamp)::date
      then f_month_day((p_today + interval '1 month')::date, p_day)
    when p_day > extract(day from p_today)
      then f_month_day(p_today, p_day)
    else f_month_day((p_today + interval '1 month')::date, p_day)
  end
$$;
revoke all on function f_standing_dates_on_day(date, int, int) from public, anon, authenticated;
revoke all on function f_today_il() from public, anon, authenticated;
revoke all on function f_month_day(date, int) from public, anon, authenticated;
revoke all on function f_on_billing_day(date, int) from public, anon, authenticated;
revoke all on function f_months_between(date, date) from public, anon, authenticated;
revoke all on function f_standing_next_on_day(int, date, date) from public, anon, authenticated;

-- ─────────── הנוסח להורה: עם יום החיוב שבחרה ───────────
-- בלי יום חיוב (הרשמה לפני 0041, או מסלול שלא נשאל) — הנוסח והתאריכים כמו קודם.
create or replace function f_standing_consent(p_link uuid, p_on date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; t jsonb; v_n int; v_each numeric; v_dates date[]; v_day int; v_text text; v_list text;
begin
  select * into l from payment_links where id = p_link;
  if l.id is null or l.purpose <> 'enrollment' then return null; end if;
  select payment_track into t from students where id = l.student_id;
  if t is null or t ->> 'method' <> 'standing_order' or (t ->> 'installments')::int < 2 then return null; end if;
  v_n := (t ->> 'installments')::int - 1;
  v_each := (t ->> 'installment_amount')::numeric;
  v_day := case when t ->> 'billing_day' ~ '^[0-9]{1,2}$' and (t ->> 'billing_day')::int between 1 and 28 then (t ->> 'billing_day')::int end;
  if v_day is null then
    v_dates := f_standing_dates(coalesce(p_on, current_date), v_n);
    v_text := format('אני מאשרת חיוב של %s ש"ח היום, ו-%s חיובים חודשיים של %s ש"ח בתאריכים הבאים: %s',
                     to_char(l.amount, 'FM999,990'), v_n, to_char(v_each, 'FM999,990'),
                     (select string_agg(to_char(d, 'DD/MM/YYYY'), ', ' order by d) from unnest(v_dates) d));
  else
    v_dates := f_standing_dates_on_day(coalesce(p_on, f_today_il()), v_day, v_n);
    v_list := (select string_agg(to_char(d, 'DD/MM/YYYY'), ', ' order by d) from unnest(v_dates) d);
    v_text := case when v_n = 1
      then format('אני מאשרת חיוב של %s ש"ח היום, וחיוב נוסף של %s ש"ח ב-%s',
                  to_char(l.amount, 'FM999,990'), to_char(v_each, 'FM999,990'), v_list)
      else format('אני מאשרת חיוב של %s ש"ח היום, ו-%s חיובים חודשיים של %s ש"ח, ב-%s בכל חודש, בתאריכים הבאים: %s',
                  to_char(l.amount, 'FM999,990'), v_n, to_char(v_each, 'FM999,990'), v_day, v_list) end;
  end if;
  return jsonb_build_object('first', l.amount, 'count', v_n, 'each', v_each, 'dates', to_jsonb(v_dates), 'billing_day', v_day, 'text', v_text);
end $$;
revoke all on function f_standing_consent(uuid, date) from public, anon, authenticated;

-- האישור: הנוסח המדויק, וגם התאריך הראשון שבו — ההוראה תיווצר לפיו.
create or replace function rpc_standing_consent(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; c jsonb;
begin
  select * into l from payment_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  if l.standing_consented_at is not null then return jsonb_build_object('ok', true, 'required', true, 'text', l.standing_consent_text); end if;
  c := f_standing_consent(l.id);
  if c is null then return jsonb_build_object('ok', true, 'required', false); end if;
  update payment_links set standing_consent_text = c ->> 'text', standing_consented_at = now(),
         standing_date_start = (c -> 'dates' ->> 0)::date
   where id = l.id;
  return jsonb_build_object('ok', true, 'required', true, 'text', c ->> 'text');
end $$;
revoke all on function rpc_standing_consent(text) from public, anon, authenticated;
grant execute on function rpc_standing_consent(text) to service_role;

-- התאריך הראשון: מה שאושר. אישור לפני 0041 — כמו קודם (חודש אחרי האישור).
create or replace function f_link_standing_start(l payment_links) returns date language sql stable as $$
  select coalesce(l.standing_date_start, (l.standing_consented_at::date + interval '1 month')::date)
$$;
revoke all on function f_link_standing_start(payment_links) from public, anon, authenticated;

create or replace function rpc_standing_orders_to_setup() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'link_id', l.id, 'student_id', s.id, 'student_name', s.full_name, 'branch', b.name,
    'customer_id', l.sumit_customer_id, 'external_identifier', l.external_identifier,
    'amount', (s.payment_track ->> 'installment_amount')::numeric,
    'installments', (s.payment_track ->> 'installments')::int - 1,
    'installments_total', (s.payment_track ->> 'installments')::int,
    'date_start', f_link_standing_start(l),
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

create or replace function rpc_standing_order_created(p_link uuid, p_ok boolean, p_customer_id bigint, p_recurring_id bigint, p_error text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; s students%rowtype; v_id uuid; v_start date;
begin
  select * into l from payment_links where id = p_link;
  select * into s from students where id = l.student_id;
  v_start := f_link_standing_start(l);
  insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, status, next_billing, charged_count, consent_text, consented_at, last_error, billing_day)
  values (s.id, l.branch_id, l.id, p_customer_id, p_recurring_id, (s.payment_track ->> 'installment_amount')::numeric,
          (s.payment_track ->> 'installments')::int - 1, (s.payment_track ->> 'installments')::int,
          v_start, case when p_ok then 'active' else 'setup_failed' end,
          case when p_ok then v_start end, 0,
          l.standing_consent_text, l.standing_consented_at, p_error,
          coalesce(case when s.payment_track ->> 'billing_day' ~ '^[0-9]{1,2}$' then (s.payment_track ->> 'billing_day')::int end,
                   extract(day from v_start)::int))
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

-- ─────────── ההרשמה: יום החיוב שההורה בחרה ───────────
CREATE OR REPLACE FUNCTION public.rpc_enroll(p jsonb, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_first text := left(trim(p ->> 'first_name'), 60);
  v_last  text := left(trim(p ->> 'last_name'), 60);
  v_grade text := left(trim(p ->> 'grade'), 20);
  v_school text := left(trim(p ->> 'school'), 80);
  v_phone text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_email text := lower(left(trim(p ->> 'email'), 120));
  v_consent boolean := (p ->> 'mailing_consent')::boolean;
  v_terms boolean := (p ->> 'terms_accepted')::boolean;
  v_wa boolean; v_photo boolean; v_track jsonb; v_tracks jsonb; v_opts jsonb;
  v_branch uuid; b branches%rowtype; v_state jsonb;
  v_plan jsonb; v_season uuid; v_student uuid; v_base text; v_token text; v_url text; v_amount numeric;
  v_n_phone int; v_n_ip int; v_program text; v_group text; v_day text;
begin
  if v_phone ~ '^0\d{9}$' then v_phone := '972' || substr(v_phone, 2); end if;
  select count(*) into v_n_phone from enrollment_requests where phone = v_phone and created_at > now() - interval '1 hour';
  select count(*) into v_n_ip from enrollment_requests where p_ip is not null and ip = p_ip and created_at > now() - interval '1 hour';
  if (select count(*) from enrollment_requests where created_at > now() - interval '1 hour') >= 40 then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'rate_limit_global');
    return jsonb_build_object('ok', false, 'error', 'ההרשמה עמוסה כרגע. נסי שוב בעוד שעה.');
  end if;
  if v_n_phone >= 3 or (p_ip is not null and p_ip <> '' and v_n_ip >= 10) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'rate_limit');
    if v_n_ip = 10 or v_n_phone = 3 then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('enrollment_flood', 'warning', 'הצפת הרשמות מדף ההרשמה', format('%s ניסיונות בשעה מאותו מקור (%s). ייתכן ניסיון אוטומטי.', greatest(v_n_phone, v_n_ip), coalesce(p_ip, v_phone)), jsonb_build_object('ip', p_ip, 'phone', v_phone));
    end if;
    return jsonb_build_object('ok', false, 'error', 'יותר מדי ניסיונות. נסי שוב בעוד שעה.');
  end if;

  if v_first is null or v_first = '' or v_last is null or v_last = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא שם פרטי ושם משפחה'); end if;
  if v_first !~ '^[֐-׿A-Za-z''"\-\s]+$' or v_last !~ '^[֐-׿A-Za-z''"\-\s]+$' then return jsonb_build_object('ok', false, 'error', 'השם יכול להכיל אותיות בלבד'); end if;
  if v_grade is null or v_grade = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא כיתה'); end if;
  if v_school is null or v_school = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא בית ספר'); end if;
  if v_phone !~ '^9725\d{8}$' then return jsonb_build_object('ok', false, 'error', 'מספר הטלפון אינו נייד ישראלי תקין'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'כתובת המייל אינה תקינה'); end if;
  if v_terms is distinct from true then return jsonb_build_object('ok', false, 'error', 'יש לאשר את התקנון'); end if;

  v_branch := f_enroll_branch(p ->> 'enroll_token');
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'הקישור להרשמה אינו תקין'); end if;
  select * into b from branches where id = v_branch for update;
  v_opts := '{"ask_whatsapp": true, "ask_photo": true, "ask_track": true}'::jsonb || coalesce(b.form_options, '{}');

  -- ★ השאלות: חובה כשמוצגות. תשובה שלא נשאלה — לא נלקחת מהבקשה.
  if (v_opts ->> 'ask_whatsapp')::boolean then
    if p ->> 'whatsapp' not in ('yes', 'no') or p ->> 'whatsapp' is null then return jsonb_build_object('ok', false, 'error', 'יש לענות אם אתם מקבלים הודעות וואטסאפ'); end if;
    v_wa := (p ->> 'whatsapp') = 'yes';
  end if;
  if (v_opts ->> 'ask_photo')::boolean then
    if p ->> 'photo' not in ('yes', 'no') or p ->> 'photo' is null then return jsonb_build_object('ok', false, 'error', 'יש לענות על אישור הצילום'); end if;
    v_photo := (p ->> 'photo') = 'yes';
  end if;
  v_program := nullif(trim(coalesce(b.program_name, '')), '');
  v_tracks := case when b.collect_payments then f_visible_tracks(b.plan) else '[]'::jsonb end;
  if not b.collect_payments then
    v_track := null;   -- ★ תשלום חיצוני (מתנ"ס וכד'): אין מסלול, אין סכום, אין קישור
  elsif (v_opts ->> 'ask_track')::boolean then
    select t into v_track from jsonb_array_elements(v_tracks) t where t ->> 'key' = p ->> 'track';
    if v_track is null then return jsonb_build_object('ok', false, 'error', 'יש לבחור אופן תשלום'); end if;
  else
    -- לא נשאלה: המסלול הראשון שמוצג (בלי הוראות קבע לפני סבב 3).
    v_track := v_tracks -> 0;
    if v_track is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;
  end if;
  -- ★ יום החיוב בהוראת קבע (0041): ההורה בוחרת 1–28. נשמר במסלול של התלמידה, ומשם לנוסח האישור
  --   ולתאריכים בפועל. בלי בחירה (טופס ישן / מסלול שלא נשאל) — כמו קודם: אותו יום בחודש כמו התשלום.
  v_day := nullif(btrim(coalesce(p ->> 'billing_day', '')), '');
  if v_day is not null and v_track ->> 'method' = 'standing_order' and (v_track ->> 'installments')::int >= 2 then
    if v_day !~ '^[0-9]{1,2}$' or v_day::int not between 1 and 28 then
      return jsonb_build_object('ok', false, 'error', 'יום החיוב בהוראת הקבע: בין 1 ל-28 בחודש');
    end if;
    v_track := v_track || jsonb_build_object('billing_day', v_day::int);
  end if;

  v_state := f_branch_enrollment_state(v_branch);
  if not (v_state ->> 'open')::boolean then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'branch_' || coalesce(v_state ->> 'reason', 'closed'));
    return jsonb_build_object('ok', false, 'error', case v_state ->> 'reason'
      when 'full' then format('ההרשמה ל%s מלאה. אפשר לפנות אלינו לרשימת המתנה.', b.name)
      else format('ההרשמה ל%s סגורה כרגע.', b.name) end);
  end if;

  v_plan := case when b.collect_payments then f_plan_check(b.plan) end;
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;

  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(trim(v_first || ' ' || v_last))) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'duplicate');
    return jsonb_build_object('ok', false, 'error', format('%s %s כבר רשומה ב%s. לפרטים אפשר לפנות אלינו.', v_first, v_last, b.name));
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_accepted_at, terms_text, plan_snapshot, payment_track, whatsapp_opt_in,
                        photo_consent, photo_consent_text, mailing_consent, trial_started_on, enrolled_at, joined_on, external_payment)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last, v_grade, v_school, v_phone, v_email,
          case when b.collect_payments then 'pending' else 'active' end::student_status, 'enrollment',
          coalesce((v_plan ->> 'tuition')::numeric, 0), coalesce((v_plan ->> 'registration_fee')::numeric, 0),
          (v_track ->> 'installments')::int, (v_track ->> 'installments')::int,
          now(), f_render_program(b.terms, b.program_name), v_plan, v_track, v_wa,
          coalesce(v_photo, false), case when v_photo is not null then b.photo_consent_text end,
          coalesce(v_consent, false), current_date, now(), current_date, not b.collect_payments)
  returning id into v_student;

  v_amount := (v_track ->> 'first_charge')::numeric;
  v_group := case when b.whatsapp_group_url is not null then E'\nקבוצת הוואטסאפ של ' || b.name || ': ' || b.whatsapp_group_url else '' end;
  if b.collect_payments and v_track ->> 'method' <> 'cash' then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
    values (v_token, 'tl-' || gen_random_uuid(), v_student, v_branch, v_amount, 'enrollment');
    select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
    v_url := coalesce(v_base, '') || '/pay/' || v_token;
    -- ההודעה נכנסת לתור בכל מקרה; מי שענתה "לא" לוואטסאפ — הטריגר על reminders מבטל ומסמן.
    insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
    values ('payment_link', v_student, v_branch, v_phone, v_first || ' ' || v_last,
            format(E'תודה שנרשמת%s! כדי להשלים את ההרשמה של %s (%s) — קישור לתשלום, %s ₪: %s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏%s',
                   coalesce(' ל' || v_program, ''), v_first, b.name, to_char(v_amount, 'FM999,999,990'), v_url, v_group),
            now(), 'payment_link:enroll:' || v_student);
  else
    -- בלי קישור תשלום (מזומן / תשלום חיצוני): הודעת ברוכה הבאה, עם קישור הקבוצה אם יש.
    insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
    values ('general', v_student, v_branch, v_phone, v_first || ' ' || v_last,
            format(E'תודה שנרשמת%s! %s רשומה ל%s.%s',
                   coalesce(' ל' || v_program, ''), v_first, b.name,
                   case when v_track ->> 'method' = 'cash' then E'\nהתשלום במזומן מתקבל בסניף.' else '' end || v_group),
            now(), 'welcome:enroll:' || v_student);
  end if;

  insert into enrollment_requests (phone, ip, ok) values (v_phone, p_ip, true);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('enrollment', 'insert', 'students', v_student, jsonb_build_object('branch', b.name, 'terms_accepted_at', now(), 'track', v_track ->> 'key', 'billing_day', v_track -> 'billing_day'), 'enrollment');
  return jsonb_build_object('ok', true, 'pay_url', v_url,
                            'amount', case when not b.collect_payments then null when v_track ->> 'method' = 'cash' then (v_plan ->> 'annual_total')::numeric else v_amount end,
                            'method', case when b.collect_payments then v_track ->> 'method' else 'external' end, 'track', v_track ->> 'label',
                            'student', v_first, 'branch', b.name, 'program_name', v_program, 'whatsapp_group_url', b.whatsapp_group_url);
end $function$;

revoke all on function rpc_enroll(jsonb, text) from public, anon, authenticated;
grant execute on function rpc_enroll(jsonb, text) to service_role;

-- ─────────── שינוי יום חיוב (הבעלים) ───────────
/**
 * התוכנית: התאריך הבא, האחרון, וכמה נותרו — ומשפט ברור לבעלים לפני השמירה.
 * "חויבה החודש" = החיוב האחרון מכל מקור (התשלום הראשון בקישור, חיוב שנקלט, Date_PreviousBilling)
 * נופל בחודש של היום (שעון ישראל). אין כאן שום כתיבה.
 */
create or replace function f_standing_reschedule_plan(p_id uuid, p_day int, p_today date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_paid date; v_charged date; v_last date; v_next date; v_final date;
        v_remaining int; v_cur_day int; v_kind text; v_reason text; v_sentence text;
begin
  select * into o from standing_orders where id = p_id;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'הוראת הקבע לא נמצאה'); end if;
  if o.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', case o.status
      when 'retrying' then 'יש חיוב שנדחה ו-SUMIT מנסה לחייב שוב — אי אפשר לשנות את יום החיוב עד שהחיוב יעבור'
      when 'failed' then 'הוראת הקבע הושבתה אחרי חיוב שנכשל — אין מה לשנות'
      when 'setup_failed' then 'הוראת הקבע לא נוצרה ב-SUMIT — אין מה לשנות'
      else 'הוראת הקבע אינה פעילה' end);
  end if;
  if o.sumit_recurring_id is null then return jsonb_build_object('ok', false, 'error', 'להוראה הזו אין מזהה ב-SUMIT'); end if;
  if p_day is null or p_day < 1 or p_day > 28 then return jsonb_build_object('ok', false, 'error', 'יום החיוב: בין 1 ל-28 בחודש'); end if;
  v_remaining := o.installments - o.charged_count;
  if v_remaining <= 0 then return jsonb_build_object('ok', false, 'error', 'כל החיובים בהוראה כבר בוצעו — אין מה לשנות'); end if;
  if o.next_billing is null then return jsonb_build_object('ok', false, 'error', 'אין להוראה חיוב מתוכנן — אין מה לשנות'); end if;
  -- ★ חיוב שמועדו היום (או עבר ועוד לא נקלט): SUMIT אולי מחייבת ממש עכשיו. לא נוגעים עד שנקלט.
  if o.next_billing <= p_today then
    return jsonb_build_object('ok', false, 'error',
      format('החיוב שתוכנן ל-%s עוד לא נקלט מ-SUMIT. אפשר לשנות את יום החיוב אחרי שייקלט (בדרך כלל למחרת).', to_char(o.next_billing, 'DD/MM')));
  end if;

  select (l.paid_at at time zone 'Asia/Jerusalem')::date into v_paid from payment_links l where l.id = o.payment_link_id;
  select max((c.charged_at at time zone 'Asia/Jerusalem')::date) into v_charged
    from standing_order_charges c where c.standing_order_id = o.id and c.valid;
  v_last := greatest(o.last_billing, v_paid, v_charged);
  v_kind := case when v_last >= date_trunc('month', p_today::timestamp)::date then 'charged_this_month'
                 when p_day > extract(day from p_today) then 'day_ahead'
                 else 'day_passed' end;
  v_next := f_standing_next_on_day(p_day, p_today, v_last);
  if v_next = o.next_billing then
    return jsonb_build_object('ok', false, 'error', format('החיוב הבא כבר ב-%s — אין מה לשנות', to_char(o.next_billing, 'DD/MM/YYYY')));
  end if;
  v_final := (v_next + make_interval(months => v_remaining - 1))::date;
  v_cur_day := coalesce(o.billing_day, extract(day from o.next_billing)::int);

  v_reason := case v_kind
    when 'charged_this_month' then format('כבר חויבה החודש (%s), ולכן החיוב הבא בחודש הבא.', to_char(v_last, 'DD/MM'))
    when 'day_ahead' then format('עוד לא חויבה החודש, וה-%s לחודש עוד לפנינו — החיוב הבא עוד החודש.', p_day)
    else case when p_day = extract(day from p_today) then format('ה-%s לחודש הוא היום — מוקדם מדי לחייב, ולכן החיוב הבא בחודש הבא.', p_day)
              else format('ה-%s לחודש כבר עבר החודש, ולכן החיוב הבא בחודש הבא.', p_day) end end;
  v_sentence := case when v_remaining = 1
    then format('החיוב הבא והאחרון יהיה ב-%s.', to_char(v_next, 'DD/MM'))
    else format('החיוב הבא יהיה ב-%s, ואחריו כל %s לחודש. נשארו %s חיובים, האחרון ב-%s.',
                to_char(v_next, 'DD/MM'), p_day, v_remaining, to_char(v_final, 'DD/MM/YYYY')) end;
  return jsonb_build_object('ok', true, 'next', v_next, 'final', v_final, 'remaining', v_remaining, 'day', p_day,
    'from', o.next_billing, 'from_day', v_cur_day, 'last_charge', v_last, 'kind', v_kind,
    'current', format('עכשיו: החיוב הבא ב-%s, כל %s לחודש.', to_char(o.next_billing, 'DD/MM'), v_cur_day),
    'reason', v_reason, 'sentence', v_sentence);
end $$;
revoke all on function f_standing_reschedule_plan(uuid, int, date) from public, anon, authenticated;

-- הבעלים: התוכנית לפני השמירה (בלי שום שינוי). הפונקציה standing-order-reschedule שואלת את אותה תוכנית.
create or replace function rpc_standing_reschedule_preview(p_id uuid, p_day int) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לשנות את יום החיוב' using errcode = '42501'; end if;
  return f_standing_reschedule_plan(p_id, p_day, f_today_il());
end $$;
revoke all on function rpc_standing_reschedule_preview(uuid, int) from public, anon;
grant execute on function rpc_standing_reschedule_preview(uuid, int) to authenticated;

-- (service_role) רק אחרי ש-SUMIT אישרה את העדכון: התאריך אצלנו + יומן.
create or replace function rpc_standing_order_rescheduled(p_id uuid, p_by uuid, p_from date, p_to date, p_day int, p_remaining int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from_day int;
begin
  select coalesce(billing_day, extract(day from p_from)::int) into v_from_day from standing_orders where id = p_id for update;
  update standing_orders set next_billing = p_to, billing_day = p_day where id = p_id;
  insert into standing_order_events (standing_order_id, kind, from_date, to_date, from_day, to_day, remaining, actor, actor_label)
  values (p_id, 'reschedule', p_from, p_to, v_from_day, p_day, p_remaining, p_by,
          coalesce((select full_name from profiles where id = p_by), 'משתמשת לא מזוהה'));
  insert into audit_log (actor, action, table_name, row_id, before, after)
  values ('user:' || coalesce(p_by::text, '?'), 'reschedule_standing_order', 'standing_orders', p_id,
          jsonb_build_object('next_billing', p_from, 'billing_day', v_from_day),
          jsonb_build_object('next_billing', p_to, 'billing_day', p_day, 'remaining', p_remaining, 'updated_in_sumit', true));
end $$;
revoke all on function rpc_standing_order_rescheduled(uuid, uuid, date, date, int, int) from public, anon, authenticated;
grant execute on function rpc_standing_order_rescheduled(uuid, uuid, date, date, int, int) to service_role;

-- ─────────── הסנכרון: שינוי ידני ב-SUMIT ───────────
/**
 * כמו 0029, ועוד: ★ התאריך הבא ב-SUMIT זז שלא בגלל חיוב — מישהי שינתה אותו ב-SUMIT.
 * חיוב רגיל מזיז את התאריך הבא לחודש הבא, ביום החיוב. כל תזוזה אחרת = שינוי:
 * נקלט (התאריך ויום החיוב), נרשם ביומן, הבעלים מקבלת הודעה. לא נרשם חיוב.
 */
create or replace function rpc_standing_order_status(p_id uuid, p_sumit_status int, p_next date, p_last date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_new text; v_name text; v_day int; v_new_charge boolean; v_from date; v_to_day int;
begin
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  v_new := coalesce(f_standing_status(p_sumit_status), o.status);
  select full_name into v_name from students where id = o.student_id;

  -- ★ נעצרה אצלנו — אבל SUMIT עדיין מחייבת. לא "מחזירים" אותה לפעילה; מתריעים.
  if o.status = 'cancelled' then
    update standing_orders set sumit_status = p_sumit_status, next_billing = case when v_new = 'cancelled' then null else p_next end,
           last_checked_at = now() where id = o.id;
    if v_new in ('active', 'retrying', 'failed')
       and not exists (select 1 from system_alerts where kind = 'standing_order_cancel_mismatch'
                        and meta ->> 'standing_order_id' = o.id::text and created_at > now() - interval '1 day') then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_cancel_mismatch', 'critical', 'הוראת קבע נעצרה אצלנו אבל עדיין פעילה ב-SUMIT',
              format('%s: SUMIT מדווחת על ההוראה כפעילה (קוד %s, חיוב הבא %s). יש לבטל ידנית ב-SUMIT.', v_name, p_sumit_status,
                     coalesce(to_char(p_next, 'DD/MM/YYYY'), '—')),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_status', p_sumit_status));
    end if;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'confirmed_in_sumit', v_new = 'cancelled');
  end if;

  -- ★ שינוי תאריך שלא דרך המערכת. רק כשההוראה פעילה כאן וגם שם (הסתיימה / ניסיון חוזר — התאריך שם לא אומר כלום).
  v_day := coalesce(o.billing_day, extract(day from o.date_start)::int);
  v_new_charge := p_last is not null and (o.last_billing is null or p_last > o.last_billing);
  if o.status = 'active' and v_new = 'active' and o.next_billing is not null and p_next is not null and p_next <> o.next_billing
     and not (v_new_charge and f_months_between(o.next_billing, p_next) = 1 and f_on_billing_day(p_next, v_day)) then
    v_from := case when v_new_charge then f_month_day((o.next_billing + interval '1 month')::date, v_day) else o.next_billing end;
    v_to_day := extract(day from p_next)::int;
    insert into standing_order_events (standing_order_id, kind, from_date, to_date, from_day, to_day, remaining, actor_label)
    values (o.id, 'sumit_change', v_from, p_next, v_day, v_to_day, o.installments - o.charged_count, 'שינוי ב-SUMIT (לא דרך המערכת)');
    update standing_orders set billing_day = v_to_day where id = o.id;
    insert into system_alerts (kind, severity, title, body, meta)
    values ('standing_order_date_changed', 'info', 'תאריך החיוב בהוראת קבע שונה ב-SUMIT',
            format('%s: החיוב הבא היה ב-%s, ועכשיו ב-%s (כל %s לחודש). השינוי לא נעשה דרך המערכת — הוא נקלט ונרשם ביומן הוראות הקבע. החיובים ימשיכו להיקלט כרגיל.',
                   v_name, to_char(v_from, 'DD/MM/YYYY'), to_char(p_next, 'DD/MM/YYYY'), v_to_day),
            jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'from', v_from, 'to', p_next));
  end if;

  update standing_orders set sumit_status = p_sumit_status, status = v_new, next_billing = p_next,
         last_billing = coalesce(p_last, last_billing), last_checked_at = now(),
         cancelled_at = case when v_new = 'cancelled' and cancelled_at is null then now() else cancelled_at end
   where id = o.id;
  if v_new <> o.status then
    if v_new in ('failed', 'retrying') then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_failed', case when v_new = 'failed' then 'critical' else 'warning' end,
              case when v_new = 'failed' then 'הוראת קבע הושבתה אחרי חיוב שנכשל' else 'חיוב בהוראת קבע נדחה — SUMIT תנסה שוב' end,
              format('%s: %s. התלמידה נשארת פעילה. כדאי ליצור קשר עם ההורה (ייתכן כרטיס שפג תוקפו).', v_name,
                     case when v_new = 'failed' then 'SUMIT הפסיקה לחייב' else 'החיוב לא עבר' end),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_status', p_sumit_status));
    elsif v_new = 'cancelled' then
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

/**
 * כמו 0037, ועוד p_final (Date_Last ב-SUMIT — מועד החיוב האחרון): ★ כמה חיובים נותרו לפי SUMIT
 * מול כמה נותרו לפי התוכנית. שונה (למשל אחרי שינוי ידני ב-SUMIT ששמר את התאריך האחרון) —
 * התראה, פעם ביום. שינוי יום חיוב דרך המערכת לא מתבצע כשיש אי-התאמה (remaining_ok).
 */
drop function if exists rpc_standing_billing_observed(uuid, int, date, date);
create or replace function rpc_standing_billing_observed(p_id uuid, p_sumit_status int, p_next date, p_prev date, p_final date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_charge jsonb := null; v_status text; v_res jsonb; v_ours int; v_sumit int; v_ok boolean; v_name text;
begin
  select * into o from standing_orders where id = p_id;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  update standing_orders set check_failures = 0 where id = o.id and check_failures <> 0;
  v_status := coalesce(f_standing_status(p_sumit_status), o.status);
  if p_prev is not null and (o.last_billing is null or p_prev > o.last_billing)
     and v_status in ('active', 'completed')
     and not exists (select 1 from standing_order_charges c where c.standing_order_id = o.id and c.charged_at::date = p_prev) then
    v_charge := rpc_record_standing_charge(o.id, -(o.sumit_recurring_id::bigint * 100000000 + to_char(p_prev, 'YYYYMMDD')::bigint),
                                           o.amount, p_prev::timestamptz, true, null);
  end if;
  v_res := rpc_standing_order_status(p_id, p_sumit_status, p_next, p_prev);

  select * into o from standing_orders where id = p_id;
  v_ours := o.installments - o.charged_count;
  if o.status = 'active' and p_next is not null and p_final is not null then
    v_sumit := greatest(f_months_between(p_next, p_final) + 1, 0);
    v_ok := v_sumit = v_ours;
    if not v_ok and not exists (select 1 from system_alerts where kind = 'standing_order_remaining_mismatch'
                                 and meta ->> 'standing_order_id' = o.id::text and created_at > now() - interval '1 day') then
      select full_name into v_name from students where id = o.student_id;
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_remaining_mismatch', 'warning', 'מספר החיובים שנותרו ב-SUMIT שונה מהתוכנית',
              format('%s: לפי SUMIT נותרו %s חיובים (האחרון ב-%s), ולפי התוכנית %s. ייתכן שינוי ידני ב-SUMIT. לבדוק שם לפני שמשנים משהו.',
                     v_name, v_sumit, to_char(p_final, 'DD/MM/YYYY'), v_ours),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_remaining', v_sumit, 'remaining', v_ours));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'charge', v_charge, 'status', v_res, 'remaining', v_ours, 'sumit_remaining', v_sumit, 'remaining_ok', v_ok);
end $$;
revoke all on function rpc_standing_billing_observed(uuid, int, date, date, date) from public, anon, authenticated;
grant execute on function rpc_standing_billing_observed(uuid, int, date, date, date) to service_role;

-- ─────────── המסכים ───────────
create or replace view v_standing_orders as
select o.id, o.student_id, s.full_name, o.branch_id, b.name as branch_name, o.status, o.sumit_status,
       o.amount, o.installments_total, o.charged_count + 1 as charged_total,   -- כולל החיוב הראשון
       o.failed_count, o.date_start, o.next_billing, o.last_billing, o.last_error, o.last_checked_at,
       o.cancelled_at, o.created_at,
       (o.status in ('failed', 'retrying', 'setup_failed')) as needs_attention,
       o.billing_day, o.installments - o.charged_count as remaining
from standing_orders o join students s on s.id = o.student_id join branches b on b.id = o.branch_id
where auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches()));
alter view v_standing_orders set (security_invoker = false);
revoke all on v_standing_orders from anon, public;
grant select on v_standing_orders to authenticated;

-- יומן הוראות הקבע: מי שינה, מתי, מאיזה תאריך לאיזה. אותה הרשאה כמו ההוראות עצמן.
create or replace view v_standing_order_events as
select e.id, e.standing_order_id, o.student_id, s.full_name, o.branch_id, b.name as branch_name, e.kind,
       e.from_date, e.to_date, e.from_day, e.to_day, e.remaining, e.actor_label, e.created_at
from standing_order_events e
join standing_orders o on o.id = e.standing_order_id
join students s on s.id = o.student_id
join branches b on b.id = o.branch_id
where auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches()));
alter view v_standing_order_events set (security_invoker = false);
revoke all on v_standing_order_events from anon, public;
grant select on v_standing_order_events to authenticated;
