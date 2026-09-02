/**
 * פלטים מוקלטים לפרסור פקודות.
 *
 * מאפשרים להריץ את כל חבילת הבדיקות של הנתב **בלי מפתח Anthropic**
 * ובלי לשלם על אף קריאה. כל רשומה היא פלט אמיתי בפורמט שהמודל מחזיר,
 * כולל המקרים הפגומים — הם החשובים ביותר לבדוק.
 *
 * ההתאמה היא לפי הטקסט המדויק. טקסט שאינו ברשימה מקבל את התשובה
 * שב-DEFAULT_FIXTURE, כלומר unknown — כך שבדיקה ששכחה להקליט פלט
 * לא "מצליחה" בטעות.
 */
export const COMMAND_FIXTURES: Record<string, string> = {
  'שילמתי 860 תלבושות בביתר': JSON.stringify({
    intent: 'expense', confidence: 0.94,
    fields: { amount: 860, branch: 'ביתר עילית', category: 'תלבושות', vendor: null, date: null, production: null },
    missing: [], human_summary: 'הוצאה של 860 ש״ח לתלבושות בסניף ביתר עילית',
  }),

  'תרשמי תשלום 700 משירה כהן בביט': JSON.stringify({
    intent: 'payment', confidence: 0.91,
    fields: { student_name: 'שירה כהן', amount: 700, method: 'bit', date: null },
    missing: [], human_summary: 'תשלום של 700 ש״ח משירה כהן בביט',
  }),

  'מי חייבת בביתר': JSON.stringify({
    intent: 'query', confidence: 0.96,
    fields: { question_type: 'debtors', branch: 'ביתר עילית' },
    missing: [], human_summary: 'רשימת החייבות בסניף ביתר עילית',
  }),

  'תרשמי הוצאה': JSON.stringify({
    intent: 'expense', confidence: 0.72,
    fields: { branch: null, category: null, vendor: null, date: null },
    missing: ['amount'], human_summary: 'הוצאה ללא סכום',
  }),

  'תמחקי את שירה כהן': JSON.stringify({
    intent: 'update_student', confidence: 0.88,
    fields: { student_name: 'שירה כהן', field: 'status', value: 'deleted' },
    missing: [], human_summary: 'מחיקת התלמידה שירה כהן',
  }),

  'מה שלומך': JSON.stringify({
    intent: 'unknown', confidence: 0.15,
    fields: {}, missing: [], human_summary: 'לא זוהתה פקודה',
  }),

  'תוסיפי הכנסה 5000 חסויות': JSON.stringify({
    intent: 'income', confidence: 0.89,
    fields: { amount: 5000, branch: null, category: 'חסויות', description: null },
    missing: [], human_summary: 'הכנסה של 5,000 ש״ח מחסויות',
  }),

  // כוונה תקפה אבל ביטחון מתחת לסף. זה מה שבודק את MIN_CONFIDENCE
  // עצמו — בניגוד ל-intent='unknown', שנתפס בבדיקה נפרדת.
  '__FIXTURE_LOW_CONFIDENCE__': JSON.stringify({
    intent: 'expense', confidence: 0.4,
    fields: { amount: 500, branch: null, category: null },
    missing: [], human_summary: 'אולי הוצאה של 500',
  }),
  '__FIXTURE_JUST_UNDER_THRESHOLD__': JSON.stringify({
    intent: 'payment', confidence: 0.59,
    fields: { student_name: 'שירה כהן', amount: 700 },
    missing: [], human_summary: 'אולי תשלום',
  }),
  '__FIXTURE_JUST_OVER_THRESHOLD__': JSON.stringify({
    intent: 'payment', confidence: 0.6,
    fields: { student_name: 'שירה כהן', amount: 700, method: 'cash' },
    missing: [], human_summary: 'תשלום של 700 משירה כהן',
  }),

  // ─── מקרים פגומים. אלה מה שמגן על המסד. ───
  '__FIXTURE_MALFORMED_JSON__': '{ "intent": "expense", "confidence": 0.9,',
  '__FIXTURE_NOT_JSON__': 'בטח! רשמתי את ההוצאה בשבילך 😊',
  '__FIXTURE_MARKDOWN_WRAPPED__': '```json\n{"intent":"expense","confidence":0.9,"fields":{},"missing":[],"human_summary":"x"}\n```',
  '__FIXTURE_MISSING_FIELDS__': JSON.stringify({ intent: 'expense' }),
  '__FIXTURE_BAD_INTENT__': JSON.stringify({
    intent: 'drop_table', confidence: 0.99, fields: {}, missing: [], human_summary: 'x',
  }),
  '__FIXTURE_CONFIDENCE_OUT_OF_RANGE__': JSON.stringify({
    intent: 'expense', confidence: 7, fields: {}, missing: [], human_summary: 'x',
  }),
  '__FIXTURE_EMPTY__': '',
};

export const DEFAULT_FIXTURE = JSON.stringify({
  intent: 'unknown', confidence: 0,
  fields: {}, missing: [],
  human_summary: 'אין פלט מוקלט לטקסט הזה',
});
