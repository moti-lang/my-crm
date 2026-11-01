-- 0044 — יום החיוב בדף התשלום (/pay), לפני דף האשראי של SUMIT.
--
-- ★ דף התשלום של SUMIT לא תומך בבחירת יום (ר' docs/sumit-contract.md): הוא גובה חיוב אחד ושומר
--   את הכרטיס, וההוראה נוצרת אצלנו ב-API עם כל תאריך התחלה. לכן ההורה בוחרת בדף /pay שלנו — שם
--   גם התיבה לאישור. הנוסח מתעדכן מיד עם היום והתאריכים בפועל, והיום נשמר יחד עם האישור.
--   בחרה כבר בהרשמה — היום הזה מוצג מראש, ואפשר לשנות.
-- ★ בלי פונקציה ציבורית חדשה: rpc_payment_link_public מקבלת יום אופציונלי, לתצוגה בלבד
--   (בלי שמירה). השמירה — רק ב-rpc_standing_consent, מתוך sumit-checkout, ברגע האישור.

drop function if exists f_standing_consent(uuid, date);
create function f_standing_consent(p_link uuid, p_on date default null, p_day int default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; t jsonb; v_n int; v_each numeric; v_dates date[]; v_day int; v_text text; v_list text;
begin
  select * into l from payment_links where id = p_link;
  if l.id is null or l.purpose <> 'enrollment' then return null; end if;
  select payment_track into t from students where id = l.student_id;
  if t is null or t ->> 'method' <> 'standing_order' or (t ->> 'installments')::int < 2 then return null; end if;
  v_n := (t ->> 'installments')::int - 1;
  v_each := (t ->> 'installment_amount')::numeric;
  -- p_day: מה שההורה בוחרת עכשיו בדף התשלום. בלעדיו — מה שבחרה בהרשמה.
  v_day := case when p_day between 1 and 28 then p_day
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

drop function if exists rpc_payment_link_public(text);
create function rpc_payment_link_public(p_token text, p_day int default null) returns jsonb
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
    return jsonb_build_object('ok', false, 'state', 'expired', 'error', 'הקישור פג תוקף או בוטל. אפשר לבקש קישור חדש.');
  end if;
  if l.status = 'pending' then update payment_links set status = 'opened', opened_at = now() where id = l.id; end if;
  return jsonb_build_object('ok', true, 'state', 'open', 'student', v_name, 'branch', v_branch, 'amount', l.amount,
                            'expires_at', l.expires_at, 'sumit_page_url', l.sumit_page_url,
                            -- הוראת קבע: הנוסח והתאריכים — ליום שההורה בוחרת בדף (p_day), או שבחרה בהרשמה.
                            -- אחרי שאושר — מה שאושר, בלי קשר ל-p_day.
                            'standing', case when l.standing_consented_at is not null
                                             then jsonb_build_object('text', l.standing_consent_text, 'consented', true)
                                             else f_standing_consent(l.id, null, p_day) end);
end $$;
revoke all on function rpc_payment_link_public(text, int) from public;
grant execute on function rpc_payment_link_public(text, int) to anon, authenticated;

-- האישור (sumit-checkout, ברגע הלחיצה): הנוסח המדויק עם היום שנבחר, התאריך הראשון, והיום במסלול.
drop function if exists rpc_standing_consent(text);
create function rpc_standing_consent(p_token text, p_day int default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; c jsonb;
begin
  select * into l from payment_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  if l.standing_consented_at is not null then return jsonb_build_object('ok', true, 'required', true, 'text', l.standing_consent_text); end if;
  if p_day is not null and (p_day < 1 or p_day > 28) then
    return jsonb_build_object('ok', false, 'error', 'יום החיוב: בין 1 ל-28 בחודש');
  end if;
  c := f_standing_consent(l.id, null, p_day);
  if c is null then return jsonb_build_object('ok', true, 'required', false); end if;
  -- ★ היום שההורה בחרה בדף נשמר במסלול שלה — ההוראה תיווצר בו (ושינוי יום חיוב יראה אותו).
  if p_day is not null then
    update students set payment_track = payment_track || jsonb_build_object('billing_day', p_day) where id = l.student_id;
  end if;
  update payment_links set standing_consent_text = c ->> 'text', standing_consented_at = now(),
         standing_date_start = (c -> 'dates' ->> 0)::date
   where id = l.id;
  return jsonb_build_object('ok', true, 'required', true, 'text', c ->> 'text');
end $$;
revoke all on function rpc_standing_consent(text, int) from public, anon, authenticated;
grant execute on function rpc_standing_consent(text, int) to service_role;
