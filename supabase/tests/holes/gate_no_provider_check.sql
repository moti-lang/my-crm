-- חור: השער בודק רשימה אבל לא ספק. חשבון בסיסמה למורשה עובר.
create or replace function f_auth_user_gate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(new.email, ''))); v_allowed allowed_users;
begin
  select * into v_allowed from allowed_users where email = v_email and is_active;
  if v_allowed.id is null then raise exception 'ALLOWLIST: % אינו ברשימה', v_email; end if;
  insert into profiles (id, email, full_name, role, is_active)
  values (new.id, v_email, coalesce(nullif(v_allowed.full_name,''), v_email), v_allowed.role, true);
  update allowed_users set user_id = new.id, joined_at = now() where id = v_allowed.id returning * into v_allowed;
  perform f_allowlist_apply(v_allowed);
  return new;
end $$;
