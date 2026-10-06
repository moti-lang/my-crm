-- 21_wa_provision.sql — טוקן הקמה של שרת הוואטסאפ: חד-פעמי, בתוקף, נשמר כ-hash,
-- והטבלה עם המפתח סגורה לכל מי שאינו service_role.
\set ON_ERROR_STOP on
\ir _assert.sql

\echo 'הקמת שרת וואטסאפ:'
begin;
select rpc_wa_issue_provision_token(24) as tok \gset
select assert_true(length(:'tok') = 64, 'טוקן של 64 תווי hex');
select assert_true((select provision_token_hash <> :'tok' and length(provision_token_hash) = 64 from wa_config), '★ נשמר רק ה-hash, לא הטוקן');

select assert_true((rpc_wa_provision(repeat('0', 64), 'https://wa-1-2-3-4.sslip.io', repeat('k', 64), repeat('s', 64)) ->> 'ok')::boolean is false, '★ טוקן שגוי — נדחה');
select assert_true((select server_url is null from wa_config), 'ולא נשמר כלום');
select assert_true((rpc_wa_provision(:'tok', 'http://wa.example', repeat('k', 64), repeat('s', 64)) ->> 'ok')::boolean is false, 'כתובת שאינה https — נדחית');
select assert_true((rpc_wa_provision(:'tok', 'https://wa-1-2-3-4.sslip.io', 'short', repeat('s', 64)) ->> 'ok')::boolean is false, 'מפתח קצר — נדחה');

select assert_true((rpc_wa_provision(:'tok', 'https://wa-1-2-3-4.sslip.io', repeat('k', 64), repeat('s', 64)) ->> 'ok')::boolean, '★ טוקן נכון — הפרטים נשמרו');
select assert_true((select server_url = 'https://wa-1-2-3-4.sslip.io' and provisioned_at is not null and provision_token_hash is null from wa_config), 'הכתובת נשמרה, והטוקן נמחק');
select assert_true((rpc_wa_provision(:'tok', 'https://evil.example', repeat('e', 64), repeat('e', 64)) ->> 'ok')::boolean is false, '★ אותו טוקן פעם שנייה — נדחה (חד-פעמי)');
select assert_true((select server_url = 'https://wa-1-2-3-4.sslip.io' from wa_config), 'והכתובת לא נדרסה');

-- תפוגה
select rpc_wa_issue_provision_token(1) as tok2 \gset
update wa_config set provision_expires_at = now() - interval '1 minute';
select assert_true((rpc_wa_provision(:'tok2', 'https://wa-5-6-7-8.sslip.io', repeat('k', 64), repeat('s', 64)) ->> 'ok')::boolean is false, '★ טוקן שפג — נדחה');

-- הרשאות
select assert_no_execute('anon', 'rpc_wa_provision(text, text, text, text)');
select assert_no_execute('authenticated', 'rpc_wa_provision(text, text, text, text)');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_no_effect('★ גם הבעלים לא קוראת את מפתח ה-API מהטבלה', 'select api_key from wa_config', $q$select 'x'$q$);
reset role;
select provision_token_hash as hash_before from wa_config \gset
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
do $$ begin
  perform rpc_wa_issue_provision_token(24);
  raise exception 'הונפק';
exception when others then
  if sqlerrm = 'הונפק' then raise exception '  ✗ ★ מנהלת סניף הנפיקה טוקן הקמה'; end if;
end $$;
reset role;
select assert_true((select provision_token_hash = :'hash_before' from wa_config), '★ מנהלת סניף לא מנפיקה טוקן הקמה');
rollback;
\echo '  כל בדיקות הקמת שרת הוואטסאפ עברו'
