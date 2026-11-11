-- 0049 — תלמידה "ממתינה" עוברת ל"פעילה" ברגע שהחיוב הראשון שולם — בכל דרך.
--
-- המקרה (11/11): אדל לוגסי וחנה הן שילמו הכל (2,100 ₪) — אחת ברישום ידני, אחת בקישור תשלום רגיל —
-- ונשארו "ממתינה": המעבר ל"פעילה" קרה רק כשקישור ההרשמה עצמו שולם. ובגלל ש"ממתינה", "קישור הרשמה
-- חדש" נשלח לחנה הן (350 ₪ + הוראת קבע) אחרי שכבר שילמה הכל — בוטל ידנית לפני ששולם.
--
-- עכשיו:
--  · f_first_charge_covered: מה ששולם (כל התשלומים) מכסה את החיוב הראשון של המסלול (במזומן — כל תשלום).
--  · טריגר על payments: מכוסה → "פעילה" (וביומן). רישום ידני (לא SUMIT) → גם קישורי הרשמה פתוחים
--    מתבטלים (אחרת חיוב כפול). ★ לא בתשלום מ-SUMIT: שם התשלום נרשם באמצע רישום הקישור (לפני שהוא
--    מסומן "שולם") — לא נוגעים בקישורים באמצע. ובקישור רגיל, הקישורים הפתוחים כבר בוטלו כשנוצר.
--  · f_enrollment_unpaid: גם "לא מכוסה" — "קישור הרשמה חדש" וחסימת קישור התשלום הרגיל לפי זה.
--  · rpc_renew_enrollment_link: הודעה ברורה כשהחיוב הראשון כבר שולם.
--  · השלמה: מי שכבר מכוסה וממתינה — "פעילה" עכשיו (אדל לוגסי, חנה הן).

create or replace function f_first_charge_covered(s students) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select s.payment_track is not null
     and coalesce((select sum(p.amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0)
         >= greatest(coalesce((s.payment_track ->> 'first_charge')::numeric, 0), 0.01)
$$;
revoke all on function f_first_charge_covered(students) from public, anon, authenticated;

-- כמו ב-0046, ועוד: החיוב הראשון לא מכוסה בתשלום אחר.
create or replace function f_enrollment_unpaid(s students) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select s.status = 'pending' and s.cancelled_at is null and s.deleted_at is null
     and not coalesce(s.external_payment, false)
     and s.payment_track is not null and coalesce(s.payment_track ->> 'method', 'cash') <> 'cash'
     and not exists (select 1 from payment_links l
                      where l.student_id = s.id and l.purpose = 'enrollment' and l.status in ('paid', 'mismatch'))
     and not f_first_charge_covered(s)
$$;
revoke all on function f_enrollment_unpaid(students) from public, anon, authenticated;

-- ─── הטריגר: תשלום שמכסה את החיוב הראשון → "פעילה" ───
create or replace function f_activate_on_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_paid numeric; v_cancelled int := 0;
begin
  if new.deleted_at is not null or new.student_id is null then return new; end if;
  select * into s from students where id = new.student_id for update;
  if s.id is null or s.status <> 'pending' or s.cancelled_at is not null or s.deleted_at is not null or not f_first_charge_covered(s) then
    return new;
  end if;
  update students set status = 'active' where id = s.id;
  if coalesce(new.source, '') <> 'sumit' then
    update payment_links set status = 'cancelled' where student_id = s.id and purpose = 'enrollment' and status in ('pending', 'opened');
    get diagnostics v_cancelled = row_count;
  end if;
  select coalesce(sum(p.amount), 0) into v_paid from payments p where p.student_id = s.id and p.deleted_at is null;
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'activate_on_payment', 'students', s.id,
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', 'active', 'paid', v_paid, 'first_charge', s.payment_track ->> 'first_charge',
                             'payment_source', new.source, 'cancelled_enrollment_links', v_cancelled), 'trigger');
  return new;
end $$;
revoke all on function f_activate_on_payment() from public, anon, authenticated;
drop trigger if exists payments_activate_student on payments;
create trigger payments_activate_student after insert or update of amount, deleted_at on payments
  for each row execute function f_activate_on_payment();

-- ─── קישור הרשמה חדש: כמו ב-0047, ועוד הודעה ברורה כשהחיוב הראשון כבר שולם ───
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
  if exists (select 1 from payment_links l where l.student_id = s.id and l.purpose = 'enrollment' and l.status in ('paid', 'mismatch')) then
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

-- ─── השלמה: מי שכבר שילמה את החיוב הראשון ועדיין "ממתינה" ───
with a as (
  update students s set status = 'active'
   where s.status = 'pending' and s.cancelled_at is null and s.deleted_at is null and f_first_charge_covered(s)
  returning s.id, s.payment_track ->> 'first_charge' as first_charge
)
insert into audit_log (actor, action, table_name, row_id, before, after, source)
select 'system', 'activate_on_payment', 'students', a.id, jsonb_build_object('status', 'pending'),
       jsonb_build_object('status', 'active', 'first_charge', a.first_charge, 'backfill', '0049',
                          'paid', (select coalesce(sum(p.amount), 0) from payments p where p.student_id = a.id and p.deleted_at is null)), 'migration'
from a;
