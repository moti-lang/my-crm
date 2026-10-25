-- 0040 — מיילים להורים: תור שליחה, יומן, הסרה מהתפוצה.
--
-- ★ נשלח רק למי שאישרה תפוצה במייל (students.mailing_consent), יש לה כתובת, והכתובת
--   לא הוסרה (email_suppressions: הסרה, חזרה קבועה, סימון כספאם). הבדיקה בשרת, לא במסך.
-- ★ התור במסד: email-send יוצרת הודעות "ממתינות", cron-email שולחת אותן — בקצב של הספק,
--   בתקרה יומית (המסלול החינמי של Resend: 100 ביום), ולא בשבת ובחגים.
-- ★ קישור הסרה בכל מייל (טוקן אקראי לכל הודעה). הסרה חלה על הכתובת — כל התלמידות שלה.

create table if not exists email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  subject         text not null check (btrim(subject) <> ''),
  body            text not null check (btrim(body) <> ''),
  attachment_name text,
  attachment_type text,
  attachment_size int,
  -- הקובץ עצמו נשמר רק עד שכל ההודעות יצאו, ואז נמחק (לא מנפח את המסד והגיבויים).
  attachment_b64  text,
  -- true: מייל לכל תלמידה (יש משתנים אישיים). false: מייל אחד לכל כתובת (שתי אחיות — מייל אחד).
  per_student     boolean not null default true,
  skipped         jsonb not null default '{}'::jsonb,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create table if not exists email_messages (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references email_campaigns(id) on delete cascade,
  student_id        uuid references students(id) on delete set null,
  to_email          text not null check (to_email = lower(btrim(to_email)) and to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  to_name           text,
  subject           text not null,
  body              text not null,
  status            text not null default 'queued'
                    check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'cancelled')),
  provider_id       text unique,
  error             text,
  attempts          int not null default 0,
  unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  created_at        timestamptz not null default now(),
  sending_at        timestamptz,
  sent_at           timestamptz,
  delivered_at      timestamptz
);
create index if not exists email_messages_queue_idx on email_messages (created_at) where status = 'queued';
create index if not exists email_messages_campaign_idx on email_messages (campaign_id);
create index if not exists email_messages_email_idx on email_messages (to_email);

create table if not exists email_suppressions (
  email      text primary key check (email = lower(btrim(email))),
  reason     text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  created_at timestamptz not null default now()
);

-- ─── הרשאות: הבעלים קוראת. כתיבה — רק מהפונקציות (service_role) ומה-RPC. ───
alter table email_campaigns enable row level security;
alter table email_messages enable row level security;
alter table email_suppressions enable row level security;
create policy email_campaigns_owner_read on email_campaigns for select using (auth_role() = 'owner');
create policy email_messages_owner_read on email_messages for select using (auth_role() = 'owner');
create policy email_suppressions_owner_read on email_suppressions for select using (auth_role() = 'owner');
revoke all on email_campaigns, email_messages, email_suppressions from anon;
revoke insert, update, delete, truncate on email_campaigns, email_messages, email_suppressions from authenticated;
grant select on email_campaigns, email_messages, email_suppressions to authenticated;

-- היומן: לכל שליחה — כמה ממתינות, נשלחו, נמסרו, חזרו, נכשלו.
create or replace view v_email_campaigns with (security_invoker = true) as
select c.id, c.subject, c.body, c.created_at, c.attachment_name, c.attachment_size, c.per_student, c.skipped,
       count(m.id) as total,
       count(m.id) filter (where m.status in ('queued', 'sending')) as pending,
       count(m.id) filter (where m.status = 'sent') as sent,
       count(m.id) filter (where m.status = 'delivered') as delivered,
       count(m.id) filter (where m.status in ('bounced', 'complained')) as bounced,
       count(m.id) filter (where m.status = 'failed') as failed,
       count(m.id) filter (where m.status = 'cancelled') as cancelled
from email_campaigns c left join email_messages m on m.campaign_id = c.id
group by c.id;
revoke all on v_email_campaigns from anon;
grant select on v_email_campaigns to authenticated;

-- ─── הסרה מהתפוצה: הקישור שבתחתית כל מייל (דף ציבורי, בלי התחברות) ───
-- p_confirm=false: רק מה להציג (הכתובת, מוסתרת חלקית). p_confirm=true: מסירה.
-- (שלב אישור ולא הסרה בפתיחת הקישור: סורקי קישורים של תיבות דואר "פותחים" קישורים לבד.)
create or replace function rpc_email_unsubscribe(p_token text, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m email_messages%rowtype; v_done boolean; v_local text; v_domain text;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false); end if;
  select * into m from email_messages where unsubscribe_token = p_token;
  if m.id is null then return jsonb_build_object('ok', false); end if;
  v_local := split_part(m.to_email, '@', 1); v_domain := split_part(m.to_email, '@', 2);
  v_done := exists (select 1 from email_suppressions where email = m.to_email);
  if p_confirm and not v_done then
    insert into email_suppressions (email, reason) values (m.to_email, 'unsubscribe') on conflict do nothing;
    update students set mailing_consent = false where lower(btrim(email)) = m.to_email and mailing_consent is distinct from false;
    update email_messages set status = 'cancelled', error = 'הוסרה מהתפוצה' where to_email = m.to_email and status = 'queued';
    insert into audit_log (actor, action, table_name, row_id, after, source)
    values ('public', 'email_unsubscribe', 'email_suppressions', m.id, jsonb_build_object('campaign_id', m.campaign_id), 'public');
    v_done := true;
  end if;
  return jsonb_build_object('ok', true, 'email', left(v_local, 1) || '***@' || v_domain, 'unsubscribed', v_done);
end $$;
revoke all on function rpc_email_unsubscribe(text, boolean) from public;
grant execute on function rpc_email_unsubscribe(text, boolean) to anon, authenticated;

-- ─── התור (service_role בלבד) ───
/**
 * לוקחת הודעות לשליחה: עד p_limit, ובתוך התקרה היומית (לפי שעון ישראל). אטומי
 * (skip locked) — שתי ריצות במקביל לא שולחות את אותה הודעה.
 *  · הודעה לכתובת שהוסרה בינתיים — מבוטלת, לא נשלחת.
 *  · הודעה תקועה ב"נשלחת" (הפונקציה נפלה באמצע) — מסומנת "נכשלה" ולא נשלחת שוב לבד:
 *    מייל כפול להורה גרוע ממייל חסר שרואים ביומן.
 *  · צרופה של שליחה שהסתיימה — נמחקת.
 */
create or replace function rpc_email_claim(p_limit int, p_daily_cap int) returns setof email_messages
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Jerusalem')) at time zone 'Asia/Jerusalem';
        v_used int; v_room int;
begin
  update email_messages set status = 'cancelled', error = 'הוסרה מהתפוצה'
   where status = 'queued' and to_email in (select email from email_suppressions);
  update email_messages set status = 'failed', error = 'השליחה נקטעה באמצע — לבדוק אם הגיע לפני ששולחים שוב'
   where status = 'sending' and sending_at < now() - interval '15 minutes';
  update email_campaigns c set attachment_b64 = null
   where attachment_b64 is not null
     and not exists (select 1 from email_messages m where m.campaign_id = c.id and m.status in ('queued', 'sending'));

  select count(*) into v_used from email_messages where sending_at >= v_today;
  v_room := greatest(0, least(p_limit, p_daily_cap - v_used));
  if v_room = 0 then return; end if;
  return query
  update email_messages m set status = 'sending', sending_at = now(), attempts = m.attempts + 1
   where m.id in (select q.id from email_messages q where q.status = 'queued' order by q.created_at, q.id limit v_room for update skip locked)
  returning m.*;
end $$;
revoke all on function rpc_email_claim(int, int) from public, anon, authenticated;
grant execute on function rpc_email_claim(int, int) to service_role;

/**
 * אירוע מהספק (Resend webhook): נמסר / חזר / סומן כספאם / עיכוב.
 * חזרה קבועה או ספאם — הכתובת נחסמת, וממתינות אליה מבוטלות. ספאם = גם ביטול ההסכמה.
 */
create or replace function rpc_email_event(p_provider_id text, p_type text, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m email_messages%rowtype;
begin
  select * into m from email_messages where provider_id = p_provider_id;
  if m.id is null then return jsonb_build_object('ok', true, 'found', false); end if;
  if p_type = 'email.delivered' then
    update email_messages set status = 'delivered', delivered_at = now()
     where id = m.id and status in ('sending', 'sent');
  elsif p_type = 'email.delivery_delayed' then
    update email_messages set error = 'עיכוב במסירה' where id = m.id and status = 'sent';
  elsif p_type in ('email.bounced', 'email.complained') then
    update email_messages set status = case when p_type = 'email.bounced' then 'bounced' else 'complained' end,
           error = coalesce(left(p_detail, 500), case when p_type = 'email.bounced' then 'הכתובת דחתה את המייל' else 'סומן כספאם' end)
     where id = m.id;
    insert into email_suppressions (email, reason)
    values (m.to_email, case when p_type = 'email.bounced' then 'bounce' else 'complaint' end) on conflict do nothing;
    update email_messages set status = 'cancelled', error = 'הכתובת נחסמה' where to_email = m.to_email and status = 'queued';
    if p_type = 'email.complained' then
      update students set mailing_consent = false where lower(btrim(email)) = m.to_email;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'found', true);
end $$;
revoke all on function rpc_email_event(text, text, text) from public, anon, authenticated;
grant execute on function rpc_email_event(text, text, text) to service_role;

-- התקרה היומית (מסלול הספק). ברירת מחדל: 100 — המסלול החינמי של Resend.
insert into settings (key, value) values ('email_daily_cap', '100'::jsonb) on conflict (key) do nothing;
