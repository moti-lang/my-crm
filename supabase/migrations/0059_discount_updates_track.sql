-- 0059 — הנחה מעדכנת את סכומי המסלול גם כשאין קישור פתוח, ו"קישור הרשמה חדש" מחשב לפי ההנחה.
--
-- המקרה (16/11): אושרת ראובן ומנוחי ביר קיבלו הנחה של 100 ₪ כשלא היה להן קישור הרשמה פתוח (אחת עם
-- קישור חוב, השנייה עם קישור שפג). החוב ירד נכון, אבל סכומי המסלול (תשלום ראשון וחודשי) נשארו
-- בלי ההנחה — ו"קישור הרשמה חדש" נבנה מהם: 280 + 9×180 = 1,900 במקום 270 + 9×170 = 1,800.
-- (שתיהן תוקנו בנתונים לפני הפריסה, עם רישום ביומן.)
--
--   · f_discount_plan: לא שולם כלום — המסלול מחושב מחדש גם בלי קישור פתוח (והשמירה מעדכנת אותו).
--   · rpc_renew_enrollment_link: הסכומים מחושבים מחדש משכר הלימוד שאחרי ההנחה לפני יצירת הקישור.
-- שאר הגוף של שתי הפונקציות — זהה מילה במילה.

CREATE OR REPLACE FUNCTION public.f_discount_plan(p_student uuid, p_amount numeric, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- ★ 0059: לא שולם כלום — המסלול מחושב מחדש גם בלי קישור הרשמה פתוח, כדי שהקישור הבא (קישור הרשמה
  --   חדש) ייצא בסכומים שאחרי ההנחה.
  if v_track is null and s.payment_track is not null and v_paid = 0 and s.payment_track ->> 'method' in ('standing_order', 'card_once') then
    v_track := f_track_with_tuition(s.payment_track, v_tuition, s.registration_fee);
    if s.payment_track ->> 'method' = 'standing_order' and coalesce((s.payment_track ->> 'installments')::int, 1) >= 2 then
      v_lines := v_lines || format('בקישור הבא: %s ₪, ואחריו %s חיובים חודשיים של %s ₪.', to_char((v_track ->> 'first_charge')::numeric, 'FM999,990'),
                                   (s.payment_track ->> 'installments')::int - 1, to_char((v_track ->> 'installment_amount')::numeric, 'FM999,990'));
    end if;
  end if;
  if jsonb_array_length(v_links) = 0 then
    v_lines := v_lines || case when v_balance < 0
      then format('יתרת זכות: %s ₪ — שולם יותר מהסכום אחרי ההנחה. את ההחזר עושים ידנית ב-SUMIT.', to_char(-v_balance, 'FM999,990'))
      else format('החוב: %s ₪.', to_char(v_balance, 'FM999,990')) end;
  end if;
  return jsonb_build_object('ok', true, 'stage', case when jsonb_array_length(v_links) > 0 then 'link' else 'none' end,
    'requested', p_amount, 'discount_before', s.discount, 'discount_after', v_after, 'tuition_after', v_tuition, 'balance_after', v_balance,
    'standing', null, 'links', v_links, 'track', v_track, 'lines', to_jsonb(v_lines));
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_renew_enrollment_link(p_student uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    raise exception 'קישור הרשמה חדש — רק לתלמידה שממתינה לחיוב הראשון בכרטיס: ממתינה (לא במזומן), או פעילה במסלול הוראת קבע שעוד לא שילמה כלום';
  end if;
  -- ★ 0059: הסכומים לפי שכר הלימוד אחרי ההנחה — לא לפי מה שנשמר במסלול בהרשמה (הנחה שניתנה בלי
  --   קישור פתוח לא עדכנה את המסלול: אושרת ראובן ומנוחי ביר, 16/11).
  --   רק כשהסכומים באמת שונים (אחרת המסלול נשאר כמו שהוא, מילה במילה).
  if s.payment_track ->> 'method' in ('standing_order', 'card_once')
     and ((f_track_with_tuition(s.payment_track, s.tuition_total - s.discount, s.registration_fee) ->> 'first_charge')::numeric
            is distinct from (s.payment_track ->> 'first_charge')::numeric
          or (f_track_with_tuition(s.payment_track, s.tuition_total - s.discount, s.registration_fee) ->> 'installment_amount')::numeric
            is distinct from (s.payment_track ->> 'installment_amount')::numeric) then
    s.payment_track := f_track_with_tuition(s.payment_track, s.tuition_total - s.discount, s.registration_fee);
    update students set payment_track = s.payment_track where id = s.id;
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
end $function$;
