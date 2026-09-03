#!/usr/bin/env bash
#
# סבב האימות — שבעת השלבים, בסדר, עצירה בכשל הראשון.
#
# מפעיל את כל מה שעד היום רץ רק מול המנוע המקומי, מול הענן האמיתי.
# לא מתקן כלום. מדווח מה נשבר ואיפה.
#
#   cp .env.verify.example .env.verify && $EDITOR .env.verify
#   ./scripts/verify-cloud.sh
#
# אפשר להריץ שלב בודד:  ./scripts/verify-cloud.sh 3
#
# שני מובילים למסד, לפי מה שיש בסביבה:
#   SUPABASE_DB_URL       — psql ישיר. הדרך המלאה.
#   SUPABASE_ACCESS_TOKEN — Management API. קיים לסביבות שבהן פורט 5432
#                           חסום ורק HTTPS יוצא. מריץ הכול חוץ ממרוץ
#                           האישורים, שדורש שני חיבורים חיים.
set -uo pipefail
cd "$(dirname "$0")/.."

ONLY="${1:-}"
FAILED=0
STEP=0

[ -f .env.verify ] && set -a && . ./.env.verify && set +a

step() {
  local n="$1" title="$2"
  [ -n "$ONLY" ] && [ "$ONLY" != "$n" ] && return 1
  STEP="$n"
  echo ""
  echo "═══════════════════════════════════════════════"
  echo " שלב $n — $title"
  echo "═══════════════════════════════════════════════"
  return 0
}

# עוצרים בכשל הראשון. שלב שרץ על בסיס נתונים חצי-מוגר מייצר מפל
# שגיאות שמסתיר את הסיבה האמיתית, וזה בדיוק מה שאנחנו לא רוצים לדווח.
# ריצה של שלב בודד (ONLY) לא עוצרת — שם ממילא יש רק שלב אחד.
abort() {
  echo ""
  echo "═══════════════════════════════════════════════"
  echo " עצירה בשלב $1 — השלבים הבאים לא רצו"
  echo " הסיבה למעלה. אין תיקון בשקט."
  exit 1
}

need() {
  local missing=()
  for v in "$@"; do [ -z "${!v:-}" ] && missing+=("$v"); done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "  ✗ חסרים משתני סביבה: ${missing[*]}"
    FAILED=1
    [ -z "$ONLY" ] && abort "$STEP"
    return 1
  fi
  return 0
}

fail() { echo "  ✗ $1"; FAILED=1; [ -z "$ONLY" ] && abort "$STEP"; }
ok()   { echo "  ✓ $1"; }

# ה-CLI של נטליפיי הוא החבילה netlify-cli. `npx netlify` היה מושך חבילה אחרת.
netlify_cli() {
  if command -v netlify >/dev/null 2>&1; then netlify "$@"; else npx --yes netlify-cli "$@"; fi
}

# ─────────── 0. הפרויקט המתארח (רק עם access token) ───────────
# לא שלב ממוספר: רץ לפני כל שלב שנבחר, כי המפתחות שהוא מושך משמשים
# את 3 ו-7. בלי הטוקן — הערכים מגיעים מ-.env.verify כרגיל.
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo ""
  echo "═══ הפרויקט המתארח (Management API) ═══"
  if env_out=$(node scripts/supabase-project.mjs env); then
    eval "$env_out"
    export SUPABASE_URL SUPABASE_ANON_KEY VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
    ok "מפתח ה-anon וכתובת הפרויקט נמשכו מהמקור"
  else
    echo "  ✗ משיכת המפתחות נכשלה"; FAILED=1; abort "0"
  fi
  # ההגדרה שקובעת בפרויקט מתארח היא בדשבורד. כאן היא נקבעת בקוד.
  node scripts/supabase-project.mjs auth || { echo "  ✗ הגדרת גוגל-בלבד נכשלה"; FAILED=1; abort "0"; }
  # מפתח service_role לשלבים 2 ו-3, אם לא ניתן ידנית.
  if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    SUPABASE_SERVICE_ROLE_KEY=$(node scripts/supabase-project.mjs service-key) && export SUPABASE_SERVICE_ROLE_KEY \
      && ok "מפתח service_role נמשך מהמקור (לא נשמר בשום מקום)" \
      || { echo "  ✗ משיכת מפתח service_role נכשלה"; FAILED=1; abort "0"; }
  fi
fi

# ─────────── 1. מיגרציות ───────────
if step 1 "db push — 15 מיגרציות על פרויקט נקי"; then
  # db-push.sh בוחר בין ה-CLI, psql וה-Management API לפי מה שיש בסביבה.
  if [ -z "${SUPABASE_PROJECT_REF:-}" ] && [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "  ✗ חסרים משתני סביבה: SUPABASE_DB_URL (או SUPABASE_PROJECT_REF עם SUPABASE_DB_PASSWORD / SUPABASE_ACCESS_TOKEN)"
    FAILED=1; [ -z "$ONLY" ] && abort "$STEP"
  else
    ./scripts/db-push.sh \
      && ok "כל המיגרציות הוחלו" \
      || fail "db push נכשל — המיגרציה שנפלה מופיעה למעלה"
  fi
fi

# ─────────── 2. נתוני בסיס, הבעלים הראשונה, זהויות הבדיקה ───────────
if step 2 "seed, רשימת המורשים וזהויות הבדיקה"; then
  if [ -z "${SUPABASE_DB_URL:-}" ] && [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "  ✗ חסרים משתני סביבה: SUPABASE_DB_URL (או SUPABASE_ACCESS_TOKEN)"
    FAILED=1; [ -z "$ONLY" ] && abort "$STEP"
  else
    # db push אינו מריץ seed. בלעדיו שלב 3 רואה מסד ריק וכל הציפיות נופלות.
    # seed.sql אינו אידמפוטנטי (מזהים קבועים), ולכן רץ רק כשאין סניפים.
    # seed_allowlist.sql (הבעלים הראשונה) אידמפוטנטי ורץ תמיד.
    if [ -n "${SUPABASE_DB_URL:-}" ]; then
      if [ "$(psql "$SUPABASE_DB_URL" -tAc 'select count(*) from public.branches')" = "0" ]; then
        psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f supabase/seed.sql \
          && ok "נתוני הבסיס נטענו" || fail "seed נכשל"
      else
        echo "  · כבר יש סניפים — seed.sql לא רץ שוב"
      fi
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed_allowlist.sql \
        && ok "הבעלים הראשונה ברשימת המורשים" || fail "seed_allowlist נכשל"
    elif [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
      node scripts/db-push-api.mjs seed && ok "נתוני הבסיס והבעלים הראשונה במקום" || fail "seed נכשל"
    else
      echo "  ! אין SUPABASE_DB_URL ואין SUPABASE_ACCESS_TOKEN — seed לא נטען"
    fi
    # זהויות הבדיקה עוברות באותו טריגר שעוברת כניסה אמיתית. אם הוא
    # נשבר — אף אחת לא נוצרת, וזה נראה כאן ולא בשלב 4.
    PGURL="${PGURL:-${SUPABASE_DB_URL:-}}" node scripts/seed-identities.mjs \
      && ok "שלוש זהויות הבדיקה נוצרו דרך השער" \
      || fail "יצירת זהויות הבדיקה נכשלה"
  fi
fi

# ─────────── 3. הדלת: גוגל בלבד, רשימה בלבד ───────────
if step 3 "השער מול GoTrue האמיתי — אין סיסמה, אין זר"; then
  if need SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; then
    PGURL="${PGURL:-${SUPABASE_DB_URL:-}}" node scripts/verify-access.mjs \
      && ok "זר נדחה במסד, סיסמה נדחית, מוזמנת מקבלת את תפקידה" \
      || fail "הדלת פתוחה — ראה למעלה"
  fi
fi

# ─────────── 4. כל החבילה מול הענן ───────────
if step 4 "כל הבדיקות מול הענן, עם JWT אמיתיים"; then
  if [ -z "${SUPABASE_DB_URL:-}" ] && [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "  ✗ חסרים משתני סביבה: SUPABASE_DB_URL (או SUPABASE_ACCESS_TOKEN)"
    FAILED=1; [ -z "$ONLY" ] && abort "$STEP"
  else
    ./supabase/tests/run-cloud.sh \
      && ok "כל החבילות עברו מול הענן" \
      || fail "בדיקות נפלו מול הענן — הפרש מהמנוע המקומי"
  fi
fi

# ─────────── 5. וואטסאפ אמיתי ───────────
if step 5 "webhook והודעה אחת אמיתית"; then
  if need WA_SERVER_URL WA_API_KEY; then
    node scripts/verify-whatsapp.mjs \
      && ok "ה-webhook נרשם וההודעה יצאה" \
      || fail "מסלול הוואטסאפ נכשל"
  fi
fi

# ─────────── 6. השוואת מודלים ───────────
if step 6 "bench:model — 30 פקודות, שני מודלים"; then
  if need ANTHROPIC_API_KEY; then
    npm run bench:model \
      && ok "ההשוואה הסתיימה" \
      || fail "ההשוואה נכשלה"
  fi
fi

# ─────────── 7. פרונט חי ───────────
if step 7 "פרונט בנטליפיי + כתובת חיה"; then
  if need VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; then
    npm run build && ok "בילד עבר, כולל שער הסודות" || fail "בילד נכשל"
    if [ -n "${NETLIFY_AUTH_TOKEN:-}" ] && [ -n "${NETLIFY_SITE_ID:-}" ]; then
      netlify_cli deploy --prod --dir=dist --site "$NETLIFY_SITE_ID" \
        && ok "נפרס" || fail "פריסה נכשלה"
      if [ -n "${SITE_URL:-}" ]; then
        # ★ הבדיקה שמוכיחה שניתוב ה-SPA עובד: הקישור של האחראית
        code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/a/probe-token")
        [ "$code" = "200" ] && ok "/a/:token מחזיר 200 (ניתוב SPA עובד)" \
                            || fail "/a/:token מחזיר $code — ניתוב SPA שבור"
        code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/students")
        [ "$code" = "200" ] && ok "/students מחזיר 200" || fail "/students מחזיר $code"
      fi
    else
      echo "  ! אין NETLIFY_AUTH_TOKEN/NETLIFY_SITE_ID — dist/ מוכן לגרירה ידנית"
    fi
  fi
fi

echo ""
echo "═══════════════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  echo " סבב האימות עבר"
else
  echo " סבב האימות נכשל — ראה למעלה"
fi
exit "$FAILED"
