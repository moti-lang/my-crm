-- 0050 — ביטול תשלום (בעלים): "נרשם בטעות" או "הוחזר להורה" — והחוב חוזר כאילו לא שולם.
--
-- עד עכשיו אפשר היה לרשום תשלום, אבל לא לבטל אותו. את הכסף עצמו מחזירים ב-SUMIT (המערכת לא מחזירה
-- כסף לכרטיס) — כאן נרשם מה שקרה:
--  · "נרשם בטעות": התשלום נמחק (deleted_at) — יוצא מהחוב ומהדוחות. נשאר ביומן: מי, מתי, ולמה.
--  · "הוחזר להורה": שורת החזר (סכום שלילי, source refund, refund_of) — החוב חוזר, וההיסטוריה מראה
--    את התשלום ואת ההחזר. החזר אחד לכל תשלום.
--  · החיוב הראשון כבר לא מכוסה, ונרשמה דרך ההרשמה → חוזרת ל"ממתינה" (אפשר לשלוח "קישור הרשמה חדש").
--  · קישור הרשמה ששולם בתשלום שבוטל — כבר לא נחשב "שולם".
--  · ★ הוראת קבע קיימת ב-SUMIT — אין "קישור הרשמה חדש" (הוראה שנייה); הביטול כאן לא עוצר אותה — מתריעים.
--  · היומן — בטריגר על payments (שם המבטלת נקרא שם, ולא בפונקציה שהמשתמשת מריצה).

alter table payments add column if not exists refund_of uuid references payments(id);
alter table payments add column if not exists void_reason text;
alter table payments add column if not exists voided_by uuid references profiles(id);
create unique index if not exists payments_one_refund on payments (refund_of) where refund_of is not null and deleted_at is null;

-- תשלום שבוטל: נמחק, או שיש עליו החזר חי.
create or replace function f_payment_voided(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_id is not null and (exists (select 1 from payments p where p.id = p_id and p.deleted_at is not null)
                                or exists (select 1 from payments r where r.refund_of = p_id and r.deleted_at is null))
$$;
revoke all on function f_payment_voided(uuid) from public, anon, authenticated;

-- קישור ההרשמה שולם — בתשלום שלא בוטל.
create or replace function f_enrollment_link_paid(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from payment_links l where l.student_id = p_student and l.purpose = 'enrollment'
                  and l.status in ('paid', 'mismatch') and not f_payment_voided(l.payment_id))
$$;
revoke all on function f_enrollment_link_paid(uuid) from public, anon, authenticated;

-- כמו ב-0049: קישור הרשמה ששולם בתשלום שבוטל לא נחשב, והוראת קבע קיימת חוסמת.
create or replace function f_enrollment_unpaid(s students) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select s.status = 'pending' and s.cancelled_at is null and s.deleted_at is null
     and not coalesce(s.external_payment, false)
     and s.payment_track is not null and coalesce(s.payment_track ->> 'method', 'cash') <> 'cash'
     and not f_enrollment_link_paid(s.id)
     and not f_first_charge_covered(s)
$$;
revoke all on function f_enrollment_unpaid(students) from public, anon, authenticated;

-- ─── הביטול (בעלים) ───
create or replace function rpc_void_payment(p_payment uuid, p_kind text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p payments%rowtype; s students%rowtype; v_before boolean; v_after boolean; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
        v_refund uuid; v_pending boolean := false; v_balance numeric; v_so boolean;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לבטל תשלום' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('mistake', 'refund') then raise exception 'סוג ביטול לא מוכר'; end if;
  if v_reason is null then raise exception 'יש לכתוב סיבה לביטול'; end if;
  select * into p from payments where id = p_payment for update;
  if p.id is null or p.deleted_at is not null then raise exception 'התשלום לא נמצא, או שכבר בוטל'; end if;
  if p.amount <= 0 or p.source = 'refund' then raise exception 'זו שורת החזר — אין מה לבטל בה'; end if;
  if exists (select 1 from payments r where r.refund_of = p.id and r.deleted_at is null) then raise exception 'על התשלום הזה כבר נרשם החזר'; end if;
  select * into s from students where id = p.student_id for update;
  v_before := f_first_charge_covered(s);

  if p_kind = 'mistake' then
    update payments set deleted_at = now(), void_reason = v_reason, voided_by = auth.uid() where id = p.id;
  else
    insert into payments (student_id, branch_id, paid_on, amount, method, source, note, refund_of, void_reason, voided_by, collected_by)
    values (p.student_id, p.branch_id, f_today_il(), -p.amount, p.method, 'refund',
            format('החזר על תשלום מ-%s: %s', to_char(p.paid_on, 'DD/MM/YYYY'), v_reason), p.id, v_reason, auth.uid(), auth.uid())
    returning id into v_refund;
  end if;

  select * into s from students where id = s.id;
  v_after := f_first_charge_covered(s);
  -- כאילו לא שולם: מי שנרשמה דרך ההרשמה והחיוב הראשון שלה כבר לא מכוסה — "ממתינה".
  if v_before and not v_after and s.status = 'active' and s.source = 'enrollment' and s.cancelled_at is null and s.deleted_at is null then
    update students set status = 'pending' where id = s.id;
    v_pending := true;
  end if;
  select (s.tuition_total - s.discount) - coalesce(sum(x.amount), 0) into v_balance from payments x where x.student_id = s.id and x.deleted_at is null;
  v_so := exists (select 1 from standing_orders o where o.student_id = s.id and o.status in ('active', 'retrying', 'failed'));
  return jsonb_build_object('ok', true, 'kind', p_kind, 'amount', p.amount, 'refund_id', v_refund, 'from_sumit', coalesce(p.source, '') = 'sumit',
                            'standing_active', v_so, 'pending', v_pending, 'balance', v_balance);
end $$;
revoke all on function rpc_void_payment(uuid, text, text) from public, anon;
grant execute on function rpc_void_payment(uuid, text, text) to authenticated;

-- ─── היומן: טריגר (שם המבטלת נקרא כאן) ───
create or replace function f_payment_void_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kind text; v_orig payments%rowtype;
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    v_kind := 'mistake'; v_orig := new;
  elsif tg_op = 'INSERT' and new.source = 'refund' and new.refund_of is not null then
    v_kind := 'refund'; select * into v_orig from payments where id = new.refund_of;
  else
    return new;
  end if;
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (coalesce('user:' || coalesce(new.voided_by, auth.uid())::text, 'system'), 'void_payment', 'payments', v_orig.id,
          jsonb_build_object('amount', v_orig.amount, 'paid_on', v_orig.paid_on, 'method', v_orig.method, 'source', v_orig.source),
          jsonb_build_object('kind', v_kind, 'reason', new.void_reason, 'student', v_orig.student_id, 'refund_id', case when v_kind = 'refund' then new.id end,
                             'by_name', coalesce((select full_name from profiles where id = coalesce(new.voided_by, auth.uid())), 'משתמשת לא מזוהה')), 'ui');
  return new;
end $$;
revoke all on function f_payment_void_audit() from public, anon, authenticated;
drop trigger if exists payments_void_audit on payments;
create trigger payments_void_audit after insert or update of deleted_at on payments
  for each row execute function f_payment_void_audit();

-- היסטוריית הביטולים של תלמידה — מהיומן בלבד.
create or replace function rpc_payment_void_history(p_student uuid) returns table (at timestamptz, kind text, amount numeric, paid_on date, reason text, by_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.created_at, a.after ->> 'kind', (a.before ->> 'amount')::numeric, (a.before ->> 'paid_on')::date, a.after ->> 'reason', a.after ->> 'by_name'
    from audit_log a
   where a.action = 'void_payment' and a.after ->> 'student' = p_student::text
     and (auth_role() in ('owner', 'accountant')
          or (auth_role() = 'branch_manager' and exists (select 1 from students s where s.id = p_student and s.branch_id in (select my_branches()))))
   order by a.created_at desc
$$;
revoke all on function rpc_payment_void_history(uuid) from public, anon;
grant execute on function rpc_payment_void_history(uuid) to authenticated;

-- ─── קישור הרשמה חדש: כמו ב-0049, ועוד — לא כשיש הוראת קבע; "שולם" רק בתשלום שלא בוטל ───
create or replace function rpc_renew_enrollment_link(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s students%rowtype; v_amount numeric; v_token text; v_id uuid; v_base text; v_url text; v_reminder uuid;
  v_branch text; v_program text; v_first text; v_standing boolean; v_n int; v_cancelled int;
begin
  select * into s from students where id = p_student and deleted_at is null;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and s.branch_id in (select my_branches())) then
    raise exception 'אין הרשאה לשלוח קישור תשלום לתלמידה הזו' using errcode = '42501';
  end if;
  if s.parent_phone is null then raise exception 'לתלמידה אין טלפון של הורה — אין למי לשלוח את הקישור'; end if;
  -- ★ הוראת קבע קיימת ב-SUMIT (גם אם התשלום הראשון הוחזר) — קישור חדש היה יוצר הוראה שנייה.
  if exists (select 1 from standing_orders o where o.student_id = s.id and o.status in ('active', 'retrying', 'failed')) then
    raise exception 'לתלמידה יש הוראת קבע ב-SUMIT — קישור הרשמה חדש היה יוצר הוראה שנייה. קודם לעצור את ההוראה הקיימת.';
  end if;
  if f_enrollment_link_paid(s.id) then
    raise exception 'החיוב הראשון בהרשמה כבר שולם — אין צורך בקישור הרשמה חדש';
  end if;
  -- ★ החיוב הראשון כבר מכוסה בתשלום אחר (קישור רגיל / רישום ידני) — קישור נוסף היה מחייב פעמיים.
  if f_first_charge_covered(s) then
    raise exception 'המשפחה כבר שילמה את החיוב הראשון (% ₪ עד עכשיו) — אין צורך בקישור הרשמה חדש',
      (select trim_scale(coalesce(sum(p.amount), 0)) from payments p where p.student_id = s.id and p.deleted_at is null);
  end if;
  if not f_enrollment_unpaid(s) then
    raise exception 'קישור הרשמה חדש — רק לתלמידה שממתינה לחיוב הראשון בכרטיס (לא במזומן ולא תלמידה פעילה)';
  end if;
  v_amount := (s.payment_track ->> 'first_charge')::numeric;
  if v_amount is null or v_amount <= 0 then raise exception 'במסלול של התלמידה אין חיוב ראשון בכרטיס'; end if;
  v_n := coalesce((s.payment_track ->> 'installments')::int, 1);
  v_standing := s.payment_track ->> 'method' = 'standing_order' and v_n >= 2;

  -- קישור אחד חי בכל רגע (כמו בקישור תשלום): הפתוח הקודם — של ההרשמה או חוב — מתבטל.
  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  get diagnostics v_cancelled = row_count;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id := gen_random_uuid();
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, created_by)
  values (v_id, v_token, 'tl-' || v_id, s.id, s.branch_id, v_amount, 'enrollment', auth.uid());

  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  select name, nullif(trim(coalesce(program_name, '')), '') into v_branch, v_program from branches where id = s.branch_id;
  v_first := split_part(s.full_name, ' ', 1);

  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, created_by, dedupe_key)
  values ('payment_link', s.id, s.branch_id, s.parent_phone, coalesce(s.parent_name, '') || ' · ' || s.full_name,
          format(E'שלום %s, זה קישור חדש להשלמת ההרשמה של %s%s (%s): %s\nהתשלום הראשון: %s ₪.%s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 coalesce(s.parent_name, ''), v_first, coalesce(' — ' || v_program, ''), v_branch, v_url, to_char(v_amount, 'FM999,999,990'),
                 case when v_standing then format(' בדף בוחרים את יום החיוב בחודש ומאשרים את הוראת הקבע (עוד %s תשלומים).', v_n - 1) else '' end),
          now(), auth.uid(), 'payment_link:' || v_id)
  returning id into v_reminder;
  update payment_links set reminder_id = v_reminder where id = v_id;

  insert into audit_log (actor, action, table_name, row_id, after, source)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'renew_enrollment_link', 'students', s.id,
          jsonb_build_object('link', v_id, 'amount', v_amount, 'track', s.payment_track ->> 'key', 'cancelled_links', v_cancelled), 'ui');

  return jsonb_build_object('id', v_id, 'token', v_token, 'url', v_url, 'amount', v_amount, 'expires_at', now() + interval '7 days',
                            'standing', v_standing, 'track', s.payment_track ->> 'label', 'cancelled', v_cancelled,
                            'whatsapp', f_link_whatsapp_state(v_reminder));
end $$;
revoke all on function rpc_renew_enrollment_link(uuid) from public, anon;
grant execute on function rpc_renew_enrollment_link(uuid) to authenticated;
