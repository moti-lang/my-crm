#!/usr/bin/env bash
#
# סבב האימות — ששת השלבים, בסדר, עצירה בכשל הראשון.
#
# מפעיל את כל מה שעד היום רץ רק מול המנוע המקומי, מול הענן האמיתי.
# לא מתקן כלום. מדווח מה נשבר ואיפה.
#
#   cp .env.verify.example .env.verify && $EDITOR .env.verify
#   ./scripts/verify-cloud.sh
#
# אפשר להריץ שלב בודד:  ./scripts/verify-cloud.sh 3
set -uo pipefail
cd "$(dirname "$0")/.."

ONLY="${1:-}"
FAILED=0

[ -f .env.verify ] && set -a && . ./.env.verify && set +a

step() {
  local n="$1" title="$2"
  [ -n "$ONLY" ] && [ "$ONLY" != "$n" ] && return 1
  echo ""
  echo "═══════════════════════════════════════════════"
  echo " שלב $n — $title"
  echo "═══════════════════════════════════════════════"
  return 0
}

need() {
  local missing=()
  for v in "$@"; do [ -z "${!v:-}" ] && missing+=("$v"); done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "  ✗ חסרים משתני סביבה: ${missing[*]}"
    FAILED=1; return 1
  fi
  return 0
}

fail() { echo "  ✗ $1"; FAILED=1; }
ok()   { echo "  ✓ $1"; }

# ─────────── 1. מיגרציות ───────────
if step 1 "db push — 13 מיגרציות על פרויקט נקי"; then
  if need SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; then
    npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" \
      && npx supabase db push --password "$SUPABASE_DB_PASSWORD" \
      && ok "כל המיגרציות הוחלו" \
      || fail "db push נכשל — המיגרציה שנפלה מופיעה למעלה"
  fi
fi

# ─────────── 2. משתמשים דרך Admin API ───────────
if step 2 "seed:users — ההימור על ה-Admin API"; then
  if need SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; then
    node scripts/seed-users.mjs \
      && ok "שלושת המשתמשים נוצרו והפרופילים נכתבו" \
      || fail "יצירת המשתמשים נכשלה"
  fi
fi

# ─────────── 3. התחברות אמיתית ───────────
if step 3 "התחברות בשלושת התפקידים מול GoTrue"; then
  if need SUPABASE_URL SUPABASE_ANON_KEY; then
    node scripts/verify-login.mjs \
      && ok "שלושת התפקידים התחברו וקיבלו JWT" \
      || fail "התחברות נכשלה"
  fi
fi

# ─────────── 4. כל החבילה מול הענן ───────────
if step 4 "כל הבדיקות מול הענן, עם JWT אמיתיים"; then
  if need SUPABASE_DB_URL; then
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
      npx netlify deploy --prod --dir=dist --site "$NETLIFY_SITE_ID" \
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
