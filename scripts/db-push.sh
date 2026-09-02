#!/usr/bin/env bash
#
# החלת המיגרציות על הענן, בסדר, עצירה במיגרציה הראשונה שנופלת.
#
# שלושה מסלולים:
#   1. אם יש SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD — דרך ה-CLI (link + db push).
#   2. אחרת, אם יש SUPABASE_DB_URL — ישירות ב-psql.
#   3. אחרת, אם יש SUPABASE_ACCESS_TOKEN — דרך ה-Management API (HTTPS בלבד).
#
# המסלול השני קיים כי מחרוזת החיבור היא מה שיש ביד, ו-supabase link דורש
# שני פרטים נוספים. השלישי קיים כי יש סביבות שבהן פורט 5432 חסום ורק
# HTTPS יוצא — שם גם מחרוזת חיבור נכונה לא עוזרת. בכל המסלולים כל מיגרציה
# רצה בטרנזקציה אחת ועצירה בראשונה שנופלת, ונרשמת
# ב-supabase_migrations.schema_migrations כדי שה-CLI יישאר מסונכרן בהמשך.
set -uo pipefail
cd "$(dirname "$0")/.."

MIG_DIR=supabase/migrations

# ─────────────────────────────────────────────────────────────
# נעילת יעד. בחשבון יש עוד פרויקטים, ומיגרציה שרצה על הפרויקט הלא נכון
# היא נזק בלתי הפיך. אין כאן ניחוש: או שהיעד תואם בדיוק, או שלא רצים.
# ─────────────────────────────────────────────────────────────
assert_target() {
  local actual="$1" expected="$2" what="$3"
  if [ "$actual" != "$expected" ]; then
    echo "  ✗ היעד אינו תואם — לא רצה כלום"
    echo "    $what: $actual"
    echo "    מצופה:  $expected"
    exit 1
  fi
  echo "  ✓ יעד מאומת ($what): $expected"
}

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "  ✗ אין SUPABASE_PROJECT_REF — בלי נעילת יעד לא מריצים מיגרציות"
  exit 1
fi

# קישור קודם שנשאר מפרויקט אחר הוא בדיוק התרחיש המסוכן: db push היה
# הולך לשם. בודקים לפני שנוגעים במשהו.
if [ -f supabase/.temp/project-ref ]; then
  existing=$(cat supabase/.temp/project-ref)
  [ -n "$existing" ] && assert_target "$existing" "$SUPABASE_PROJECT_REF" "קישור קיים"
fi

if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "  → מסלול CLI (project-ref)"
  npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" || exit 1
  # אחרי הקישור — מוודאים שוב מה שנרשם בפועל, לא מה שביקשנו.
  assert_target "$(cat supabase/.temp/project-ref)" "$SUPABASE_PROJECT_REF" "קישור אחרי link"
  exec npx supabase db push --password "$SUPABASE_DB_PASSWORD"
fi

if [ -z "${SUPABASE_DB_URL:-}" ] && [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "  → מסלול Management API (access token)"
  exec node scripts/db-push-api.mjs
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "  ✗ אין SUPABASE_PROJECT_REF+SUPABASE_DB_PASSWORD, אין SUPABASE_DB_URL ואין SUPABASE_ACCESS_TOKEN"
  exit 1
fi

echo "  → מסלול psql (connection string)"

# ה-ref מופיע במארח של מחרוזת החיבור של סופאבייס
# (db.<ref>.supabase.co, או aws-*.pooler.supabase.com עם postgres.<ref> כמשתמש).
if ! grep -q "$SUPABASE_PROJECT_REF" <<<"$SUPABASE_DB_URL"; then
  echo "  ✗ מחרוזת החיבור אינה מכילה את ה-ref $SUPABASE_PROJECT_REF — לא רצה כלום"
  exit 1
fi
echo "  ✓ יעד מאומת (מחרוזת חיבור): $SUPABASE_PROJECT_REF"

# ההוכחה החזקה: שואלים את המסד עצמו מי הוא. ב-Supabase שם המארח נמצא
# בהגדרות החיבור, ולכן מספיק לוודא שאנחנו לא על postgres מקומי בטעות.
actual_db=$(psql "$SUPABASE_DB_URL" -tAc "select current_database()" 2>&1) || {
  echo "  ✗ אין חיבור למסד: $actual_db"; exit 1; }
echo "  ✓ מחובר למסד: $actual_db"

# טבלת המעקב של סופאבייס. יוצרים אותה אם היא לא קיימת כדי שהריצה תהיה
# אידמפוטנטית: מיגרציה שכבר הוחלה לא תרוץ שוב.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || exit 1
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

applied=$(psql "$SUPABASE_DB_URL" -tAc \
  "select version from supabase_migrations.schema_migrations" 2>/dev/null)

count=0
for f in "$MIG_DIR"/*.sql; do
  base=$(basename "$f")
  version="${base%%_*}"
  if grep -qx "$version" <<<"$applied"; then
    echo "  · $base — כבר הוחלה, מדלג"
    continue
  fi
  echo "  · $base"
  # --single-transaction: המיגרציה מוחלת במלואה או בכלל לא.
  if ! psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$f"; then
    echo ""
    echo "  ✗ המיגרציה שנפלה: $base"
    echo "    השגיאה למעלה. שום שינוי מהקובץ הזה לא נשאר בבסיס הנתונים."
    exit 1
  fi
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$base') on conflict (version) do nothing" || exit 1
  count=$((count + 1))
done

echo "  → $count מיגרציות חדשות הוחלו"
