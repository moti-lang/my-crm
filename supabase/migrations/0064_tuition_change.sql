-- 0064 — שינוי מחיר ידני לתלמידה (הבעלים): הסכום השנתי, כולל דמי הרישום.
--
-- המקרה (23/11): תלמידה הועברה מסניף לסניף ("נרשמה בטעות") — המחיר בסניף החדש 3,000 במקום 1,200.
-- לא הייתה דרך לשנות מחיר (רק הנחה, שרק מורידה).
--
-- ★ מה משתנה: שכר הלימוד (tuition_total) = הסכום השנתי פחות דמי הרישום. החוב בגבייה מתעדכן מעצמו
--   (due = שכר לימוד − הנחה + דמי רישום). ההנחה ודמי הרישום — כמו שהם.
-- ★ הוראת קבע: לא נוגעים. ההורה אישרה את הסכומים שבה — אסור לחייב יותר בלי אישור חדש שלה.
--   ההוראה ממשיכה; מה שמעבר לה — חוב בגבייה (קישור תשלום / מזומן). הורדת מחיר מתחת למה שההוראה
--   עוד תגבה — לא כאן (היא הייתה גובה יותר מהמחיר): דרך הנחה, שמעדכנת גם את ההוראה ב-SUMIT.
-- ★ עוד לא שולם כלום, במסלול כרטיס / הוראת קבע: סכומי המסלול מחושבים מחדש (אותו כלל כמו בהרשמה),
--   כך ש"קישור הרשמה חדש" ייבנה מהמחיר החדש.
-- ★ קישור תשלום פתוח — מתבטל (הסכום בו ישן). אפשר ליצור חדש.
-- ★ יומן: כל שינוי מחיר — מכל מסלול — בטריגר: מי, מתי, מכמה לכמה, ולמה. בכרטיס: "שינויי מחיר".

create or replace function f_student_tuition_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'tuition_change', 'students', new.id,
          jsonb_build_object('tuition_total', old.tuition_total, 'total', old.tuition_total + old.registration_fee),
          jsonb_build_object('tuition_total', new.tuition_total, 'total', new.tuition_total + new.registration_fee,
                             'reason', nullif(current_setting('app.tuition_reason', true), ''),
                             'by_name', (select full_name from profiles where id = auth.uid())),
          case when auth.uid() is null then 'system' else 'ui' end);
  return new;
end $$;
revoke all on function f_student_tuition_audit() from public, anon, authenticated;
drop trigger if exists students_tuition_audit on students;
create trigger students_tuition_audit after update of tuition_total on students
  for each row when (old.tuition_total is distinct from new.tuition_total) execute function f_student_tuition_audit();

-- ─── התוכנית: מה המחיר החדש ישנה (בלי לשנות כלום) ───
create or replace function f_tuition_plan(p_student uuid, p_total numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s students%rowtype; o standing_orders%rowtype; v_tuition numeric; v_paid numeric; v_before numeric; v_after numeric;
        v_order_left numeric := 0; v_beyond numeric; v_track jsonb := null; v_links int; v_lines text[] := '{}';
begin
  select * into s from students where id = p_student;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'התלמידה לא נמצאה'); end if;
  if s.deleted_at is not null then return jsonb_build_object('ok', false, 'error', 'התלמידה נמחקה'); end if;
  if p_total is null or p_total <> trunc(p_total) or p_total < 0 then
    return jsonb_build_object('ok', false, 'error', 'הסכום השנתי: בשקלים שלמים');
  end if;
  if p_total = s.tuition_total + s.registration_fee then return jsonb_build_object('ok', false, 'error', 'זה כבר המחיר של התלמידה'); end if;
  if p_total < s.registration_fee then
    return jsonb_build_object('ok', false, 'error', format('הסכום השנתי כולל את דמי הרישום (%s ₪) — לא יכול להיות נמוך מהם', to_char(s.registration_fee, 'FM999,990')));
  end if;
  v_tuition := p_total - s.registration_fee;
  if s.discount > v_tuition then
    return jsonb_build_object('ok', false, 'error', format('לתלמידה יש הנחה של %s ₪ — גדולה משכר הלימוד החדש. להקטין קודם את ההנחה.', to_char(s.discount, 'FM999,990')));
  end if;
  select coalesce(sum(amount), 0) into v_paid from payments where student_id = s.id and deleted_at is null;
  v_before := s.tuition_total - s.discount + s.registration_fee - v_paid;
  v_after := v_tuition - s.discount + s.registration_fee - v_paid;
  v_lines := v_lines || format('המחיר השנתי: %s ₪ במקום %s ₪ (כולל %s ₪ דמי רישום%s).', to_char(p_total, 'FM999,990'),
                               to_char(s.tuition_total + s.registration_fee, 'FM999,990'), to_char(s.registration_fee, 'FM999,990'),
                               case when s.discount > 0 then format(', לפני הנחה של %s ₪', to_char(s.discount, 'FM999,990')) else '' end);
  v_lines := v_lines || format('שולם עד היום: %s ₪. %s', to_char(v_paid, 'FM999,990'),
                               case when v_after > 0 then format('נשאר לשלם: %s ₪.', to_char(v_after, 'FM999,990'))
                                    when v_after < 0 then format('שולם יותר מהמחיר — יתרת זכות של %s ₪ (להחזר ידני ב-SUMIT).', to_char(-v_after, 'FM999,990'))
                                    else 'הכל שולם.' end);

  -- ─── הוראת קבע: ממשיכה כמו שאושרה ───
  select * into o from standing_orders where student_id = s.id and status in ('active', 'retrying', 'failed')
   order by created_at desc limit 1;
  if o.id is not null then
    v_order_left := greatest(o.installments - o.charged_count, 0) * o.amount;
    if v_after < v_order_left then
      return jsonb_build_object('ok', false, 'error', format(
        'בהוראת הקבע נשארו עוד %s ₪ (%s × %s ₪) — יותר ממה שנשאר לשלם במחיר החדש (%s ₪). להוריד מחיר כשיש הוראת קבע — דרך "הנחה", שמעדכנת גם את ההוראה ב-SUMIT.',
        to_char(v_order_left, 'FM999,990'), o.installments - o.charged_count, to_char(o.amount, 'FM999,990'), to_char(greatest(v_after, 0), 'FM999,990')));
    end if;
    v_beyond := v_after - v_order_left;
    v_lines := v_lines || format('הוראת הקבע ממשיכה כמו שההורה אישרה: %s × %s ₪ (%s ₪).', o.installments - o.charged_count,
                                 to_char(o.amount, 'FM999,990'), to_char(v_order_left, 'FM999,990'));
    if v_beyond > 0 then
      v_lines := v_lines || format('ההפרש — %s ₪ — יופיע כחוב בגבייה. לגבות בקישור תשלום (או במזומן). אסור להגדיל את ההוראה בלי אישור חדש של ההורה.',
                                   to_char(v_beyond, 'FM999,990'));
    end if;
  elsif s.payment_track ->> 'method' = 'standing_order'
        and exists (select 1 from payment_links pl where pl.student_id = s.id and pl.purpose = 'enrollment' and pl.status in ('paid', 'mismatch'))
        and not exists (select 1 from standing_orders x where x.student_id = s.id) then
    return jsonb_build_object('ok', false, 'error', 'החיוב הראשון שולם והוראת הקבע עוד נוצרת ב-SUMIT (תוך כמה שעות). לשנות מחיר אחרי שתיווצר.');
  elsif v_paid = 0 and s.payment_track ->> 'method' in ('standing_order', 'card_once') then
    -- ★ עוד לא שולם כלום: המסלול מחושב מחדש — "קישור הרשמה חדש" ייבנה מהמחיר החדש.
    v_track := f_track_with_tuition(s.payment_track, v_tuition - s.discount, s.registration_fee);
    v_lines := v_lines || case when s.payment_track ->> 'method' = 'standing_order' and (v_track ->> 'installments')::int > 1
      then format('המסלול: תשלום ראשון של %s ₪, ואחריו %s × %s ₪ בהוראת קבע.', to_char((v_track ->> 'first_charge')::numeric, 'FM999,990'),
                  (v_track ->> 'installments')::int - 1, to_char((v_track ->> 'installment_amount')::numeric, 'FM999,990'))
      else format('המסלול: תשלום של %s ₪ בכרטיס.', to_char((v_track ->> 'first_charge')::numeric, 'FM999,990')) end;
  end if;

  select count(*) into v_links from payment_links where student_id = s.id and status in ('pending', 'opened');
  if v_links > 0 then
    v_lines := v_lines || case when v_track is not null then 'הקישור הפתוח (בסכום הישן) יבוטל — לשלוח "קישור הרשמה חדש".'
                               else 'הקישור הפתוח (בסכום הישן) יבוטל — אפשר ליצור קישור חדש.' end;
  end if;
  return jsonb_build_object('ok', true, 'total_before', s.tuition_total + s.registration_fee, 'total_after', p_total, 'tuition_after', v_tuition,
                            'balance_before', v_before, 'balance_after', v_after, 'track', v_track, 'links', v_links, 'lines', to_jsonb(v_lines));
end $$;
revoke all on function f_tuition_plan(uuid, numeric) from public, anon, authenticated;

create or replace function rpc_tuition_preview(p_student uuid, p_total numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner' then return jsonb_build_object('ok', false, 'error', 'רק הבעלים יכולה לשנות מחיר'); end if;
  return f_tuition_plan(p_student, p_total);
end $$;
revoke all on function rpc_tuition_preview(uuid, numeric) from public, anon;
grant execute on function rpc_tuition_preview(uuid, numeric) to authenticated;

-- ★ p_expected: היתרה שהבעלים ראתה בתוכנית. השתנה משהו בינתיים (תשלום נקלט) — לא נשמר.
create or replace function rpc_change_tuition(p_student uuid, p_total numeric, p_reason text, p_expected numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_plan jsonb; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_links int;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לשנות מחיר' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'יש לכתוב למה המחיר משתנה'; end if;
  select * into s from students where id = p_student for update;
  v_plan := f_tuition_plan(p_student, p_total);
  if not (v_plan ->> 'ok')::boolean then raise exception '%', v_plan ->> 'error'; end if;
  if (v_plan ->> 'balance_after')::numeric is distinct from p_expected then
    raise exception 'המצב השתנה מאז החישוב (למשל נקלט תשלום) — לבדוק שוב את התוכנית';
  end if;

  perform set_config('app.tuition_reason', v_reason, true);
  update students set tuition_total = (v_plan ->> 'tuition_after')::numeric,
         -- ★ 'track' הוא null של JSON כשהמסלול לא מחושב מחדש — לא null של SQL (coalesce לא היה עוזר).
         payment_track = case when jsonb_typeof(v_plan -> 'track') = 'object' then v_plan -> 'track' else payment_track end
   where id = s.id;
  with c as (update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened') returning 1)
  select count(*) into v_links from c;
  update reminders set status = 'cancelled', error = 'המחיר השתנה — הקישור בוטל'
   where student_id = s.id and status = 'scheduled' and kind = 'payment_link';
  perform set_config('app.tuition_reason', '', true);
  return v_plan || jsonb_build_object('links_cancelled', v_links);
end $$;
revoke all on function rpc_change_tuition(uuid, numeric, text, numeric) from public, anon;
grant execute on function rpc_change_tuition(uuid, numeric, text, numeric) to authenticated;

-- ─── היסטוריית המחיר (בכרטיס) ───
create or replace function rpc_student_tuition_history(p_student uuid)
returns table (changed_at timestamptz, changed_by text, from_total numeric, to_total numeric, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.created_at,
         case when a.actor = 'system' then 'המערכת' else coalesce(a.after ->> 'by_name', 'משתמשת לא מזוהה') end,
         (a.before ->> 'total')::numeric, (a.after ->> 'total')::numeric, a.after ->> 'reason'
  from audit_log a
  where a.action = 'tuition_change' and a.row_id = p_student
    and exists (select 1 from students s where s.id = p_student
                  and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches()))))
  order by a.created_at desc
$$;
revoke all on function rpc_student_tuition_history(uuid) from public, anon;
grant execute on function rpc_student_tuition_history(uuid) to authenticated;
