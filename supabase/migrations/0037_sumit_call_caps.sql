-- 0037 — SUMIT: תקרה קשיחה לקריאות, בלי קשר לתדירות הסנכרון.
--
-- אחרי 0036 ריצה בלי מה לבדוק עולה 0 קריאות. אבל שלושה מצבים עדיין חזרו על עצמם בכל ריצה,
-- כך שתדירות גבוהה יותר = יותר קריאות:
--   · קישור עם מזהה תשלום שלא נסגר (חיוב שנדחה / קבלה שלא נוצרה / SUMIT לא זמינה) — נבדק שוב
--     בכל ריצה עד שהקישור פג (עד ~9 ימים).
--   · הוראת קבע ש-SUMIT לא מחזירה / שגיאה — last_checked_at לא התעדכן, ונבדקה בכל ריצה, לתמיד.
--   · ריענון של דף החזרה מ-SUMIT — כל ריענון עם אותו מזהה הפעיל בדיקה (לא נספר).
-- עכשיו: קישור — עד 3 בדיקות בסנכרון ועד 3 אישורים מהדפדפן, ואז התראה לבדיקה ידנית.
-- הוראת קבע — בדיקה שנכשלה נספרת כבדיקה (פעם ביום לכל היותר), ואחרי 3 כישלונות ברצף — מפסיקים + התראה.

alter table payment_links add column if not exists sync_checks int not null default 0;
alter table standing_orders add column if not exists check_failures int not null default 0;

-- ★ הסנכרון: רק קישורים עם מזהה מ-SUMIT, ולכל היותר 3 בדיקות לקישור.
create or replace function rpc_payment_links_to_sync() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(f_link_ref(l)), '[]'::jsonb)
  from payment_links l
  where l.status in ('pending', 'opened') and l.sumit_pid_candidate is not null and l.expires_at > now() - interval '2 days'
    and l.sync_checks < 3
$$;

-- סימון "נבדק" + ספירה. קישור שהגיע ל-3 בדיקות בלי תוצאה — יוצא מהסנכרון, והבעלים יודעת.
create or replace function rpc_payment_links_mark_checked(p_tokens text[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update payment_links set last_checked_at = now(),
         sync_checks = sync_checks + case when status in ('pending', 'opened') then 1 else 0 end
   where token = any(p_tokens);
  insert into system_alerts (kind, severity, title, body, meta)
  select 'sumit_sync_gave_up', 'warning', 'תשלום לא אומת אוטומטית — לבדוק ב-SUMIT',
         format('קישור %s: SUMIT מסרה מזהה תשלום %s, ואחרי 3 בדיקות הוא עדיין לא אומת (חיוב שנדחה, קבלה שלא נוצרה, או SUMIT לא זמינה). '
                'לא בודקים יותר אוטומטית, כדי לא לבזבז קריאות. אם ההורה שילמה — לסמן ידנית.', l.external_identifier, l.sumit_pid_candidate),
         jsonb_build_object('token', l.token, 'payment_id', l.sumit_pid_candidate)
    from payment_links l
   where l.token = any(p_tokens) and l.status in ('pending', 'opened') and l.sync_checks = 3;
  update payment_links set status = 'expired' where status in ('pending', 'opened') and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function rpc_payment_links_mark_checked(text[]) from public, anon, authenticated;
grant execute on function rpc_payment_links_mark_checked(text[]) to service_role;

/**
 * מזהה תשלום ש-SUMIT מסרה לקישור שלנו. מהדפדפן (redirect): רק עם ה-ExternalIdentifier של
 * הקישור, רק לקישור פתוח, ועד 3 אישורים לקישור — כל אישור נספר, גם ריענון עם אותו מזהה
 * (כל אחד הוא בדיקה מול SUMIT). מה-IPN (סוד משותף, שרת-לשרת): בלי מגבלה.
 */
create or replace function rpc_payment_link_candidate(p_token text, p_external_identifier text, p_payment_id text,
                                                      p_customer_id text, p_source text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype;
begin
  select * into l from payment_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  if l.status = 'paid' then return jsonb_build_object('ok', true, 'already_paid', true); end if;
  if l.status not in ('pending', 'opened') then return jsonb_build_object('ok', false, 'error', 'הקישור אינו פתוח'); end if;
  if p_external_identifier is distinct from l.external_identifier then
    return jsonb_build_object('ok', false, 'error', 'המזהה אינו של הקישור הזה');
  end if;
  if coalesce(p_payment_id, '') !~ '^[0-9]{1,18}$' or (p_customer_id is not null and p_customer_id !~ '^[0-9]{1,18}$') then
    return jsonb_build_object('ok', false, 'error', 'מזהה תשלום לא תקין');
  end if;
  if p_source = 'redirect' and l.confirm_attempts >= 3 then
    return jsonb_build_object('ok', false, 'error', 'יותר מדי ניסיונות אישור לקישור הזה');
  end if;
  update payment_links set sumit_pid_candidate = p_payment_id, sumit_cid_candidate = p_customer_id, candidate_source = p_source,
         confirm_attempts = confirm_attempts + case when p_source = 'redirect' then 1 else 0 end
   where id = l.id returning * into l;
  return jsonb_build_object('ok', true, 'link', f_link_ref(l));
end $$;
revoke all on function rpc_payment_link_candidate(text, text, text, text, text) from public, anon, authenticated;
grant execute on function rpc_payment_link_candidate(text, text, text, text, text) to service_role;

-- ─────────── הוראות קבע ───────────
create or replace function rpc_standing_orders_to_check() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'customer_id', o.sumit_customer_id, 'recurring_id', o.sumit_recurring_id,
           'amount', o.amount, 'date_start', o.date_start, 'last_checked_at', o.last_checked_at, 'status', o.status)), '[]'::jsonb)
  from standing_orders o
  where o.sumit_recurring_id is not null
    and (o.status in ('active', 'retrying', 'failed')
         or (o.status = 'cancelled' and o.cancelled_at > now() - interval '14 days'))
    and (o.last_checked_at is null or o.last_checked_at < now() - interval '20 hours')
    and (o.status = 'cancelled' or o.next_billing is null or o.next_billing <= current_date + 1
         or o.last_checked_at is null or o.last_checked_at < now() - interval '7 days')
    and o.check_failures < 3
$$;

/**
 * הבדיקה מול SUMIT נכשלה (שגיאה / ההוראה לא הוחזרה). נספרת כבדיקה — לא חוזרים עליה באותו יום.
 * אחרי 3 כישלונות ברצף מפסיקים לבדוק (כל בדיקה עולה קריאה), והבעלים יודעת.
 */
create or replace function rpc_standing_order_check_failed(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_name text;
begin
  update standing_orders set last_checked_at = now(), check_failures = check_failures + 1, last_error = left(p_error, 500)
   where id = p_id returning * into o;
  if o.id is null or o.check_failures <> 3 then return; end if;
  select full_name into v_name from students where id = o.student_id;
  insert into system_alerts (kind, severity, title, body, meta)
  values ('standing_order_check_gave_up', 'warning', 'הוראת קבע לא נבדקת יותר אוטומטית — לבדוק ב-SUMIT',
          format('%s: 3 בדיקות ברצף מול SUMIT נכשלו (%s). הפסקנו לבדוק אוטומטית כדי לא לבזבז קריאות; חיובים חדשים לא ייקלטו לבד. לבדוק ב-SUMIT.',
                 coalesce(v_name, '—'), coalesce(p_error, 'לא ידוע')),
          jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id));
end $$;
revoke all on function rpc_standing_order_check_failed(uuid, text) from public, anon, authenticated;
grant execute on function rpc_standing_order_check_failed(uuid, text) to service_role;

-- כמו 0036, ובדיקה שהצליחה מאפסת את מונה הכישלונות.
create or replace function rpc_standing_billing_observed(p_id uuid, p_sumit_status int, p_next date, p_prev date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_charge jsonb := null; v_status text;
begin
  select * into o from standing_orders where id = p_id;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  update standing_orders set check_failures = 0 where id = o.id and check_failures <> 0;
  v_status := coalesce(f_standing_status(p_sumit_status), o.status);
  if p_prev is not null and (o.last_billing is null or p_prev > o.last_billing)
     and v_status in ('active', 'completed')
     and not exists (select 1 from standing_order_charges c where c.standing_order_id = o.id and c.charged_at::date = p_prev) then
    v_charge := rpc_record_standing_charge(o.id, -(o.sumit_recurring_id::bigint * 100000000 + to_char(p_prev, 'YYYYMMDD')::bigint),
                                           o.amount, p_prev::timestamptz, true, null);
  end if;
  return jsonb_build_object('ok', true, 'charge', v_charge, 'status', rpc_standing_order_status(p_id, p_sumit_status, p_next, p_prev));
end $$;
revoke all on function rpc_standing_billing_observed(uuid, int, date, date) from public, anon, authenticated;
grant execute on function rpc_standing_billing_observed(uuid, int, date, date) to service_role;
