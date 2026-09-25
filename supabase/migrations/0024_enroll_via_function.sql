-- 0024 — rpc_enroll רק דרך ה-Edge Function `enroll` (service_role), כדי
-- שהגבלת הקצב לפי IP תחול תמיד. הדף הציבורי כבר לא קורא ל-RPC ישירות.
-- rpc_enrollment_public (שם, תקנון, מבנה, סניפים) נשארת פתוחה ל-anon — קריאה בלבד.
revoke all on function rpc_enroll(jsonb, text) from public, anon, authenticated;
grant execute on function rpc_enroll(jsonb, text) to service_role;
