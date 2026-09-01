# Edge Functions

## דגלי הרצה יבשה

| דגל | ברירת מחדל | מה קורה |
|---|---|---|
| `WA_DRY_RUN` | `true` | כל לוגיקת השליחה רצה — נרמול, שעות שקטות, ניסיונות חוזרים, רישום ב-`wa_messages` — אבל Green API לא נקרא. ההודעה נרשמת עם `status='queued'`. |
| `AI_DRY_RUN` | `true` | `ai-command` / `ai-answer` מקבלים תשובה קבועה ותקפה מבחינת סכימה. Claude לא נקרא ולא נצרך תקציב. |

**ברירת המחדל היא יבש.** כדי לעבור לחי צריך לקבוע במפורש `false` — שכחה לא שולחת הודעות אמיתיות בטעות.

## מעבר לחי (סבב 5)

```bash
supabase secrets set WA_DRY_RUN=false
supabase secrets set GREEN_API_ID=... GREEN_API_TOKEN=... GREEN_API_URL=https://api.green-api.com
supabase secrets set ANTHROPIC_API_KEY=...  AI_DRY_RUN=false
```

שתי שורות, בלי נגיעה בקוד. את המספר האמיתי של הניה מחברים רק אחרי שסבב 5 עובר על מספר בדיקה.

## מבנה

- `_shared/wa.ts` — אדפטר וואטסאפ (`DryRunWaClient` / `GreenApiClient`)
- `_shared/ai.ts` — אדפטר Claude (`DryRunAiClient` / `ClaudeClient`)
- `_shared/quiet-hours.ts` — שעות שקטות, שבת וחגים לפי שעון ישראל
- `_shared/supabase.ts` — לקוח service_role (צד שרת בלבד)
- `wa-send/` — שער היציאה היחיד לוואטסאפ
