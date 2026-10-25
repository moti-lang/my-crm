-- 0039 — ייצוא תלמידות לאקסל (מסך התלמידות ומסך הסניף).
--
-- מקור אחד לכל הייצוא, וההרשאה בו — לא במסך:
--   · בעלים: כל הסניפים, כל הפרטים.
--   · מנהלת סניף: רק הסניפים שלה.
--   · רואת חשבון: כל הסניפים, בלי טלפונים, כתובת ומייל (הערכים לא יוצאים מהמסד בכלל).
--     זה גם מה שמציג לה את מסך התלמידות: עד עכשיו המסך היה ריק לגמרי — v_student_overview
--     רץ בהרשאות הקוראת, ולרואת חשבון אין הרשאה על students (בכוונה, בגלל הטלפונים).
--   · כל תפקיד אחר / אנונימי: כלום.
-- השורות בצורת v_student_overview (כדי שהמסך יוכל להציג אותן) ועוד שדות הייצוא.

create or replace function rpc_students_export(p_branch uuid default null) returns setof jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role user_role := auth_role();
begin
  if v_role is null or v_role not in ('owner', 'branch_manager', 'accountant') then return; end if;
  return query
  -- ★ סוגריים: בלעדיהם "-" נקשר חזק מ-"||" והטלפון נמחק רק מהשדות הנוספים, לא מהשורה.
  select (to_jsonb(o)
         || jsonb_build_object(
              'birth_date', s.birth_date,
              'age', case when s.birth_date is not null then extract(year from age(current_date, s.birth_date))::int end,
              'alt_phone', s.alt_phone,
              'address', s.address,
              'whatsapp_opt_in', s.whatsapp_opt_in,
              'external_payment', s.external_payment,
              'payment_track_label', coalesce(nullif(btrim(s.payment_track ->> 'label'), ''),
                case s.payment_track ->> 'method' when 'cash' then 'מזומן' when 'card_once' then 'אשראי — תשלום אחד'
                                                   when 'standing_order' then 'הוראת קבע' end),
              'payments_count', (select count(*) from payments p where p.student_id = s.id and p.deleted_at is null),
              'installments_planned', coalesce(s.installments_total, s.installments),
              'contact_hidden', v_role = 'accountant'))
         -- רואת חשבון: בלי טלפונים, כתובת ומייל.
         - case when v_role = 'accountant' then array['parent_phone', 'alt_phone', 'address', 'email'] else array[]::text[] end
  from v_student_overview o
  join students s on s.id = o.id
  where (p_branch is null or o.branch_id = p_branch)
    and (v_role <> 'branch_manager' or o.branch_id in (select my_branches()))
  order by o.full_name;
end $$;
revoke all on function rpc_students_export(uuid) from public, anon;
grant execute on function rpc_students_export(uuid) to authenticated;
