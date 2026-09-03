-- חור: auth_role מחזירה תפקיד גם לפרופיל מושבת. השבתה והסרה לא סוגרות כלום.
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from profiles where id = auth.uid()
$$;
