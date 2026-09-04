-- 0017_backup_dump.sql — גיבוי מצד המסד, בקריאה אחת.
--
-- מחזיר את אותו פורמט של scripts/backup.mjs (teichtal-backup/1): manifest
-- + data, כל public ו-auth.users/identities, דרך row_to_json — חותמות זמן
-- במיקרו-שניות. משמש את cron-backup (הגיבוי היומי במייל) ואת הבדיקה
-- שמוודאת שקובץ שנשמר באמת ניתן לשחזור.
--
-- service_role בלבד. הפלט מכיל טלפונים, כתובות וכספים.
create or replace function rpc_backup_dump() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t record; v_data jsonb := '{}'::jsonb; v_counts jsonb := '{}'::jsonb;
  v_rows jsonb; v_n int; v_mig text;
begin
  for t in
    select 'public' as s, tablename as n from pg_tables where schemaname = 'public'
    union all
    select 'auth', relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'auth' and c.relkind = 'r' and relname in ('users', 'identities')
    order by 1, 2
  loop
    execute format('select coalesce(jsonb_agg(row_to_json(x)), ''[]''::jsonb), count(*) from %I.%I x', t.s, t.n)
      into v_rows, v_n;
    v_data := v_data || jsonb_build_object(t.s || '.' || t.n, v_rows);
    v_counts := v_counts || jsonb_build_object(t.s || '.' || t.n, v_n);
  end loop;
  begin
    select string_agg(version, ',' order by version) into v_mig from supabase_migrations.schema_migrations;
  exception when undefined_table then v_mig := null;
  end;
  return jsonb_build_object(
    'manifest', jsonb_build_object(
      'format', 'teichtal-backup/1', 'taken_at', now(), 'source', 'rpc_backup_dump',
      'migrations', v_mig, 'counts', v_counts),
    'data', v_data);
end $$;
revoke all on function rpc_backup_dump() from public, anon, authenticated;
grant execute on function rpc_backup_dump() to service_role;
