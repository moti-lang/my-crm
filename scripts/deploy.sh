#!/usr/bin/env bash
#
# פריסה לאוויר. עוצר בכשל הראשון ולא מתקן כלום.
#
#   cp .env.verify.example .env.verify && $EDITOR .env.verify
#   ./scripts/deploy.sh
#
# הסדר לא שרירותי: המסד לפני הפונקציות, הפונקציות לפני הפרונט.
# פרונט שעולה מול מסד ריק נראה שבור, ואין דרך לדעת שזו רק סדר.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env.verify ] && set -a && . ./.env.verify && set +a
FAILED=0
step() { echo ""; echo "═══ $1 ═══"; }
fail() { echo "  ✗ $1"; FAILED=1; }
ok()   { echo "  ✓ $1"; }
need() {
  local m=(); for v in "$@"; do [ -z "${!v:-}" ] && m+=("$v"); done
  [ ${#m[@]} -gt 0 ] && { echo "  ✗ חסרים: ${m[*]}"; FAILED=1; return 1; }; return 0
}

# ─── 0. שער: לא פורסים קוד שנופל ───
step "0 · בדיקות לפני פריסה"
npm run -s typecheck && ok "tsc נקי" || { fail "tsc נכשל"; exit 1; }
./supabase/tests/reset.sh >/dev/null 2>&1 && ./supabase/tests/run.sh >/tmp/pre.out 2>&1
if grep -q '✗' /tmp/pre.out; then fail "בדיקות נופלות — לא פורסים"; exit 1; fi
ok "$(grep -c '✓' /tmp/pre.out) בדיקות עוברות"

# ─── 1. מסד ───
step "1 · מיגרציות"
if need SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; then
  npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" >/dev/null \
    && npx supabase db push --password "$SUPABASE_DB_PASSWORD" \
    && ok "המיגרציות הוחלו" || fail "db push נכשל"
fi

# ─── 2. נתוני בסיס ───
step "2 · seed ומשתמשים"
if need SUPABASE_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql \
    && ok "נתוני הבסיס נטענו" || fail "seed נכשל"
  node scripts/seed-users.mjs && ok "המשתמשים נוצרו" || fail "יצירת המשתמשים נכשלה"
fi

# ─── 3. סודות ופונקציות ───
step "3 · Edge Functions"
if need SUPABASE_PROJECT_REF; then
  # ברירת המחדל יבשה. מעבר לחי הוא החלטה נפרדת, אחרי אימות.
  npx supabase secrets set \
    WA_DRY_RUN="${WA_DRY_RUN:-true}" AI_DRY_RUN="${AI_DRY_RUN:-true}" \
    ${WA_SERVER_URL:+WA_SERVER_URL="$WA_SERVER_URL"} \
    ${WA_API_KEY:+WA_API_KEY="$WA_API_KEY"} \
    ${WA_WEBHOOK_SECRET:+WA_WEBHOOK_SECRET="$WA_WEBHOOK_SECRET"} \
    ${ANTHROPIC_API_KEY:+ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    ${OWNER_ALERT_WEBHOOK:+OWNER_ALERT_WEBHOOK="$OWNER_ALERT_WEBHOOK"} \
    ${SITE_URL:+SITE_URL="$SITE_URL"} >/dev/null \
    && ok "הסודות נקבעו (WA_DRY_RUN=${WA_DRY_RUN:-true})" || fail "קביעת הסודות נכשלה"

  for fn in wa-send wa-webhook ai-command cron-lessons cron-reminders cron-debt \
            cron-attendance-watch cron-absence cron-summary cron-wa-health; do
    npx supabase functions deploy "$fn" --no-verify-jwt >/dev/null 2>&1 \
      && echo "    ✓ $fn" || { echo "    ✗ $fn"; FAILED=1; }
  done
fi

# ─── 4. פרונט ───
step "4 · פרונט"
if need VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; then
  npm run -s build && ok "בילד הצליח" || fail "בילד נכשל"
  if [ -n "${NETLIFY_AUTH_TOKEN:-}" ] && [ -n "${NETLIFY_SITE_ID:-}" ]; then
    npx --yes netlify-cli deploy --prod --dir=dist --site "$NETLIFY_SITE_ID" \
      && ok "נפרס לנטליפיי" || fail "פריסה לנטליפיי נכשלה"
  else
    echo "  ! אין NETLIFY_AUTH_TOKEN/NETLIFY_SITE_ID — dist/ מוכן לגרירה ידנית"
  fi
fi

echo ""
echo "═══════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  echo " הפריסה הושלמה"
  echo ""
  echo " השלב הבא — אימות מול הענן:"
  echo "   ./scripts/verify-cloud.sh"
else
  echo " הפריסה נכשלה — ראה למעלה"
fi
exit "$FAILED"
