-- 0045 — הנחה לתלמידה (הבעלים), בשקלים או באחוזים, עם סיבה.
--
-- ★ ההנחה (students.discount, בשקלים) קיימת מההתחלה ומורידה מהחוב — אבל לא הייתה דרך להזין אותה
--   במסך, והיא לא שינתה את הסכומים בקישור ובהוראת הקבע. עכשיו, לפי השלב של התלמידה:
--   · קישור תשלום שעוד לא שולם — המסלול מחושב מחדש (אותו כלל כמו בהרשמה), הקישור מתעדכן,
--     ואישור הוראת הקבע מתאפס: ההורה תאשר את הסכומים החדשים כשתפתח את הקישור.
--   · הוראת קבע פעילה — ההנחה מתחלקת שווה על החיובים שנותרו, בשקלים שלמים (ב-SUMIT כל החיובים
--     באותו סכום — ההנחה בפועל מוצגת לפני השמירה). העדכון ב-SUMIT (הפונקציה student-discount),
--     ורק אחריו אצלנו. הורדת הנחה (העלאת סכום) — לא בהוראה פעילה: ההורה אישרה סכום נמוך יותר.
--   · שולם הכל — החוב יורד (או יתרת זכות, להחזר ידני ב-SUMIT).
-- ★ ההנחה על שכר הלימוד בלבד (לא על דמי הרישום). בעלים בלבד.
-- ★ יומן: כל שינוי הנחה — מכל מסלול (גם ייבוא) — נרשם בטריגר: מי, מתי, מכמה לכמה, ולמה.
--   שינוי בסכום החודשי של הוראת קבע — גם ביומן הוראות הקבע.

-- ─────────── יומן הוראות הקבע: גם שינוי סכום ───────────
alter table standing_order_events add column if not exists from_amount numeric(10,2), add column if not exists to_amount numeric(10,2);
alter table standing_order_events drop constraint if exists standing_order_events_kind_check;
alter table standing_order_events add constraint standing_order_events_kind_check check (kind in ('reschedule', 'sumit_change', 'amount_change'));

create or replace view v_standing_order_events as
select e.id, e.standing_order_id, o.student_id, s.full_name, o.branch_id, b.name as branch_name, e.kind,
       e.from_date, e.to_date, e.from_day, e.to_day, e.remaining, e.actor_label, e.created_at, e.from_amount, e.to_amount
from standing_order_events e
join standing_orders o on o.id = e.standing_order_id
join students s on s.id = o.student_id
join branches b on b.id = o.branch_id
where auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches()));
alter view v_standing_order_events set (security_invoker = false);
revoke all on v_standing_order_events from anon, public;
grant select on v_standing_order_events to authenticated;

-- ─────────── יומן: כל שינוי הנחה ───────────
-- מי: המשתמשת המחוברת, או p_by שהפונקציה מעבירה (app.actor) כשהשינוי מגיע מ-student-discount.
create or replace function f_student_discount_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := coalesce(auth.uid(), nullif(current_setting('app.actor', true), '')::uuid);
begin
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (coalesce('user:' || v_actor::text, 'system'), 'discount_change', 'students', new.id,
          jsonb_build_object('discount', old.discount, 'reason', old.discount_reason),
          jsonb_build_object('discount', new.discount, 'reason', new.discount_reason,
                             'by_name', (select full_name from profiles where id = v_actor)),
          case when v_actor is null then 'system' else 'ui' end);
  return new;
end $$;
revoke all on function f_student_discount_audit() from public, anon, authenticated;
drop trigger if exists students_discount_audit on students;
create trigger students_discount_audit after update of discount, discount_reason on students
  for each row when (old.discount is distinct from new.discount or old.discount_reason is distinct from new.discount_reason)
  execute function f_student_discount_audit();

-- ─────────── המסלול אחרי הנחה — אותו כלל כמו בהרשמה (computeTrack / f_plan_check) ───────────
-- שכר הלימוד מתחלק שווה, עגול לשקל; התשלום הראשון סופג את ההפרש.
create or replace function f_track_with_tuition(p_track jsonb, p_tuition numeric, p_fee numeric) returns jsonb
language sql immutable as $$
  select case p_track ->> 'method'
    when 'standing_order' then p_track || jsonb_build_object(
      'installment_amount', floor(p_tuition / x.n), 'first_installment', p_tuition - floor(p_tuition / x.n) * (x.n - 1),
      'first_charge', p_fee + p_tuition - floor(p_tuition / x.n) * (x.n - 1), 'total', p_tuition + p_fee)
    when 'card_once' then p_track || jsonb_build_object(
      'installment_amount', p_tuition, 'first_installment', p_tuition, 'first_charge', p_tuition + p_fee, 'total', p_tuition + p_fee)
    else p_track || jsonb_build_object('total', p_tuition + p_fee) end
  from (select greatest(coalesce((p_track ->> 'installments')::int, 1), 1) as n) x
$$;
revoke all on function f_track_with_tuition(jsonb, numeric, numeric) from public, anon, authenticated;

-- ─────────── התוכנית: מה ההנחה תשנה (בלי לשנות כלום) ───────────
create or replace function f_discount_plan(p_student uuid, p_amount numeric, p_today date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s students%rowtype; o standing_orders%rowtype; l payment_links%rowtype;
        v_delta numeric; v_paid numeric; v_tuition numeric; v_balance numeric; v_pct numeric;
        v_remaining int; v_cut numeric; v_monthly numeric; v_after numeric;
        v_lines text[] := '{}'; v_links jsonb := '[]'::jsonb; v_new numeric; v_track jsonb := null;
begin
  select * into s from students where id = p_student;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'התלמידה לא נמצאה'); end if;
  if s.deleted_at is not null then return jsonb_build_object('ok', false, 'error', 'התלמידה נמחקה'); end if;
  if p_amount is null or p_amount < 0 or p_amount <> trunc(p_amount) then
    return jsonb_build_object('ok', false, 'error', 'ההנחה: סכום בשקלים שלמים, 0 ומעלה');
  end if;
  if p_amount > s.tuition_total then
    return jsonb_build_object('ok', false, 'error', format('ההנחה (%s ₪) גדולה משכר הלימוד (%s ₪)', to_char(p_amount, 'FM999,990'), to_char(s.tuition_total, 'FM999,990')));
  end if;
  v_delta := p_amount - s.discount;
  if v_delta = 0 then return jsonb_build_object('ok', false, 'error', 'זו כבר ההנחה של התלמידה'); end if;
  select coalesce(sum(amount), 0) into v_paid from payments where student_id = s.id and deleted_at is null;

  -- ─── הוראת קבע פעילה: ההנחה מתחלקת על החיובים שנותרו ───
  select * into o from standing_orders where student_id = s.id and status in ('active', 'retrying') and sumit_recurring_id is not null
   order by created_at desc limit 1;
  if o.id is not null and o.installments - o.charged_count > 0 then
    if o.status <> 'active' then
      return jsonb_build_object('ok', false, 'error', 'יש חיוב שנדחה ו-SUMIT מנסה לחייב שוב — אפשר לתת הנחה אחרי שהחיוב יעבור');
    end if;
    if v_delta < 0 then
      return jsonb_build_object('ok', false, 'error', 'אי אפשר להקטין או לבטל הנחה כשיש הוראת קבע פעילה: ההורה אישרה את הסכומים הנמוכים. לשינוי — לעצור את ההוראה ולשלוח קישור חדש.');
    end if;
    if o.next_billing is null or o.next_billing <= p_today then
      return jsonb_build_object('ok', false, 'error',
        format('החיוב שתוכנן ל-%s עוד לא נקלט מ-SUMIT. אפשר לתת הנחה אחרי שייקלט (בדרך כלל למחרת).', coalesce(to_char(o.next_billing, 'DD/MM'), '—')));
    end if;
    v_remaining := o.installments - o.charged_count;
    v_cut := round(v_delta / v_remaining);
    if v_cut < 1 then
      return jsonb_build_object('ok', false, 'error',
        format('ההנחה (%s ₪) קטנה מדי לחלוקה על %s החיובים שנותרו — פחות משקל לחיוב.', to_char(v_delta, 'FM999,990'), v_remaining));
    end if;
    v_monthly := o.amount - v_cut;
    if v_monthly < 1 then
      return jsonb_build_object('ok', false, 'error',
        format('ההנחה גדולה מהחיובים שנותרו בהוראת הקבע (%s × %s ₪).', v_remaining, to_char(o.amount, 'FM999,990')));
    end if;
    v_after := s.discount + v_cut * v_remaining;
    v_tuition := s.tuition_total - v_after;
    v_lines := v_lines || format('ההנחה: %s ₪. שכר הלימוד: %s ₪ במקום %s ₪.', to_char(v_after, 'FM999,990'),
                                 to_char(v_tuition, 'FM999,990'), to_char(s.tuition_total - s.discount, 'FM999,990'));
    v_lines := v_lines || format('בהוראת הקבע: %s חיובים של %s ₪ במקום %s ₪, החל מ-%s.', v_remaining,
                                 to_char(v_monthly, 'FM999,990'), to_char(o.amount, 'FM999,990'), to_char(o.next_billing, 'DD/MM'));
    if v_cut * v_remaining <> v_delta then
      v_lines := v_lines || format('החיובים בהוראת קבע שווים, ולכן ההנחה בפועל %s ₪ (%s ₪ × %s) ולא %s ₪.',
                                   to_char(v_cut * v_remaining, 'FM999,990'), to_char(v_cut, 'FM999,990'), v_remaining, to_char(v_delta, 'FM999,990'));
    end if;
    return jsonb_build_object('ok', true, 'stage', 'standing', 'requested', p_amount, 'discount_before', s.discount, 'discount_after', v_after,
      'tuition_after', v_tuition, 'balance_after', v_tuition + s.registration_fee - v_paid,
      'standing', jsonb_build_object('id', o.id, 'from_monthly', o.amount, 'to_monthly', v_monthly, 'remaining', v_remaining,
                                     'cut', v_cut, 'next', o.next_billing),
      'links', '[]'::jsonb, 'lines', to_jsonb(v_lines));
  end if;

  -- ─── שולם החיוב הראשון והוראת הקבע עוד לא נוצרה (הסנכרון יוצר אותה תוך כמה שעות) ───
  if s.payment_track ->> 'method' = 'standing_order'
     and exists (select 1 from payment_links pl where pl.student_id = s.id and pl.purpose = 'enrollment' and pl.status in ('paid', 'mismatch')
                   and pl.standing_consented_at is not null
                   and not exists (select 1 from standing_orders so where so.payment_link_id = pl.id)) then
    return jsonb_build_object('ok', false, 'error', 'הוראת הקבע של התלמידה בתהליך יצירה ב-SUMIT (עד כמה שעות אחרי התשלום הראשון). אפשר לתת הנחה אחרי שתיווצר.');
  end if;

  -- ─── לפני תשלום / שולם הכל: החוב, וקישורים פתוחים ───
  v_after := p_amount;
  v_tuition := s.tuition_total - p_amount;
  v_balance := v_tuition + s.registration_fee - v_paid;
  v_pct := round(p_amount * 100 / nullif(s.tuition_total, 0), 1);
  v_lines := v_lines || format('ההנחה: %s ₪ (%s%% משכר הלימוד). שכר הלימוד: %s ₪ במקום %s ₪.', to_char(p_amount, 'FM999,990'),
                               to_char(coalesce(v_pct, 0), 'FM990.0'), to_char(v_tuition, 'FM999,990'), to_char(s.tuition_total - s.discount, 'FM999,990'));
  for l in select * from payment_links where student_id = s.id and f_payment_link_alive(payment_links) order by created_at loop
    if l.purpose = 'enrollment' and s.payment_track is not null and v_paid = 0 then
      v_track := f_track_with_tuition(s.payment_track, v_tuition, s.registration_fee);
      v_new := (v_track ->> 'first_charge')::numeric;
      if v_new is null or v_new <= 0 then continue; end if;
      v_links := v_links || jsonb_build_object('id', l.id, 'purpose', l.purpose, 'from', l.amount, 'to', v_new, 'action', 'update');
      v_lines := v_lines || case when s.payment_track ->> 'method' = 'standing_order' and (s.payment_track ->> 'installments')::int >= 2
        then format('בקישור התשלום: %s ₪ במקום %s ₪, ואחריו %s חיובים חודשיים של %s ₪ במקום %s ₪. ההורה תאשר את הסכומים החדשים כשתפתח את הקישור.',
                    to_char(v_new, 'FM999,990'), to_char(l.amount, 'FM999,990'), (s.payment_track ->> 'installments')::int - 1,
                    to_char((v_track ->> 'installment_amount')::numeric, 'FM999,990'), to_char((s.payment_track ->> 'installment_amount')::numeric, 'FM999,990'))
        else format('בקישור התשלום: %s ₪ במקום %s ₪.', to_char(v_new, 'FM999,990'), to_char(l.amount, 'FM999,990')) end;
    elsif v_balance <= 0 then
      v_links := v_links || jsonb_build_object('id', l.id, 'purpose', l.purpose, 'from', l.amount, 'to', 0, 'action', 'cancel');
      v_lines := v_lines || 'קישור התשלום הפתוח מבוטל — אין יותר חוב.'::text;
    elsif l.amount > v_balance then
      v_links := v_links || jsonb_build_object('id', l.id, 'purpose', l.purpose, 'from', l.amount, 'to', v_balance, 'action', 'update');
      v_lines := v_lines || format('קישור התשלום הפתוח: %s ₪ במקום %s ₪.', to_char(v_balance, 'FM999,990'), to_char(l.amount, 'FM999,990'));
    end if;
  end loop;
  if jsonb_array_length(v_links) = 0 then
    v_lines := v_lines || case when v_balance < 0
      then format('יתרת זכות: %s ₪ — שולם יותר מהסכום אחרי ההנחה. את ההחזר עושים ידנית ב-SUMIT.', to_char(-v_balance, 'FM999,990'))
      else format('החוב: %s ₪.', to_char(v_balance, 'FM999,990')) end;
  end if;
  return jsonb_build_object('ok', true, 'stage', case when jsonb_array_length(v_links) > 0 then 'link' else 'none' end,
    'requested', p_amount, 'discount_before', s.discount, 'discount_after', v_after, 'tuition_after', v_tuition, 'balance_after', v_balance,
    'standing', null, 'links', v_links, 'track', v_track, 'lines', to_jsonb(v_lines));
end $$;
revoke all on function f_discount_plan(uuid, numeric, date) from public, anon, authenticated;

-- הבעלים: התוכנית לפני השמירה — בשקלים או באחוזים (משכר הלימוד, עגול לשקל). בלי שום שינוי.
create or replace function rpc_discount_preview(p_student uuid, p_kind text, p_value numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_amount numeric; v_tuition numeric;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לתת הנחה' using errcode = '42501'; end if;
  select tuition_total into v_tuition from students where id = p_student;
  if p_kind = 'percent' then
    if p_value is null or p_value < 0 or p_value > 100 then return jsonb_build_object('ok', false, 'error', 'אחוז ההנחה: בין 0 ל-100'); end if;
    v_amount := round(coalesce(v_tuition, 0) * p_value / 100);
  elsif p_kind = 'ils' then
    v_amount := p_value;
  else
    return jsonb_build_object('ok', false, 'error', 'סוג הנחה לא מוכר');
  end if;
  return f_discount_plan(p_student, v_amount, f_today_il()) || jsonb_build_object('kind', p_kind, 'value', p_value, 'amount', v_amount);
end $$;
revoke all on function rpc_discount_preview(uuid, text, numeric) from public, anon;
grant execute on function rpc_discount_preview(uuid, text, numeric) to authenticated;

/**
 * (service_role, מהפונקציה student-discount) — השמירה. בהוראת קבע — רק אחרי ש-SUMIT עדכנה את הסכום,
 * ואז p_to_monthly הוא מה ש-SUMIT קיבלה. p_expected — ההנחה שהבעלים ראתה; התוכנית השתנתה — לא נשמר.
 */
create or replace function rpc_discount_apply(p_student uuid, p_amount numeric, p_reason text, p_by uuid,
                                              p_expected numeric, p_to_monthly numeric default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare plan jsonb; s students%rowtype; lk jsonb; v_reason text := btrim(coalesce(p_reason, '')); v_by text;
begin
  if v_reason = '' then return jsonb_build_object('ok', false, 'error', 'יש לכתוב סיבה להנחה'); end if;
  if length(v_reason) > 200 then return jsonb_build_object('ok', false, 'error', 'הסיבה ארוכה מדי (עד 200 תווים)'); end if;
  select * into s from students where id = p_student for update;
  plan := f_discount_plan(p_student, p_amount, f_today_il());
  if not (plan ->> 'ok')::boolean then return plan; end if;
  if (plan ->> 'discount_after')::numeric is distinct from p_expected
     or (plan ->> 'stage' = 'standing' and (plan #>> '{standing,to_monthly}')::numeric is distinct from p_to_monthly) then
    return jsonb_build_object('ok', false, 'changed', true, 'error', 'המצב השתנה מאז שנפתח החלון — לבדוק ולאשר שוב.', 'plan', plan);
  end if;
  perform set_config('app.actor', coalesce(p_by::text, ''), true);
  update students set discount = (plan ->> 'discount_after')::numeric, discount_reason = v_reason where id = s.id;

  if plan ->> 'stage' = 'standing' then
    select full_name into v_by from profiles where id = p_by;
    update standing_orders set amount = p_to_monthly where id = (plan #>> '{standing,id}')::uuid;
    update students set payment_track = payment_track || jsonb_build_object('installment_amount', p_to_monthly)
     where id = s.id and payment_track is not null;
    insert into standing_order_events (standing_order_id, kind, from_date, to_date, remaining, from_amount, to_amount, actor, actor_label)
    values ((plan #>> '{standing,id}')::uuid, 'amount_change', (plan #>> '{standing,next}')::date, (plan #>> '{standing,next}')::date,
            (plan #>> '{standing,remaining}')::int, (plan #>> '{standing,from_monthly}')::numeric, p_to_monthly, p_by,
            coalesce(v_by, 'משתמשת לא מזוהה') || ' · הנחה');
  end if;

  if plan -> 'track' is not null and plan -> 'track' <> 'null'::jsonb then
    update students set payment_track = plan -> 'track' where id = s.id;
  end if;
  for lk in select * from jsonb_array_elements(plan -> 'links') loop
    if lk ->> 'action' = 'cancel' then
      update payment_links set status = 'cancelled' where id = (lk ->> 'id')::uuid and status in ('pending', 'opened');
    else
      -- ★ סכום חדש: דף SUMIT שכבר נוצר (בסכום הישן) נשכח, ואישור הוראת הקבע מתאפס — ההורה תאשר מחדש.
      update payment_links set amount = (lk ->> 'to')::numeric, sumit_page_url = null, sumit_redirect_id = null,
             standing_consent_text = null, standing_consented_at = null, standing_date_start = null
       where id = (lk ->> 'id')::uuid and status in ('pending', 'opened');
    end if;
  end loop;
  return plan;
end $$;
revoke all on function rpc_discount_apply(uuid, numeric, text, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function rpc_discount_apply(uuid, numeric, text, uuid, numeric, numeric) to service_role;

-- ─────────── היסטוריית ההנחה (בכרטיס) ───────────
create or replace function rpc_student_discount_history(p_student uuid)
returns table (changed_at timestamptz, changed_by text, from_amount numeric, to_amount numeric, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.created_at,
         case when a.actor = 'system' then 'המערכת' else coalesce(a.after ->> 'by_name', 'משתמשת לא מזוהה') end,
         (a.before ->> 'discount')::numeric, (a.after ->> 'discount')::numeric, a.after ->> 'reason'
  from audit_log a
  where a.action = 'discount_change' and a.row_id = p_student
    and exists (select 1 from students s where s.id = p_student
                  and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches()))))
  order by a.created_at desc
$$;
revoke all on function rpc_student_discount_history(uuid) from public, anon;
grant execute on function rpc_student_discount_history(uuid) to authenticated;
