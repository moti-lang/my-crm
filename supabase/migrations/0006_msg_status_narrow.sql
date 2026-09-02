-- 0006 — צמצום msg_status ל-queued / sent / failed.
--
-- הבסיס לכך הוא קוד השרת עצמו: הוא פולט message.sent ו-message.failed,
-- ואין בו שום אירוע של מסירה או קריאה (EVENTS ב-store/webhooks.ts הם
-- message.received / message.sent / message.failed / connection.changed /
-- campaign.finished / group.message). כלומר למערכת אין ולא יהיה מידע
-- על "נמסר" — ולכן אסור שיהיה ערך כזה שאפשר להציג.
alter type msg_status rename to msg_status_old;
create type msg_status as enum ('queued','sent','failed');

alter table wa_messages
  alter column status type msg_status
  using (case
           when status::text in ('delivered','read') then 'sent'
           else status::text
         end)::msg_status;

drop type msg_status_old;
