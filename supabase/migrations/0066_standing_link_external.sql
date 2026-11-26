-- 0066 — חיבור הוראת קבע שנפתחה ידנית ב-SUMIT לתלמידה, ועריכת הערות בכרטיס.
--
-- המקרה (26/11): הורה לא רצה למלא את טופס ההרשמה; הבעלים פתחה לו ידנית ב-SUMIT הוראת קבע של
-- 10 × 210. המערכת לא ידעה עליה — לא רשמה את החיובים ולא התריעה כשחיוב נכשל.
--
-- ★ החיבור (מהכרטיס, בעלים): מספר הלקוח ב-SUMIT → רשימת ההוראות שלו (standing-order-link) → בוחרים
--   הוראה ומזינים כמה תשלומים יש בה בסך הכל. כמה נותרו — לפי SUMIT (מהחיוב הבא עד האחרון).
--   מכאן ההוראה מנוהלת כמו כל הוראה: הסנכרון רושם כל חיוב שעבר כתשלום, חיוב שנכשל — התראה וטיפול.
--   חיובים שכבר עברו לפני החיבור — לא נרשמים (last_billing = החיוב האחרון ב-SUMIT).
-- ★ המיפוי: אצלנו "חיוב X מתוך N" כולל את החיוב הראשון שהיה בקישור ההרשמה, מחוץ להוראה
--   (installments = N − 1; charged_total = charged_count + 1). בהוראה שנפתחה ב-SUMIT כל N החיובים
--   בתוכה — ולכן: installments = N − 1, ו-charged_count = (מה שבוצע) − 1. החיוב הראשון ב-SUMIT ממלא את
--   תפקיד "החיוב הראשון". כך כל החישובים הקיימים (נותרו, חיוב X מתוך N, הסתיימה) נכונים בלי שינוי.

alter table standing_orders alter column payment_link_id drop not null;
alter table standing_orders add column if not exists source text not null default 'link';
alter table standing_orders drop constraint if exists standing_orders_source_check;
alter table standing_orders add constraint standing_orders_source_check check (
  (source = 'link' and payment_link_id is not null) or (source = 'sumit_import' and payment_link_id is null));
create unique index if not exists standing_orders_sumit_recurring_uq on standing_orders (sumit_customer_id, sumit_recurring_id)
  where sumit_recurring_id is not null and status not in ('cancelled', 'completed');

alter table standing_order_events drop constraint if exists standing_order_events_kind_check;
alter table standing_order_events add constraint standing_order_events_kind_check
  check (kind in ('reschedule', 'sumit_change', 'amount_change', 'retry_charge', 'retry_declined', 'renewed', 'retry_refused',
                  'paid_elsewhere', 'card_link', 'card_replaced', 'linked'));

-- ─── שלב 1 (בהרשאות המשתמשת): בעלים, תלמידה קיימת בלי הוראה חיה. מחזיר הוראות שכבר מחוברות ───
create or replace function rpc_standing_link_request(p_student uuid, p_customer bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s students%rowtype;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לחבר הוראת קבע מ-SUMIT' using errcode = '42501'; end if;
  select * into s from students where id = p_student;
  if s.id is null or s.deleted_at is not null then raise exception 'התלמידה לא נמצאה'; end if;
  if p_customer is null or p_customer <= 0 then raise exception 'מספר הלקוח ב-SUMIT: מספר חיובי'; end if;
  if exists (select 1 from standing_orders o where o.student_id = s.id and o.status not in ('cancelled', 'completed')) then
    raise exception 'לתלמידה כבר יש הוראת קבע פעילה במערכת';
  end if;
  return jsonb_build_object('ok', true, 'linked', coalesce((select jsonb_agg(o.sumit_recurring_id) from standing_orders o
           where o.sumit_customer_id = p_customer and o.sumit_recurring_id is not null and o.status not in ('cancelled', 'completed')), '[]'::jsonb));
end $$;
revoke all on function rpc_standing_link_request(uuid, bigint) from public, anon;
grant execute on function rpc_standing_link_request(uuid, bigint) to authenticated;

-- ─── שלב 2 (מהפונקציה, אחרי שההוראה נמצאה ב-SUMIT): יצירת ההוראה אצלנו ───
create or replace function rpc_standing_link_external(p_student uuid, p_customer bigint, p_recurring bigint, p_amount numeric, p_total int,
                                                      p_sumit_status int, p_next date, p_prev date, p_final date, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_status text := coalesce(f_standing_status(p_sumit_status), 'active'); v_left int; v_done int; v_id uuid;
begin
  select * into s from students where id = p_student for update;
  if s.id is null or s.deleted_at is not null then raise exception 'התלמידה לא נמצאה'; end if;
  if exists (select 1 from standing_orders o where o.student_id = s.id and o.status not in ('cancelled', 'completed')) then
    raise exception 'לתלמידה כבר יש הוראת קבע פעילה במערכת';
  end if;
  if exists (select 1 from standing_orders o where o.sumit_customer_id = p_customer and o.sumit_recurring_id = p_recurring
               and o.status not in ('cancelled', 'completed')) then
    raise exception 'ההוראה הזו כבר מחוברת לתלמידה אחרת';
  end if;
  if v_status in ('cancelled', 'completed') then raise exception 'ההוראה ב-SUMIT % — אין מה לחבר', f_sumit_recurring_label(p_sumit_status); end if;
  if p_amount is null or p_amount <= 0 then raise exception 'ב-SUMIT אין סכום להוראה'; end if;
  if p_total is null or p_total < 2 or p_total > 36 then raise exception 'מספר התשלומים בהוראה: בין 2 ל-36'; end if;
  if p_next is null or p_final is null then raise exception 'SUMIT לא החזירה את החיוב הבא / האחרון — אי אפשר לדעת כמה נותרו'; end if;
  v_left := f_months_between(p_next, p_final) + 1;
  if v_left < 1 or v_left > p_total then
    raise exception 'לפי SUMIT נותרו % חיובים — יותר ממספר התשלומים שהוזן (%)', v_left, p_total;
  end if;
  v_done := p_total - v_left;

  insert into standing_orders (student_id, branch_id, payment_link_id, source, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, status, sumit_status, next_billing, last_billing, charged_count,
                               consent_text, consented_at, billing_day, last_checked_at)
  values (s.id, s.branch_id, null, 'sumit_import', p_customer, p_recurring, p_amount, p_total - 1, p_total,
          coalesce(p_prev, p_next), v_status, p_sumit_status, p_next, p_prev, v_done - 1,
          format('הוראה שנפתחה ידנית ב-SUMIT (לקוח %s, הוראה %s) וחוברה למערכת', p_customer, p_recurring), now(),
          least(extract(day from p_next)::int, 28), now())
  returning id into v_id;
  insert into standing_order_events (standing_order_id, kind, to_date, to_amount, remaining, actor, note)
  values (v_id, 'linked', p_next, p_amount, v_left, p_by,
          format('חוברה מ-SUMIT: %s מתוך %s כבר בוצעו, נותרו %s', v_done, p_total, v_left));
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values (coalesce('user:' || p_by::text, 'system'), 'standing_link_external', 'standing_orders', v_id,
          jsonb_build_object('student', s.id, 'customer', p_customer, 'recurring', p_recurring, 'amount', p_amount,
                             'total', p_total, 'done', v_done, 'left', v_left), 'ui');
  return jsonb_build_object('ok', true, 'id', v_id, 'done', v_done, 'total', p_total, 'left', v_left, 'next', p_next, 'status', v_status);
end $$;
revoke all on function rpc_standing_link_external(uuid, bigint, bigint, numeric, int, int, date, date, date, uuid) from public, anon, authenticated;
grant execute on function rpc_standing_link_external(uuid, bigint, bigint, numeric, int, int, date, date, date, uuid) to service_role;

-- ─── הערות בכרטיס: הבעלים, ומנהלת סניף לתלמידות הסניף שלה (כמו עריכת שם) ───
create or replace function rpc_student_set_notes(p_id uuid, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_role user_role := auth_role(); v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into s from students where id = p_id for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if not coalesce(v_role = 'owner' or (v_role = 'branch_manager' and s.branch_id in (select my_branches())), false) then
    raise exception 'אין הרשאה לערוך הערות לתלמידה' using errcode = '42501';
  end if;
  if s.deleted_at is not null then raise exception 'התלמידה נמחקה'; end if;
  if length(v_notes) > 2000 then raise exception 'ההערות ארוכות מדי (עד 2,000 תווים)'; end if;
  if v_notes is not distinct from s.notes then return jsonb_build_object('ok', true, 'changed', false); end if;
  update students set notes = v_notes where id = s.id;
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values ('user:' || auth.uid()::text, 'student_notes', 'students', s.id, jsonb_build_object('notes', s.notes), jsonb_build_object('notes', v_notes), 'ui');
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function rpc_student_set_notes(uuid, text) from public, anon;
grant execute on function rpc_student_set_notes(uuid, text) to authenticated;
