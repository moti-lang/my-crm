-- 0027 — שאלות בדף ההרשמה ומסלולי תשלום לכל סניף.
--
-- שלוש שאלות, כל אחת עם מתג "להציג" בהגדרות הסניף (form_options):
--   ask_whatsapp — "האם אתם מקבלים הודעות וואטסאפ?" כן/לא, חובה כשמוצגת.
--                  "לא" → תזכורות אליה לא יוצאות בוואטסאפ (טריגר על reminders),
--                  ובגבייה מופיע "דרוש קשר אחר".
--   ask_photo    — אישור צילום, כן/לא, חובה. הנוסח לכל סניף (photo_consent_text),
--                  נשמר אצל התלמידה. התשובה = students.photo_consent, השדה שחוסם
--                  צירוף להפקה.
--   ask_track    — "אני משלמת:" — מסלול מתוך plan.tracks של הסניף.
--
-- מסלולים: כל אחד { key, label, method: cash | card_once | standing_order,
-- installments }. הסך תמיד annual_total. הסכומים מחושבים, לא מוקלדים:
-- שכר הלימוד (annual_total − registration_fee) מחולק שווה; כשלא יוצא עגול,
-- התשלום הראשון סופג את ההפרש (8 תשלומים של 1,100: 141 ואז 7 × 137).
--   cash           — אין קישור תשלום. ממתינה, ונהיית פעילה כשנרשם תשלום.
--   card_once      — קישור על הסכום המלא.
--   standing_order — קישור על דמי הרישום + התשלום הראשון; היתר בהוראת קבע
--                    (סבב 3). מוסתרים עד ש-settings.standing_orders_enabled.

alter table branches
  add column if not exists form_options jsonb not null default '{"ask_whatsapp": true, "ask_photo": true, "ask_track": true}',
  add column if not exists photo_consent_text text;

alter table students
  add column if not exists whatsapp_opt_in boolean,
  add column if not exists photo_consent_text text,
  add column if not exists payment_track jsonb;

-- ברירת המחדל לנוסח אישור הצילום — בהגדרות, ומועתקת לכל סניף (כמו התקנון).
insert into settings (key, value) values
('photo_consent_text', to_jsonb(E'אישור לצילום - הננו מאשרים לבתנו להשתתף בכל פעילות צילומים שתיערך במהלך השנה בחוג. אם זה בצילומים לסדרה, סרט, קולולם או קליפ.\n\nהמשתתפות בצילומים עושות זאת לחוויתן ולהנאתן ללא תמורה כל שהיא, וזכות ההפקה לעשות בצילומים כל שימוש שברצונם ללא שום הגבלה.'::text)),
('standing_orders_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- ─────────── המסלולים: חישוב סכומים לפי הכלל ───────────
-- tracks חסר (מבנה ישן) → מסלול הוראת קבע אחד לפי installments, כמו קודם.
create or replace function f_plan_tracks(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_total numeric := (p ->> 'annual_total')::numeric;
  v_fee numeric := coalesce((p ->> 'registration_fee')::numeric, 0);
  v_tuition numeric; t jsonb; v_out jsonb := '[]'::jsonb; v_n int; v_each numeric; v_firsti numeric;
  v_method text; v_keys text[] := '{}';
begin
  v_tuition := v_total - v_fee;
  for t in select * from jsonb_array_elements(coalesce(p -> 'tracks',
        jsonb_build_array(jsonb_build_object('key', 'so' || coalesce(p ->> 'installments', '10'), 'method', 'standing_order',
                                             'installments', coalesce((p ->> 'installments')::int, 10),
                                             'label', format('הוראת קבע באשראי %s תשלומים', coalesce(p ->> 'installments', '10'))))))
  loop
    v_method := t ->> 'method';
    if v_method not in ('cash', 'card_once', 'standing_order') then raise exception 'סוג מסלול לא מוכר: %', v_method; end if;
    if coalesce(t ->> 'key', '') = '' or coalesce(trim(t ->> 'label'), '') = '' then raise exception 'לכל מסלול צריך שם'; end if;
    if (t ->> 'key') = any(v_keys) then raise exception 'מסלול כפול: %', t ->> 'key'; end if;
    v_keys := v_keys || (t ->> 'key');
    v_n := case when v_method = 'standing_order' then (t ->> 'installments')::int else 1 end;
    if v_n is null or v_n < 1 or v_n > 36 then raise exception 'מספר תשלומים לא תקין במסלול "%"', t ->> 'label'; end if;
    -- ★ חלוקה שווה, והראשון סופג את ההפרש. עגול לשקל.
    v_each := floor(v_tuition / v_n);
    v_firsti := v_tuition - v_each * (v_n - 1);
    v_out := v_out || jsonb_build_object(
      'key', t ->> 'key', 'label', trim(t ->> 'label'), 'method', v_method, 'installments', v_n,
      'installment_amount', v_each, 'first_installment', v_firsti,
      'first_charge', case v_method when 'cash' then 0 when 'card_once' then v_total else v_fee + v_firsti end,
      'total', v_total);
  end loop;
  if jsonb_array_length(v_out) = 0 then raise exception 'צריך לפחות מסלול תשלום אחד'; end if;
  return v_out;
end $$;
revoke all on function f_plan_tracks(jsonb) from public, anon, authenticated;

-- f_plan_check: הבדיקות הקיימות (כשיש installments ישן) + המסלולים.
create or replace function f_plan_check(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_total numeric; v_fee numeric; v_n int; v_each numeric; v_first numeric; v_tracks jsonb;
begin
  if p is null then raise exception 'חסר מבנה תשלום'; end if;
  v_total := (p ->> 'annual_total')::numeric; v_fee := (p ->> 'registration_fee')::numeric;
  if v_total is null or v_fee is null then raise exception 'מבנה התשלום חסר שדות (שכר לימוד שנתי, דמי רישום)'; end if;
  if v_fee < 0 or v_total <= v_fee then raise exception 'שכר הלימוד השנתי חייב להיות גדול מדמי הרישום'; end if;
  if p ? 'installments' and not p ? 'tracks' then
    v_n := (p ->> 'installments')::int; v_each := (p ->> 'installment_amount')::numeric;
    v_first := coalesce((p ->> 'first_charge')::numeric, v_fee + v_each);
    if v_n is null or v_each is null or v_n < 1 then
      raise exception 'מבנה התשלום חסר שדות (שכר לימוד שנתי, דמי רישום, מספר תשלומים, סכום לתשלום)';
    end if;
    if v_each <= 0 then raise exception 'דמי רישום וסכום לתשלום חייבים להיות חיוביים'; end if;
    if v_fee + v_n * v_each <> v_total then
      raise exception 'מבנה התשלום לא מסתכם: דמי רישום % + % תשלומים × % = %, ולא %',
        v_fee, v_n, v_each, v_fee + v_n * v_each, v_total;
    end if;
    if v_first <> v_fee + v_each then
      raise exception 'החיוב הראשון (%) חייב להיות דמי רישום + תשלום אחד (%)', v_first, v_fee + v_each;
    end if;
  end if;
  v_tracks := f_plan_tracks(p);
  -- התאימות: first_charge = של הוראת הקבע עם הכי הרבה תשלומים (היום: 10 → 210).
  v_first := coalesce((select (t ->> 'first_charge')::numeric from jsonb_array_elements(v_tracks) t
                        where t ->> 'method' = 'standing_order' order by (t ->> 'installments')::int desc limit 1), v_total);
  return p || jsonb_build_object('tuition', v_total - v_fee, 'tracks', v_tracks,
                                 'first_charge', coalesce((p ->> 'first_charge')::numeric, v_first),
                                 'trial_days', coalesce((p ->> 'trial_days')::int, 30),
                                 'cancel_refund', coalesce((p ->> 'cancel_refund')::numeric, 0));
end $$;
revoke all on function f_plan_check(jsonb) from public, anon, authenticated;

-- הסניפים והברירה: חמשת המסלולים. הוראת קבע 10 = המבנה של היום (210 ואז 110).
create or replace function f_default_tracks() returns jsonb language sql immutable as $$
  select '[{"key":"cash","label":"מזומן מראש","method":"cash","installments":1},
           {"key":"card1","label":"כרטיס אשראי בתשלום אחד","method":"card_once","installments":1},
           {"key":"so5","label":"הוראת קבע באשראי 5 תשלומים","method":"standing_order","installments":5},
           {"key":"so8","label":"הוראת קבע באשראי 8 תשלומים","method":"standing_order","installments":8},
           {"key":"so10","label":"הוראת קבע באשראי 10 תשלומים","method":"standing_order","installments":10}]'::jsonb
$$;
revoke all on function f_default_tracks() from public, anon, authenticated;

update settings set value = (value - 'installment_amount' - 'first_charge' - 'installments') || jsonb_build_object('tracks', f_default_tracks())
 where key = 'enrollment_plan' and not value ? 'tracks';
update branches set plan = (plan - 'installment_amount' - 'first_charge' - 'installments') || jsonb_build_object('tracks', f_default_tracks())
 where plan is not null and not plan ? 'tracks';

-- סניף חדש: גם נוסח אישור הצילום מועתק מברירת המחדל.
create or replace function f_branch_defaults() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.plan is null then new.plan := (select value from settings where key = 'enrollment_plan'); end if;
  if new.terms is null then new.terms := (select value #>> '{}' from settings where key = 'enrollment_terms'); end if;
  if new.photo_consent_text is null then new.photo_consent_text := (select value #>> '{}' from settings where key = 'photo_consent_text'); end if;
  if new.plan is not null then perform f_plan_check(new.plan); end if;
  return new;
end $$;
drop trigger if exists branches_defaults on branches;
create trigger branches_defaults before insert or update of plan, terms, photo_consent_text on branches
  for each row execute function f_branch_defaults();
update branches set photo_consent_text = null where photo_consent_text is null;

-- המסלולים שההורה רואה: הוראות קבע רק כשהן פעילות במערכת (סבב 3).
create or replace function f_visible_tracks(p_plan jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from jsonb_array_elements(f_plan_check(p_plan) -> 'tracks') t
   where t ->> 'method' <> 'standing_order'
      or coalesce((select value = 'true'::jsonb from settings where key = 'standing_orders_enabled'), false)
$$;
revoke all on function f_visible_tracks(jsonb) from public, anon, authenticated;

-- ─────────── הדף הציבורי: השאלות שמוצגות + המסלולים הגלויים ───────────
create or replace function rpc_enrollment_public(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_branch uuid; b branches%rowtype; v_state jsonb; v_opts jsonb;
begin
  v_branch := f_enroll_branch(p_token);
  if v_branch is null then
    return jsonb_build_object('ok', false,
      'error', case when coalesce(p_token, '') = '' then 'להרשמה יש להיכנס דרך הקישור של הסניף' else 'הקישור להרשמה אינו תקין' end);
  end if;
  select * into b from branches where id = v_branch;
  v_state := f_branch_enrollment_state(v_branch);
  v_opts := '{"ask_whatsapp": true, "ask_photo": true, "ask_track": true}'::jsonb || coalesce(b.form_options, '{}');
  return jsonb_build_object(
    'ok', true,
    'program_name', (select value #>> '{}' from settings where key = 'program_name'),
    'branch', jsonb_build_object('name', b.name, 'city', b.city, 'schedule', b.schedule_text, 'age_groups', b.age_groups),
    'terms', b.terms,
    'plan', f_plan_check(b.plan) - 'tracks',
    'tracks', f_visible_tracks(b.plan),
    'questions', jsonb_build_object(
      'whatsapp', (v_opts ->> 'ask_whatsapp')::boolean,
      'photo', (v_opts ->> 'ask_photo')::boolean,
      'track', (v_opts ->> 'ask_track')::boolean),
    'photo_consent_text', case when (v_opts ->> 'ask_photo')::boolean then b.photo_consent_text end,
    'open', (v_state ->> 'open')::boolean,
    'closed_reason', v_state ->> 'reason');
end $$;
revoke all on function rpc_enrollment_public(text) from public;
grant execute on function rpc_enrollment_public(text) to anon, authenticated;

-- ─────────── ★ ההרשמה: עם התשובות והמסלול ───────────
create or replace function rpc_enroll(p jsonb, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
  v_n_phone int; v_n_ip int;
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
  v_tracks := f_visible_tracks(b.plan);
  if (v_opts ->> 'ask_track')::boolean then
    select t into v_track from jsonb_array_elements(v_tracks) t where t ->> 'key' = p ->> 'track';
    if v_track is null then return jsonb_build_object('ok', false, 'error', 'יש לבחור אופן תשלום'); end if;
  else
    -- לא נשאלה: המסלול הראשון שמוצג (בלי הוראות קבע לפני סבב 3).
    v_track := v_tracks -> 0;
    if v_track is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;
  end if;

  v_state := f_branch_enrollment_state(v_branch);
  if not (v_state ->> 'open')::boolean then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'branch_' || coalesce(v_state ->> 'reason', 'closed'));
    return jsonb_build_object('ok', false, 'error', case v_state ->> 'reason'
      when 'full' then format('ההרשמה ל%s מלאה. אפשר לפנות לחוג לרשימת המתנה.', b.name)
      else format('ההרשמה ל%s סגורה כרגע.', b.name) end);
  end if;

  v_plan := f_plan_check(b.plan);
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;

  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(trim(v_first || ' ' || v_last))) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'duplicate');
    return jsonb_build_object('ok', false, 'error', format('%s %s כבר רשומה ב%s. לפרטים אפשר לפנות לחוג.', v_first, v_last, b.name));
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_accepted_at, terms_text, plan_snapshot, payment_track, whatsapp_opt_in,
                        photo_consent, photo_consent_text, mailing_consent, trial_started_on, enrolled_at, joined_on)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last, v_grade, v_school, v_phone, v_email,
          'pending', 'enrollment', (v_plan ->> 'tuition')::numeric, (v_plan ->> 'registration_fee')::numeric,
          (v_track ->> 'installments')::int, (v_track ->> 'installments')::int,
          now(), b.terms, v_plan, v_track, v_wa,
          coalesce(v_photo, false), case when v_photo is not null then b.photo_consent_text end,
          coalesce(v_consent, false), current_date, now(), current_date)
  returning id into v_student;

  v_amount := (v_track ->> 'first_charge')::numeric;
  if v_track ->> 'method' <> 'cash' then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
    values (v_token, 'tl-' || gen_random_uuid(), v_student, v_branch, v_amount, 'enrollment');
    select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
    v_url := coalesce(v_base, '') || '/pay/' || v_token;
    -- ההודעה נכנסת לתור בכל מקרה; מי שענתה "לא" לוואטסאפ — הטריגר על reminders מבטל ומסמן.
    insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
    values ('payment_link', v_student, v_branch, v_phone, v_first || ' ' || v_last,
            format(E'תודה שנרשמת ל%s! כדי להשלים את ההרשמה של %s (%s) — קישור לתשלום, %s ₪: %s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                   (select value #>> '{}' from settings where key = 'program_name'), v_first, b.name,
                   to_char(v_amount, 'FM999,999,990'), v_url),
            now(), 'payment_link:enroll:' || v_student);
  end if;

  insert into enrollment_requests (phone, ip, ok) values (v_phone, p_ip, true);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('enrollment', 'insert', 'students', v_student, jsonb_build_object('branch', b.name, 'terms_accepted_at', now(), 'track', v_track ->> 'key'), 'enrollment');
  return jsonb_build_object('ok', true, 'pay_url', v_url, 'amount', case when v_track ->> 'method' = 'cash' then (v_plan ->> 'annual_total')::numeric else v_amount end,
                            'method', v_track ->> 'method', 'track', v_track ->> 'label', 'student', v_first, 'branch', b.name);
end $$;
revoke all on function rpc_enroll(jsonb, text) from public, anon, authenticated;
grant execute on function rpc_enroll(jsonb, text) to service_role;

-- ─────────── "לא מקבלת וואטסאפ": שום תזכורת אליה לא יוצאת ───────────
-- בכל מקור (מסד, cron, ידני): התזכורת נשמרת כמבוטלת עם הסבר, כדי שיופיע
-- "דרוש קשר אחר" — לא נעלמת בשקט.
create or replace function f_reminder_whatsapp_opt_out() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.student_id is not null and new.status = 'scheduled'
     and exists (select 1 from students where id = new.student_id and whatsapp_opt_in = false) then
    new.status := 'cancelled';
    new.error := 'ההורה לא מקבלת הודעות וואטסאפ — דרוש קשר אחר';
  end if;
  return new;
end $$;
revoke all on function f_reminder_whatsapp_opt_out() from public, anon, authenticated;
drop trigger if exists reminders_whatsapp_opt_out on reminders;
create trigger reminders_whatsapp_opt_out before insert or update of status on reminders
  for each row execute function f_reminder_whatsapp_opt_out();

-- ─────────── מזומן: פעילה כשנרשם תשלום ───────────
create or replace function f_activate_on_cash_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.amount > 0 and new.deleted_at is null then
    update students set status = 'active'
     where id = new.student_id and status = 'pending' and cancelled_at is null
       and payment_track ->> 'method' = 'cash';
  end if;
  return new;
end $$;
revoke all on function f_activate_on_cash_payment() from public, anon, authenticated;
drop trigger if exists payments_activate_cash on payments;
create trigger payments_activate_cash after insert on payments
  for each row execute function f_activate_on_cash_payment();

-- הוספה ידנית: מסלול אופציונלי מתוך המסלולים של הסניף (כולל הוראות קבע — הבעלים יודעת).
create or replace function rpc_create_student(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid; b branches%rowtype; v_plan jsonb; v_season uuid; v_id uuid; v_track jsonb;
  v_first text := nullif(left(trim(p ->> 'first_name'), 60), '');
  v_last  text := nullif(left(trim(p ->> 'last_name'), 60), '');
  v_phone text := regexp_replace(coalesce(p ->> 'parent_phone', ''), '\D', '', 'g');
  v_email text := nullif(lower(left(trim(p ->> 'email'), 120)), '');
  v_status student_status;
begin
  begin v_branch := (p ->> 'branch_id')::uuid; exception when others then v_branch := null; end;
  select * into b from branches where id = v_branch and deleted_at is null;
  if b.id is null then raise exception 'יש לבחור סניף'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and v_branch in (select my_branches())) then
    raise exception 'אין הרשאה להוסיף תלמידה לסניף הזה' using errcode = '42501';
  end if;
  if v_first is null or v_last is null then raise exception 'יש למלא שם פרטי ושם משפחה'; end if;
  if v_phone ~ '^0\d{8,9}$' then v_phone := '972' || substr(v_phone, 2); end if;
  if v_phone <> '' and v_phone !~ '^972\d{8,9}$' then raise exception 'מספר הטלפון אינו תקין'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'כתובת המייל אינה תקינה'; end if;
  v_status := coalesce(nullif(p ->> 'status', ''), 'active')::student_status;
  if v_status not in ('active', 'pending') then raise exception 'תלמידה חדשה נוספת כפעילה או כממתינה'; end if;
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then raise exception 'אין עונה פעילה'; end if;
  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(v_first || ' ' || v_last)) then
    raise exception '% % כבר רשומה ב%', v_first, v_last, b.name;
  end if;
  v_plan := f_plan_check(b.plan);
  if nullif(p ->> 'track', '') is not null then
    select t into v_track from jsonb_array_elements(v_plan -> 'tracks') t where t ->> 'key' = p ->> 'track';
    if v_track is null then raise exception 'מסלול התשלום לא קיים בסניף'; end if;
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_name, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_text, plan_snapshot, payment_track, whatsapp_opt_in, photo_consent, mailing_consent, joined_on, notes)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last,
          nullif(left(trim(p ->> 'grade'), 20), ''), nullif(left(trim(p ->> 'school'), 80), ''),
          nullif(left(trim(p ->> 'parent_name'), 80), ''), nullif(v_phone, ''), v_email,
          v_status, 'manual', (v_plan ->> 'tuition')::numeric, (v_plan ->> 'registration_fee')::numeric,
          coalesce((v_track ->> 'installments')::int, 10), coalesce((v_track ->> 'installments')::int, 10),
          b.terms, v_plan, v_track, (p ->> 'whatsapp_opt_in')::boolean, coalesce((p ->> 'photo_consent')::boolean, false),
          coalesce((p ->> 'mailing_consent')::boolean, false), current_date,
          nullif(left(trim(p ->> 'notes'), 500), ''))
  returning id into v_id;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'insert', 'students', v_id, jsonb_build_object('branch', b.name, 'source', 'manual'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function rpc_create_student(jsonb) from public, anon;
grant execute on function rpc_create_student(jsonb) to authenticated;

-- למסכים (בעלים/מנהלת): המסלולים של סניף, מחושבים — כולל הוראות קבע.
create or replace function rpc_branch_tracks(p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and p_branch in (select my_branches())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  return f_plan_check((select plan from branches where id = p_branch)) -> 'tracks';
end $$;
revoke all on function rpc_branch_tracks(uuid) from public, anon;
grant execute on function rpc_branch_tracks(uuid) to authenticated;

-- "נרשמו ולא שילמו": גם המסלול ו"לא מקבלת וואטסאפ" — מזומן ודרוש קשר אחר בגבייה.
create or replace view v_enrolled_unpaid as
select s.id as student_id, s.full_name, s.parent_phone, s.email, s.branch_id, b.name as branch_name,
       s.enrolled_at, (current_date - s.enrolled_at::date) as days_since,
       l.amount as first_charge, l.status as link_status, l.expires_at,
       s.payment_track ->> 'label' as track_label, s.payment_track ->> 'method' as track_method, s.whatsapp_opt_in
from students s
join branches b on b.id = s.branch_id
left join lateral (select amount, status, expires_at from payment_links where student_id = s.id and purpose = 'enrollment' order by created_at desc limit 1) l on true
where s.deleted_at is null and s.source = 'enrollment' and s.status = 'pending' and s.cancelled_at is null
  and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches())));
alter view v_enrolled_unpaid set (security_invoker = false);
revoke all on v_enrolled_unpaid from anon, public;
grant select on v_enrolled_unpaid to authenticated;
