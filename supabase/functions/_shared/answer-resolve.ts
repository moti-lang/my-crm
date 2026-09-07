import { NO_ANSWER_REPLY, quotesPrice, promisesPlaceOrDiscount, type AgentAnswer, type AnswerSource } from './answer-schema.ts';

/**
 * מה באמת יוצא להורה — סדר העדיפות והשומרים, נאכפים בקוד:
 *   1. שאלה תואמת במאגר → התשובה מהמאגר, מילה במילה. המאגר גובר.
 *   2. אחרת, תשובה מתוך "מידע על החוג" — רק אם יש מידע, והמודל הצביע
 *      על קטע קיים (כותרת). בלי עיגון — זו המצאה → אין תשובה.
 *   3. אין תשובה בשניהם → המשפט הקבוע והעברה לבעלים.
 * על תשובה מהמידע החופשי חלים גם: אין מחירים כשהמתג כבוי, אין הבטחת
 * מקום או הנחה. תשובת מאגר פטורה מהשומרים — הבעלים ניסחה אותה בעצמה.
 *
 * ⚠️ בלי מסד: רץ גם ב-customer.ts (וואטסאפ) וגם ב-ai-answer (הסימולטור),
 * כדי שהסימולטור יראה בדיוק מה היה נשלח.
 */
export type ResolveInput = {
  faq: { question: string; answer: string }[];
  knowledge: { title: string; body: string }[];
  mayQuotePrices: boolean;
};

export type Blocked = 'price' | 'promise' | 'ungrounded' | null;

export type Resolved = {
  reply: string;
  /** מאיפה התשובה שיוצאת בפועל; null = המשפט הקבוע */
  source: AnswerSource | null;
  faqQuestion: string | null;
  knowledgeTitle: string | null;
  /** מה נחסם בדרך, אם נחסם */
  blocked: Blocked;
  /** התשובה כפי שהמודל ניסח, לפני השומרים */
  original: string;
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function resolveAnswer(answer: AgentAnswer, input: ResolveInput): Resolved {
  const original = answer.reply;
  const noAnswer = (blocked: Blocked): Resolved =>
    ({ reply: NO_ANSWER_REPLY, source: null, faqQuestion: null, knowledgeTitle: null, blocked, original });

  if (answer.kind === 'no_answer') return noAnswer(null);
  if (answer.kind === 'lead') {
    // שיחת הרשמה: הניסוח של המודל, אבל בלי מחירים כשהמתג כבוי.
    if (!input.mayQuotePrices && quotesPrice(answer.reply)) {
      const priceFaq = input.faq.find((f) => /מחיר|עולה|עלות/.test(f.question));
      return { reply: priceFaq?.answer ?? NO_ANSWER_REPLY, source: null, faqQuestion: null, knowledgeTitle: null, blocked: 'price', original };
    }
    return { reply: answer.reply, source: null, faqQuestion: null, knowledgeTitle: null, blocked: null, original };
  }

  // 1. המאגר גובר — התשובה מהמאגר מילה במילה.
  const hit = answer.faq_question ? input.faq.find((f) => norm(f.question) === norm(answer.faq_question as string)) : null;
  if (hit) {
    // המאגר גובר גם על ניסיון של המודל לנקוב מחיר — אבל הבעלים תדע שניסה.
    const triedPrice = !input.mayQuotePrices && quotesPrice(answer.reply);
    return { reply: hit.answer, source: 'faq', faqQuestion: hit.question, knowledgeTitle: null, blocked: triedPrice ? 'price' : null, original };
  }

  // 2. המידע על החוג — רק כשיש מידע והמודל הצביע על קטע קיים.
  const section = answer.knowledge_title
    ? input.knowledge.find((k) => norm(k.title) === norm(answer.knowledge_title as string)) : null;
  if (!section) return noAnswer('ungrounded');

  // השומרים, בקוד: מחיר (כשהמתג כבוי), הבטחת מקום או הנחה.
  if (!input.mayQuotePrices && quotesPrice(answer.reply)) {
    const priceFaq = input.faq.find((f) => /מחיר|עולה|עלות/.test(f.question));
    return { reply: priceFaq?.answer ?? NO_ANSWER_REPLY, source: priceFaq ? 'faq' : null,
             faqQuestion: priceFaq?.question ?? null, knowledgeTitle: null, blocked: 'price', original };
  }
  if (promisesPlaceOrDiscount(answer.reply)) return noAnswer('promise');

  return { reply: answer.reply, source: 'knowledge', faqQuestion: null, knowledgeTitle: section.title, blocked: null, original };
}
