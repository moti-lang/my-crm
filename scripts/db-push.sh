#!/usr/bin/env bash
#
# החלת המיגרציות על הענן, בסדר, עצירה במיגרציה הראשונה שנופלת.
#
# שני מסלולים:
#   1. אם יש SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD — דרך ה-CLI (link + db push).
#   2. אחרת, אם יש SUPABASE_DB_URL — ישירות ב-psql.
#
# המסלול השני קיים כי מחרוזת החיבור היא מה שיש ביד, ו-supabase link דורש
# שני פרטים נוספים. כל מיגרציה רצה בטרנזקציה אחת עם ON_ERROR_STOP, ונרשמת
# ב-supabase_migrations.schema_migrations כדי שה-CLI יישאר מסונכרן בהמשך.
set -uo pipefail
cd "$(dirname "$0")/.."

MIG_DIR=supabase/migrations

if [ -n "${SUPABASE_PROJECT_REF:-}" ] && [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "  → מסלול CLI (project-ref)"
  npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" || exit 1
  exec npx supabase db push --password "$SUPABASE_DB_PASSWORD"
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "  ✗ אין SUPABASE_PROJECT_REF+SUPABASE_DB_PASSWORD ואין SUPABASE_DB_URL"
  exit 1
fi

echo "  → מסלול psql (connection string)"

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
