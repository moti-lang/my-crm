-- 0016_customer_agent.sql — סבב 7: סוכן הלקוחות.
--
-- שיחת הרשמה נמשכת על פני כמה הודעות, וה-Edge Function מתה ביניהן.
-- מה שנאסף עד כה נשמר בשיחה, לא בזיכרון.
alter table conversations add column lead_state jsonb;

-- מסך השיחות: הודעות לפי טלפון, החדשות קודם. האינדקס כבר קיים (wa_phone_idx).
-- שאלות ללא מענה: הפתוחות קודם.
create index unanswered_open_idx on unanswered_questions (created_at desc) where not resolved;
