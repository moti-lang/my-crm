-- 0038 — מסך "פקודות וואטסאפ": מספרים מורשים, יומן, ביטול מהמסך וצ'אט בדיקה.
--
-- המנוע עצמו (0012: פקודה ממתינה, ביצוע אטומי, ביטול) לא משתנה. כאן מה שהמסך צריך:
--   · מספר מורשה נשמר בדיוק כפי שה-webhook מזהה את השולחת (972XXXXXXXXX). מספר שנשמר
--     כ-050… לא היה מזוהה אף פעם, והפקודות שלו היו עוברות בשקט למסלול הלקוחות.
--   · רמת הרשאה חוקית בלבד, וסניף חובה למספר של סניף.
--   · מאיפה הגיעה פקודה: וואטסאפ או צ'אט הבדיקה.
--   · ביטול מהמסך — הבעלים בלבד, דרך אותו rpc_cancel_command של "בטל" בוואטסאפ.

alter table commands add column if not exists channel text not null default 'whatsapp';
alter table commands drop constraint if exists commands_channel_check;
alter table commands add constraint commands_channel_check check (channel in ('whatsapp', 'test'));

-- כמו normalizePhone ב-_shared/phone.ts.
create or replace function f_normalize_phone(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when d like '972%' then d when d like '0%' then '972' || substr(d, 2) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
revoke all on function f_normalize_phone(text) from public, anon;
-- הטריגר רץ בהרשאות מי שמוסיפה את המספר (הבעלים מהמסך), ולכן היא צריכה להריץ את הנרמול.
grant execute on function f_normalize_phone(text) to authenticated, service_role;

create or replace function f_authorized_number_normalize() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.phone := f_normalize_phone(new.phone);
  new.label := btrim(coalesce(new.label, ''));
  -- סניף שייך רק לרמת "סניף". ברמה אחרת הוא היה מטעה (ההרשאה לא נבדקת לפיו).
  if new.scope <> 'branch' then new.branch_id := null; end if;
  return new;
end $$;
revoke all on function f_authorized_number_normalize() from public, anon;

drop trigger if exists authorized_numbers_normalize on authorized_numbers;
create trigger authorized_numbers_normalize before insert or update on authorized_numbers
  for each row execute function f_authorized_number_normalize();

alter table authorized_numbers drop constraint if exists authorized_numbers_phone_format;
alter table authorized_numbers add constraint authorized_numbers_phone_format check (phone ~ '^[1-9][0-9]{8,14}$');
alter table authorized_numbers drop constraint if exists authorized_numbers_scope_check;
alter table authorized_numbers add constraint authorized_numbers_scope_check check (scope in ('all', 'finance', 'branch'));
alter table authorized_numbers drop constraint if exists authorized_numbers_branch_check;
alter table authorized_numbers add constraint authorized_numbers_branch_check check (scope <> 'branch' or branch_id is not null);
alter table authorized_numbers drop constraint if exists authorized_numbers_label_check;
alter table authorized_numbers add constraint authorized_numbers_label_check check (label <> '');

/**
 * ביטול פעולה מהמסך (24 השעות האחרונות). אותו היפוך בדיוק כמו "בטל" בוואטסאפ —
 * rpc_cancel_command, עם התפיסה האטומית שלו — ובנוסף נרשם מי ביטל מהמסך.
 */
create or replace function rpc_owner_cancel_command(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if auth_role() is distinct from 'owner' then
    raise exception 'רק הבעלים יכולה לבטל פקודות' using errcode = '42501';
  end if;
  r := rpc_cancel_command(p_command_id);
  if coalesce((r ->> 'ok')::boolean, false) then
    insert into audit_log (actor, action, table_name, row_id, after, source)
    values ('user:' || coalesce(auth.uid()::text, '?'), 'cancel_command', 'commands', p_command_id, r, 'ui');
  end if;
  return r;
end $$;
revoke all on function rpc_owner_cancel_command(uuid) from public, anon;
grant execute on function rpc_owner_cancel_command(uuid) to authenticated;
