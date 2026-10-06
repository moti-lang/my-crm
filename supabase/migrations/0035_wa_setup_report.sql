-- 0035 — שרת הוואטסאפ מדווח על התקדמות ההתקנה ועל שגיאות.
-- בלי זה, התקנה שנתקעה דורשת כניסה לקונסולה של השרת. עכשיו השרת שולח את סוף
-- הלוג ל-wa-provision (עם אותו טוקן הקמה, בלי לנצל אותו), ורואים אותו מכאן.
alter table wa_config add column if not exists setup_log text, add column if not exists setup_log_at timestamptz;

create or replace function rpc_wa_setup_report(p_token text, p_log text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c wa_config%rowtype;
begin
  select * into c from wa_config where id = 1 for update;
  if c.provision_token_hash is null or c.provision_expires_at < now()
     or c.provision_token_hash <> encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'error', 'טוקן הקמה לא תקף');
  end if;
  update wa_config set setup_log = right(coalesce(p_log, ''), 8000), setup_log_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function rpc_wa_setup_report(text, text) from public, anon, authenticated;
grant execute on function rpc_wa_setup_report(text, text) to service_role;
