-- 0065 — וואטסאפ על GOWA (go-whatsapp-web-multidevice v9) במקום השרת הקודם.
--
-- השרת הישן נמחק (25/11). מעכשיו: GOWA בקונטיינר נפרד, והחיבור אליו — רק דרך משתני סביבה של
-- ה-Edge Functions (WA_BASE_URL, WA_DEVICE_ID, WA_USER, WA_PASS, WA_WEBHOOK_SECRET, WA_TEST_PHONE).
--
--   1. נרמול טלפון אחד: f_normalize_phone — אותו כלל כמו _shared/phone.ts (המסך מייבא משם).
--      052… · ‎+972 52… · ‎972… · ‎00972… · ‎+972-052… · ‎52…  →  972XXXXXXXXX.
--      ההרשמה (rpc_enroll) עוברת לנרמול הזה — שאר הגוף זהה מילה במילה ל-0041.
--   2. הקמת השרת הישן — מוסרת: wa_config (עם הכתובת, המפתח והסוד של השרת שנמחק), טוקן ההקמה,
--      ודיווח ההקמה. (0034/0035/0057 נשארים כהיסטוריה — הם רצים בכל איפוס של סביבת הבדיקה.)
--   3. קצב שליחה: מרווח מינימלי ותקרה לדקה, מההגדרות (wa_pacing) — לא קשיח בקוד.
--      rpc_wa_reserve_send שומר "מקום" לשליחה אמיתית, באופן אטומי (גם כשכמה שליחות רצות במקביל).

-- ─── 1. נרמול טלפון ───
create or replace function f_normalize_phone(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when d like '972%' then d
              when d like '0%' then '972' || substr(d, 2)
              when d ~ '^5[0-9]{8}$' then '972' || d
              else d end
  from (select case when d1 like '9720%' then '972' || substr(d1, 5) else d1 end as d
        from (select case when d0 like '00%' then substr(d0, 3) else d0 end as d1
              from (select regexp_replace(split_part(split_part(coalesce(p, ''), '@', 1), ':', 1), '\D', '', 'g') as d0) a) b) c
$$;

-- ההרשמה — הנרמול האחד (שאר הגוף זהה ל-0041).
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
  v_phone := f_normalize_phone(v_phone);   -- ★ 0065: הנרמול האחד (היה: רק 0XXXXXXXXX)
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

-- ─── 2. הקמת השרת הישן — מוסרת ───
drop function if exists rpc_wa_provision(text, text, text, text);
drop function if exists rpc_wa_issue_provision_token(int);
drop function if exists rpc_wa_setup_report(text, text);
drop table if exists wa_config;

-- ─── 3. קצב שליחה ───
-- min_gap_seconds / max_gap_seconds: מרווח אקראי בין הודעות בתור. max_per_minute: תקרה קשיחה.
-- run_budget_seconds: כמה זמן סבב אחד של התור רץ (השאר — בסבב הבא).
insert into settings (key, value)
values ('wa_pacing', '{"min_gap_seconds": 8, "max_gap_seconds": 20, "max_per_minute": 4, "run_budget_seconds": 110}'::jsonb)
on conflict (key) do nothing;

-- ערך לא תקין בהגדרות → ברירת המחדל; ערך קיצוני → נחתך לטווח סביר. המקסימום לא קטן מהמינימום.
create or replace function f_wa_pacing() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('min_gap_seconds', x.mn, 'max_gap_seconds', greatest(x.mx, x.mn),
                            'max_per_minute', x.cap, 'run_budget_seconds', x.budget)
  from (select
    least(greatest(case when v ->> 'min_gap_seconds' ~ '^\d{1,4}$' then (v ->> 'min_gap_seconds')::int else 8 end, 1), 600) as mn,
    least(greatest(case when v ->> 'max_gap_seconds' ~ '^\d{1,4}$' then (v ->> 'max_gap_seconds')::int else 20 end, 1), 600) as mx,
    least(greatest(case when v ->> 'max_per_minute' ~ '^\d{1,3}$' then (v ->> 'max_per_minute')::int else 4 end, 1), 60) as cap,
    least(greatest(case when v ->> 'run_budget_seconds' ~ '^\d{1,4}$' then (v ->> 'run_budget_seconds')::int else 110 end, 10), 140) as budget
    from (select coalesce((select value from settings where key = 'wa_pacing'), '{}'::jsonb) as v) s) x
$$;
revoke all on function f_wa_pacing() from public, anon, authenticated;

-- ★ מקום לשליחה אמיתית אחת — או "לחכות X שניות". נעילת שורה: שתי שליחות במקביל לא עוברות יחד את
--   המרווח או התקרה. נקרא רק לפני שליחה אמיתית (הרצה יבשה לא צורכת מקום).
create or replace function rpc_wa_reserve_send() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := f_wa_pacing(); v_gap int; v_cap int; v_state jsonb; v_recent timestamptz[]; v_last timestamptz;
begin
  v_gap := (p ->> 'min_gap_seconds')::int;
  v_cap := (p ->> 'max_per_minute')::int;
  insert into settings (key, value) values ('wa_pacing_state', '{"recent": []}'::jsonb) on conflict (key) do nothing;
  select value into v_state from settings where key = 'wa_pacing_state' for update;
  select coalesce(array_agg(t order by t), '{}') into v_recent
    from (select x::timestamptz as t from jsonb_array_elements_text(coalesce(v_state -> 'recent', '[]'::jsonb)) x) a
   where t > now() - interval '60 seconds';
  v_last := v_recent[array_upper(v_recent, 1)];
  if v_last is not null and now() < v_last + make_interval(secs => v_gap) then
    return jsonb_build_object('ok', false, 'reason', 'gap',
                              'wait_seconds', greatest(ceil(extract(epoch from (v_last + make_interval(secs => v_gap) - now()))), 1));
  end if;
  if coalesce(array_length(v_recent, 1), 0) >= v_cap then
    return jsonb_build_object('ok', false, 'reason', 'per_minute',
                              'wait_seconds', greatest(ceil(extract(epoch from (v_recent[1] + interval '60 seconds' - now()))), 1));
  end if;
  update settings set value = jsonb_build_object('recent', to_jsonb(v_recent || now())) where key = 'wa_pacing_state';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function rpc_wa_reserve_send() from public, anon, authenticated;
grant execute on function rpc_wa_reserve_send() to service_role;

-- ההגדרות (אחרי חיתוך לטווח) — לתור (cron-reminders): המרווח האקראי וזמן הסבב.
create or replace function rpc_wa_pacing() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$ select f_wa_pacing() $$;
revoke all on function rpc_wa_pacing() from public, anon, authenticated;
grant execute on function rpc_wa_pacing() to service_role;
