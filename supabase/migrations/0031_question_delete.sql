-- 0031 — מחיקת שאלות מהמאגר (כללי ושכבת סניף) ומ"שאלות ללא מענה".
-- שאלה ללא מענה שהפכה לתשובה מצביעה עליה (faq_id). בלי זה מחיקת התשובה נכשלת;
-- עכשיו הקישור מתאפס והשאלה ללא מענה נשארת (מסומנת כטופלה).
-- ההרשאה לא משתנה: רק בעלים (faq_owner / unanswered_owner, for all).
alter table unanswered_questions drop constraint if exists unanswered_questions_faq_id_fkey;
alter table unanswered_questions add constraint unanswered_questions_faq_id_fkey
  foreign key (faq_id) references faq_entries(id) on delete set null;
