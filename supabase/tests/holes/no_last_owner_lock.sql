-- חור: אין נעילה על הבעלים האחרונה. אפשר להשבית את כולן ולהינעל בחוץ.
create or replace function f_allowlist_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing uuid;
begin
  new.email := lower(btrim(new.email));
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.user_id is not null and new.email <> old.email then
    raise exception 'ALLOWLIST: אי אפשר לשנות אימייל';
  end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id and new.user_id is not null then
    new.user_id := old.user_id;
  end if;
  if new.user_id is null then
    select id into v_existing from profiles where email = new.email;
    if v_existing is not null then new.user_id := v_existing; new.joined_at := coalesce(new.joined_at, now()); end if;
  end if;
  return new;
end $$;
