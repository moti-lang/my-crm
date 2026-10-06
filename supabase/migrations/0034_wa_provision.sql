-- 0034 — חיבור שרת הוואטסאפ בלי העתקת סודות ידנית.
--
-- השרת החדש מוקם מ-cloud-config אחד. בסוף ההתקנה הוא "מתקשר הביתה" ל-wa-provision
-- עם טוקן חד-פעמי, ומוסר את הכתובת שלו, מפתח ה-API וסוד ה-webhook. הם נשמרים כאן
-- (לא ב-env), ו-_shared/wa.ts קורא מכאן כשאין משתני סביבה.
-- ★ הטבלה סגורה לכל תפקיד חוץ מ-service_role: אין policy, ואין grant ל-anon/authenticated.
-- ★ הטוקן נשמר כ-hash בלבד, תקף עד שעת תפוגה, ונמחק בשימוש הראשון.

create table if not exists wa_config (
  id                   int primary key default 1 check (id = 1),
  server_url           text check (server_url is null or server_url ~ '^https://[a-z0-9.-]+$'),
  api_key              text,
  webhook_secret       text,
  provisioned_at       timestamptz,
  provision_token_hash text,
  provision_expires_at timestamptz
);
alter table wa_config enable row level security;
revoke all on wa_config from anon, authenticated, public;
insert into wa_config (id) values (1) on conflict do nothing;

/** טוקן הקמה חדש (הבעלים / סקריפט ההקמה). מחזיר את הטוקן פעם אחת; נשמר רק ה-hash. */
create or replace function rpc_wa_issue_provision_token(p_hours int default 72) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  -- ★ ב-security definer, current_user הוא תמיד בעל הפונקציה — לא בודקים לפיו.
  --   קריאה דרך ה-API (יש JWT): רק הבעלים. חיבור ישיר למסד (אין JWT): רק מנהל המסד.
  if nullif(current_setting('request.jwt.claims', true), '') is not null and auth_role() is distinct from 'owner' then
    raise exception 'רק הבעלים' using errcode = '42501';
  end if;
  update wa_config set provision_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
         provision_expires_at = now() + make_interval(hours => greatest(1, least(p_hours, 168)))
   where id = 1;
  return v_token;
end $$;
revoke all on function rpc_wa_issue_provision_token(int) from public, anon;
grant execute on function rpc_wa_issue_provision_token(int) to authenticated, service_role;

/** השרת מוסר את פרטיו. טוקן חד-פעמי; אחרי שימוש — אין אפשרות לדרוס בלי טוקן חדש. */
create or replace function rpc_wa_provision(p_token text, p_url text, p_api_key text, p_webhook_secret text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c wa_config%rowtype;
begin
  select * into c from wa_config where id = 1 for update;
  if c.provision_token_hash is null or c.provision_expires_at < now()
     or c.provision_token_hash <> encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'error', 'טוקן הקמה לא תקף');
  end if;
  if p_url !~ '^https://[a-z0-9.-]+$' or length(coalesce(p_api_key, '')) < 32 or length(coalesce(p_webhook_secret, '')) < 32 then
    return jsonb_build_object('ok', false, 'error', 'פרטים לא תקינים');
  end if;
  update wa_config set server_url = p_url, api_key = p_api_key, webhook_secret = p_webhook_secret,
         provisioned_at = now(), provision_token_hash = null, provision_expires_at = null
   where id = 1;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('wa-provision', 'provision', 'wa_config', null, jsonb_build_object('server_url', p_url));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function rpc_wa_provision(text, text, text, text) from public, anon, authenticated;
grant execute on function rpc_wa_provision(text, text, text, text) to service_role;
