-- 0062 — "קישור להחלפת כרטיס" להוראת קבע שהושבתה אחרי חיוב שנכשל.
--
-- המקרה (22/11): "ניסיון חיוב חוזר" על הכרטיס השמור נדחה (004 — לא אושר; 002 — כרטיס מדווח כגנוב).
-- הכרטיס השמור לא יעבור; צריך כרטיס אחר מההורה, ולא הייתה במערכת דרך לקבל אותו.
--
-- הזרימה:
--   1. הבעלים: rpc_standing_card_link — קישור תשלום (purpose 'card_replace') על החיוב שנכשל (הסכום החודשי),
--      עם החיובים שנותרו ויום החיוב. הודעה להורה בתור; ביומן ההוראה "נשלח קישור להחלפת כרטיס".
--   2. ההורה: הדף הרגיל (/pay) — נוסח האישור של הוראת הקבע עם החיובים שנותרו (f_standing_consent),
--      בחירת יום, ותשלום בכרטיס החדש ב-SUMIT (שם הכרטיס נשמר).
--   3. הסנכרון: הוראה חדשה ב-SUMIT על הכרטיס החדש — לחיובים שנותרו, מהחודש הבא — ואז ההוראה הישנה
--      (המושבתת) מבוטלת ב-SUMIT ואצלנו "בוטלה — הוחלפה בכרטיס חדש". "חיוב X מתוך N" ממשיך מאותו מקום.

-- ─── הקישור ───
alter table payment_links drop constraint if exists payment_links_purpose_check;
alter table payment_links add constraint payment_links_purpose_check check (purpose in ('debt', 'enrollment', 'card_replace'));
alter table payment_links add column if not exists replaces_standing_order_id uuid references standing_orders(id);
alter table payment_links add column if not exists standing_installments int;   -- החיובים החודשיים שאחרי התשלום בקישור
alter table payment_links add column if not exists standing_amount numeric(10,2);
alter table payment_links drop constraint if exists payment_links_card_replace_check;
alter table payment_links add constraint payment_links_card_replace_check check (
  purpose <> 'card_replace' or (replaces_standing_order_id is not null and standing_installments >= 0 and standing_amount > 0));

alter table standing_order_events drop constraint if exists standing_order_events_kind_check;
alter table standing_order_events add constraint standing_order_events_kind_check
  check (kind in ('reschedule', 'sumit_change', 'amount_change', 'retry_charge', 'retry_declined', 'renewed', 'retry_refused',
                  'paid_elsewhere', 'card_link', 'card_replaced'));

create or replace function rpc_standing_card_link(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; s students%rowtype; v_after int; v_id uuid := gen_random_uuid(); v_token text; v_base text; v_url text;
        v_branch text; v_program text; v_reminder uuid; v_cancelled int; v_first text;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לשלוח קישור להחלפת כרטיס' using errcode = '42501'; end if;
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then raise exception 'הוראת הקבע לא נמצאה'; end if;
  if o.status <> 'failed' or o.needs_renewal then
    raise exception 'קישור להחלפת כרטיס — רק בהוראה שהושבתה אחרי חיוב שנכשל (ושעוד לא שולם עליה חיוב חוזר)';
  end if;
  if o.retry_uncertain_at > now() - interval '24 hours' then
    raise exception 'בניסיון החיוב החוזר האחרון לא ברור אם חויב — לבדוק ב-SUMIT קודם';
  end if;
  select * into s from students where id = o.student_id;
  if s.parent_phone is null then raise exception 'לתלמידה אין טלפון של הורה — אין למי לשלוח את הקישור'; end if;
  v_after := o.installments - o.charged_count - 1;   -- אחרי התשלום בקישור
  if v_after < 0 then raise exception 'כל החיובים בהוראה כבר בוצעו'; end if;

  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  get diagnostics v_cancelled = row_count;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, created_by,
                             replaces_standing_order_id, standing_installments, standing_amount)
  values (v_id, v_token, 'tl-' || v_id, s.id, s.branch_id, o.amount, 'card_replace', auth.uid(), o.id, v_after, o.amount);

  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  select name, nullif(trim(coalesce(program_name, '')), '') into v_branch, v_program from branches where id = s.branch_id;
  v_first := split_part(s.full_name, ' ', 1);
  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, created_by, dedupe_key)
  values ('payment_link', s.id, s.branch_id, s.parent_phone, coalesce(s.parent_name, '') || ' · ' || s.full_name,
          format(E'שלום %s, החיוב החודשי של %s%s (%s) לא עבר בכרטיס השמור. זה קישור לעדכון הכרטיס: %s\nמשלמים עכשיו את החיוב של החודש, %s ₪, בכרטיס החדש%s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 coalesce(s.parent_name, ''), v_first, coalesce(' — ' || v_program, ''), v_branch, v_url, to_char(o.amount, 'FM999,990'),
                 case when v_after > 0 then format(', והוראת הקבע ממשיכה עליו: עוד %s תשלומים, מהחודש הבא (בדף בוחרים את יום החיוב בחודש).', v_after) else '.' end),
          now(), auth.uid(), 'payment_link:' || v_id)
  returning id into v_reminder;
  update payment_links set reminder_id = v_reminder where id = v_id;

  insert into standing_order_events (standing_order_id, kind, from_date, to_amount, remaining, actor, note)
  values (o.id, 'card_link', o.next_billing, o.amount, v_after, auth.uid(), 'נשלח להורה קישור להחלפת כרטיס');
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('user:' || auth.uid()::text, 'standing_card_link', 'standing_orders', o.id,
          jsonb_build_object('link', v_id, 'amount', o.amount, 'remaining_after', v_after, 'cancelled_links', v_cancelled), 'ui');
  return jsonb_build_object('id', v_id, 'token', v_token, 'url', v_url, 'amount', o.amount, 'remaining_after', v_after,
                            'expires_at', now() + interval '7 days', 'whatsapp', f_link_whatsapp_state(v_reminder));
end $$;
revoke all on function rpc_standing_card_link(uuid) from public, anon;
grant execute on function rpc_standing_card_link(uuid) to authenticated;

-- ─── נוסח האישור בדף ההורה: גם להחלפת כרטיס (החיובים שנותרו, מהקישור) ───
create or replace function f_standing_consent(p_link uuid, p_on date default null, p_day int default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; t jsonb; v_n int; v_each numeric; v_dates date[]; v_day int; v_text text; v_list text; v_old_day int;
begin
  select * into l from payment_links where id = p_link;
  if l.id is null or l.purpose not in ('enrollment', 'card_replace') then return null; end if;
  select payment_track into t from students where id = l.student_id;
  if l.purpose = 'card_replace' then
    v_n := l.standing_installments;
    v_each := l.standing_amount;
    if v_n is null or v_n < 1 then return null; end if;   -- החיוב האחרון: תשלום אחד, בלי הוראה
    select billing_day into v_old_day from standing_orders where id = l.replaces_standing_order_id;
  else
    if t is null or t ->> 'method' <> 'standing_order' or (t ->> 'installments')::int < 2 then return null; end if;
    v_n := (t ->> 'installments')::int - 1;
    v_each := (t ->> 'installment_amount')::numeric;
  end if;
  -- p_day: מה שההורה בוחרת עכשיו בדף התשלום. בלעדיו — מה שבחרה בהרשמה (או היום של ההוראה שמוחלפת).
  v_day := case when p_day between 1 and 28 then p_day
                when v_old_day between 1 and 28 then v_old_day
                when t ->> 'billing_day' ~ '^[0-9]{1,2}$' and (t ->> 'billing_day')::int between 1 and 28 then (t ->> 'billing_day')::int end;
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
revoke all on function f_standing_consent(uuid, date, int) from public, anon, authenticated;

-- ─── הסנכרון: הוראה חדשה — בהחלפת כרטיס, החיובים שנותרו מהקישור; והישנה לביטול ב-SUMIT ───
create or replace function rpc_standing_orders_to_setup() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'link_id', l.id, 'student_id', s.id, 'student_name', s.full_name, 'branch', b.name,
    'customer_id', l.sumit_customer_id, 'external_identifier', l.external_identifier,
    'amount', case when l.purpose = 'card_replace' then l.standing_amount else (s.payment_track ->> 'installment_amount')::numeric end,
    'installments', case when l.purpose = 'card_replace' then l.standing_installments else (s.payment_track ->> 'installments')::int - 1 end,
    'installments_total', case when l.purpose = 'card_replace' then old.installments_total else (s.payment_track ->> 'installments')::int end,
    'date_start', f_link_standing_start(l),
    'consent_text', l.standing_consent_text, 'consented_at', l.standing_consented_at,
    'replaces_customer_id', old.sumit_customer_id, 'replaces_recurring_id', old.sumit_recurring_id)), '[]'::jsonb)
  from payment_links l
  join students s on s.id = l.student_id
  join branches b on b.id = l.branch_id
  left join standing_orders old on old.id = l.replaces_standing_order_id
  where l.status in ('paid', 'mismatch') and l.standing_consented_at is not null
    and (s.payment_track ->> 'method' = 'standing_order' or l.purpose = 'card_replace') and s.cancelled_at is null
    -- ★ החלפת כרטיס: רק אם ההוראה הישנה באמת נסגרה בתשלום (f_card_replace_paid). אחרת — התראה, לא הוראה שנייה.
    and (l.purpose <> 'card_replace' or (l.standing_installments > 0 and old.status = 'cancelled'))
    and not exists (select 1 from standing_orders o where o.payment_link_id = l.id)
$$;
revoke all on function rpc_standing_orders_to_setup() from public, anon, authenticated;
grant execute on function rpc_standing_orders_to_setup() to service_role;

create or replace function rpc_standing_order_created(p_link uuid, p_ok boolean, p_customer_id bigint, p_recurring_id bigint, p_error text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; s students%rowtype; old standing_orders%rowtype; v_id uuid; v_start date;
begin
  select * into l from payment_links where id = p_link;
  select * into s from students where id = l.student_id;
  v_start := f_link_standing_start(l);
  if l.purpose = 'card_replace' then
    select * into old from standing_orders where id = l.replaces_standing_order_id for update;
    -- ★ "חיוב X מתוך N" ממשיך: אותו מספר חיובים בהוראה, והתשלום בקישור נספר כחיוב שבוצע.
    insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                                 installments_total, date_start, status, next_billing, charged_count, consent_text, consented_at, last_error,
                                 billing_day, last_checked_at, last_billing)
    values (s.id, l.branch_id, l.id, p_customer_id, p_recurring_id, l.standing_amount, old.installments, old.installments_total,
            v_start, case when p_ok then 'active' else 'setup_failed' end, case when p_ok then v_start end, old.charged_count + 1,
            l.standing_consent_text, l.standing_consented_at, p_error, extract(day from v_start)::int,
            case when p_ok then now() end, (l.paid_at at time zone 'Asia/Jerusalem')::date)
    on conflict (payment_link_id) do nothing
    returning id into v_id;
    -- ההוראה הישנה כבר נסגרה כשההורה שילמה (f_card_replace_paid). כאן — רק מה נוצר במקומה.
    if p_ok and v_id is not null then
      update standing_orders set last_error = 'הוחלפה בהוראה על כרטיס חדש' where id = old.id;
      insert into standing_order_events (standing_order_id, kind, to_date, to_day, to_amount, remaining, actor_label, note)
      values (old.id, 'card_replaced', v_start, extract(day from v_start)::int, l.standing_amount, l.standing_installments,
              'סנכרון SUMIT', format('הוראה חדשה ב-SUMIT על הכרטיס החדש: %s חיובים של %s ₪, מ-%s',
                                     l.standing_installments, trim_scale(l.standing_amount), to_char(v_start, 'DD/MM/YYYY')));
    end if;
  else
    insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                                 installments_total, date_start, status, next_billing, charged_count, consent_text, consented_at, last_error, billing_day,
                                 last_checked_at)
    values (s.id, l.branch_id, l.id, p_customer_id, p_recurring_id, (s.payment_track ->> 'installment_amount')::numeric,
            (s.payment_track ->> 'installments')::int - 1, (s.payment_track ->> 'installments')::int,
            v_start, case when p_ok then 'active' else 'setup_failed' end,
            case when p_ok then v_start end, 0,
            l.standing_consent_text, l.standing_consented_at, p_error,
            coalesce(case when s.payment_track ->> 'billing_day' ~ '^[0-9]{1,2}$' then (s.payment_track ->> 'billing_day')::int end,
                     extract(day from v_start)::int),
            -- ★ SUMIT בדיוק אישרה את היצירה: אין מה לבדוק עכשיו. הבדיקה הראשונה — סביב מועד החיוב.
            case when p_ok then now() end)
    on conflict (payment_link_id) do nothing
    returning id into v_id;
  end if;
  if not p_ok then
    insert into system_alerts (kind, severity, title, body, meta)
    values ('standing_order_setup_failed', 'critical', 'הוראת קבע לא נוצרה ב-SUMIT',
            format('%s שילמה %s, אבל יצירת הוראת הקבע נכשלה: %s. יש ליצור ידנית ב-SUMIT או לפנות להורה.', s.full_name,
                   case when l.purpose = 'card_replace' then 'בכרטיס החדש' else 'את החיוב הראשון' end, coalesce(p_error, 'לא ידוע')),
            jsonb_build_object('student_id', s.id, 'link_id', l.id));
  end if;
  return v_id;
end $$;
revoke all on function rpc_standing_order_created(uuid, boolean, bigint, bigint, text) from public, anon, authenticated;
grant execute on function rpc_standing_order_created(uuid, boolean, bigint, bigint, text) to service_role;

-- ─── ההורה שילמה בקישור: ההוראה הישנה נסגרת מיד ───
-- ★ כדי שאף אחד לא ינסה לחייב אותה שוב ("ניסיון חיוב חוזר" / "שולם בנפרד" — רק בהוראה שהושבתה).
--   נותרו חיובים: "נעצרה — הכרטיס הוחלף", וההוראה החדשה נוצרת בסנכרון הקרוב (ושם הישנה מבוטלת גם ב-SUMIT).
--   זה היה החיוב האחרון: ההוראה הסתיימה, בלי הוראה חדשה.
create or replace function f_card_replace_paid() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_done boolean := coalesce(new.standing_installments, 0) = 0; v_n int;
begin
  if new.purpose = 'card_replace' and new.status in ('paid', 'mismatch') and old.status not in ('paid', 'mismatch') then
    update standing_orders
       set status = case when v_done then 'completed' else 'cancelled' end,
           cancelled_at = case when v_done then cancelled_at else now() end,
           charged_count = charged_count + case when v_done then 1 else 0 end,
           needs_renewal = false, retry_uncertain_at = null,
           next_billing = case when v_done then null else next_billing end,
           last_billing = (coalesce(new.paid_at, now()) at time zone 'Asia/Jerusalem')::date,
           last_error = case when v_done then null else 'הכרטיס הוחלף — ההוראה החדשה על הכרטיס החדש נוצרת בסנכרון הקרוב' end
     where id = new.replaces_standing_order_id and status = 'failed' and not needs_renewal;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      insert into standing_order_events (standing_order_id, kind, from_date, to_amount, remaining, actor_label, note)
      select o.id, 'card_replaced', o.next_billing, new.amount, new.standing_installments, 'ההורה (קישור)',
             case when v_done then 'החיוב האחרון שולם בכרטיס חדש — ההוראה הסתיימה'
                  else format('החיוב שנכשל שולם בכרטיס חדש (%s ₪). נותרו %s חיובים — בהוראה חדשה על הכרטיס החדש', trim_scale(new.amount), new.standing_installments) end
        from standing_orders o where o.id = new.replaces_standing_order_id;
    else
      -- ההוראה כבר לא "הושבתה" (חיוב חוזר / שולם בנפרד בינתיים): ייתכן תשלום כפול.
      insert into system_alerts (kind, severity, title, body, meta)
      select 'card_replace_conflict', 'critical', 'שולם בקישור להחלפת כרטיס — אבל ההוראה כבר טופלה',
             format('%s: ההורה שילמה %s ₪ בקישור להחלפת כרטיס, אבל בינתיים ההוראה כבר לא במצב "הושבתה" (%s). ייתכן חיוב כפול — לבדוק ב-SUMIT ולהחזיר אם צריך.',
                    s.full_name, trim_scale(new.amount), coalesce(o.status, '—')),
             jsonb_build_object('link_id', new.id, 'standing_order_id', new.replaces_standing_order_id, 'student_id', new.student_id)
        from students s left join standing_orders o on o.id = new.replaces_standing_order_id where s.id = new.student_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function f_card_replace_paid() from public, anon, authenticated;
drop trigger if exists payment_links_card_replace_paid on payment_links;
create trigger payment_links_card_replace_paid after update of status on payment_links
  for each row execute function f_card_replace_paid();

-- ─── החיוב שנכשל טופל בדרך אחרת (חיוב חוזר עבר / שולם בנפרד / SUMIT הפעילה שוב): קישור פתוח מתבטל ───
create or replace function f_card_links_obsolete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'failed' and not old.needs_renewal and (new.status <> 'failed' or new.needs_renewal) then
    update payment_links set status = 'cancelled'
     where replaces_standing_order_id = new.id and purpose = 'card_replace' and status in ('pending', 'opened');
  end if;
  return new;
end $$;
revoke all on function f_card_links_obsolete() from public, anon, authenticated;
drop trigger if exists standing_orders_card_links_obsolete on standing_orders;
create trigger standing_orders_card_links_obsolete after update of status, needs_renewal on standing_orders
  for each row execute function f_card_links_obsolete();
