/**
 * פלטים מוקלטים לסוכן הלקוחות — להרצה יבשה ולבדיקות, בלי מפתח.
 * ההתאמה לפי הטקסט המדויק. טקסט לא מוכר → DEFAULT_ANSWER_FIXTURE
 * (אין תשובה), כך שבדיקה ששכחה להקליט לא "מצליחה" בטעות.
 */
export const ANSWER_FIXTURES: Record<string, string> = {
  'באילו סניפים החוג פועל?': JSON.stringify({
    kind: 'answer', confidence: 0.95,
    reply: 'החוג פועל בביתר עילית, מודיעין עילית, ירושלים רמות, בית שמש ואשדוד 😊',
    faq_question: 'באילו סניפים החוג פועל?', lead: null, lead_complete: false,
  }),
  'יש חוג גם לבנים?': JSON.stringify({
    kind: 'no_answer', confidence: 0.9,
    reply: 'זו שאלה טובה שאין לי עליה תשובה מדויקת — אני מעבירה אותה להניה והיא תחזור אלייך בהקדם 🙏',
    faq_question: null, lead: null, lead_complete: false,
  }),
  'כמה עולה החוג?': JSON.stringify({
    kind: 'answer', confidence: 0.92,
    reply: 'המחירים משתנים לפי סניף ומספר התשלומים. אשמח להעביר אותך להניה שתיתן לך את כל הפרטים 🙏',
    faq_question: 'כמה עולה החוג?', lead: null, lead_complete: false,
  }),
  // מודל שמפר את חוק המחירים. המערכת חייבת לתפוס את זה, לא לסמוך.
  '__FIXTURE_QUOTES_PRICE__': JSON.stringify({
    kind: 'answer', confidence: 0.9,
    reply: 'החוג עולה 2,000 ש״ח לשנה, אפשר בתשלומים 😊',
    faq_question: 'כמה עולה החוג?', lead: null, lead_complete: false,
  }),
  'אני רוצה לרשום את הבת שלי': JSON.stringify({
    kind: 'lead', confidence: 0.93,
    reply: 'איזה כיף! 😊 איך קוראים לבת שלך?',
    faq_question: 'איך נרשמים?',
    lead: { student_name: null, age: null, branch: null, parent_name: null, parent_phone: null },
    lead_complete: false,
  }),
  'קוראים לה שירה, היא בת 10, בביתר עילית, אני רחל 0521234567': JSON.stringify({
    kind: 'lead', confidence: 0.94,
    reply: 'תודה רחל! רשמתי את שירה לביתר עילית. הניה תחזור אלייך לתיאום 🌸',
    faq_question: 'איך נרשמים?',
    lead: { student_name: 'שירה', age: '10', branch: 'ביתר עילית', parent_name: 'רחל', parent_phone: '0521234567' },
    lead_complete: true,
  }),
  // ליד חלקי עם סניף אבל בלי פרטי ההורה. עדיין לא נוצרת תלמידה.
  '__FIXTURE_LEAD_PARTIAL_WITH_BRANCH__': JSON.stringify({
    kind: 'lead', confidence: 0.9,
    reply: 'נהדר, נועה בביתר עילית! בת כמה היא?',
    faq_question: 'איך נרשמים?',
    lead: { student_name: 'נועה', age: null, branch: 'ביתר עילית', parent_name: null, parent_phone: null },
    lead_complete: false,
  }),
  // ליד שהמודל מסמן כשלם אבל חסר בו סניף. המערכת לא יוצרת תלמידה.
  '__FIXTURE_LEAD_MISSING_BRANCH__': JSON.stringify({
    kind: 'lead', confidence: 0.9,
    reply: 'רשמתי! הניה תחזור אלייך.',
    faq_question: null,
    lead: { student_name: 'נועה', age: '9', branch: null, parent_name: 'מיכל', parent_phone: '0529999999' },
    lead_complete: true,
  }),
  // סניף שאינו קיים. לא ממציאים סניף.
  '__FIXTURE_LEAD_UNKNOWN_BRANCH__': JSON.stringify({
    kind: 'lead', confidence: 0.9,
    reply: 'רשמתי את נועה לחיפה!',
    faq_question: null,
    lead: { student_name: 'נועה', age: '9', branch: 'חיפה', parent_name: 'מיכל', parent_phone: '0529999999' },
    lead_complete: true,
  }),
  // ─── מקרים פגומים ───
  '__FIXTURE_MALFORMED_JSON__': '{ "kind": "answer", "reply": "בטח',
  '__FIXTURE_NOT_JSON__': 'בטח! החוג מתקיים בימי שלישי בשעה 17:00 בירושלים.',
  '__FIXTURE_BAD_KIND__': JSON.stringify({ kind: 'promise', reply: 'יש לך מקום בקבוצה!', confidence: 0.9 }),
  '__FIXTURE_TOO_LONG__': JSON.stringify({ kind: 'answer', reply: 'א'.repeat(700), confidence: 0.9 }),
  '__FIXTURE_EMPTY__': '',
};

export const DEFAULT_ANSWER_FIXTURE = JSON.stringify({
  kind: 'no_answer', confidence: 0.5,
  reply: 'זו שאלה טובה שאין לי עליה תשובה מדויקת — אני מעבירה אותה להניה והיא תחזור אלייך בהקדם 🙏',
  faq_question: null, lead: null, lead_complete: false,
});
