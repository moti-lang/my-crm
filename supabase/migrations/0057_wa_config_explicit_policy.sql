-- 0057 — הקשחת אבטחה: wa_config — "שרת בלבד" במפורש.
--
-- הממצא (Security Advisor, rls_enabled_no_policy — INFO): ב-wa_config (כתובת שרת הוואטסאפ, מפתח
-- וסוד ה-webhook) RLS פעיל ואין אף policy. זה נכון — רק Edge Functions (service_role, שעוקף RLS)
-- ניגשות אליה, ול-anon/authenticated אין שום הרשאה — אבל "אין policy" נראה כמו שכחה.
--
-- התיקון: policy מגבילה (restrictive) שסוגרת במפורש את הטבלה ל-anon ול-authenticated, גם אם
-- מישהו יעניק להם בעתיד הרשאה בטעות. service_role לא מושפע (bypassrls).
drop policy if exists wa_config_server_only on wa_config;
create policy wa_config_server_only on wa_config as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on wa_config from public, anon, authenticated;
