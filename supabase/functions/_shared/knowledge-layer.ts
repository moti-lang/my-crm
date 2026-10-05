/**
 * שכבת הסניף מעל המידע הכללי של הסוכן.
 *
 * שאלה (FAQ) או קטע מידע יכולים להיות כלליים (branch_id ריק) או של סניף.
 *  · הסניף של הפונה ידוע (תלמידה קיימת / ליד שבחר סניף / סניף פעיל יחיד):
 *    הכללי, וכל שורה של הסניף **גוברת** על שורה כללית עם אותה שאלה/כותרת.
 *    שורות של סניפים אחרים לא נכנסות.
 *  · הסניף לא ידוע: הכללי, ובנוסף שורות הסניפים — מסומנות בשם הסניף,
 *    כדי שהסוכן יענה "בבית שמש..." ולא יערבב בין סניפים.
 * הפונקציה טהורה; customer.ts (וואטסאפ) ו-ai-answer (הסימולטור) קוראים לה.
 */
export type LayerFaq = { id?: string; question: string; answer: string; branch_id?: string | null };
export type LayerKnowledge = { title: string; body: string; branch_id?: string | null };
export type LayerBranch = { id: string; name: string };

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export function layerForBranch(
  faq: LayerFaq[], knowledge: LayerKnowledge[], branches: LayerBranch[], branchId: string | null,
): { faq: { id?: string; question: string; answer: string }[]; knowledge: { title: string; body: string }[]; branchId: string | null } {
  const known = branchId && branches.some((b) => b.id === branchId) ? branchId : branches.length === 1 ? branches[0]!.id : null;
  const nameOf = new Map(branches.map((b) => [b.id, b.name]));
  const globalFaq = faq.filter((f) => !f.branch_id);
  const globalKn = knowledge.filter((k) => !k.branch_id);

  if (known) {
    const ownFaq = faq.filter((f) => f.branch_id === known);
    const ownKn = knowledge.filter((k) => k.branch_id === known);
    const overQ = new Set(ownFaq.map((f) => norm(f.question)));
    const overT = new Set(ownKn.map((k) => norm(k.title)));
    return {
      branchId: known,
      faq: [...globalFaq.filter((f) => !overQ.has(norm(f.question))), ...ownFaq].map(({ id, question, answer }) => ({ id, question, answer })),
      knowledge: [...globalKn.filter((k) => !overT.has(norm(k.title))), ...ownKn].map(({ title, body }) => ({ title, body })),
    };
  }

  const label = (id: string | null | undefined) => nameOf.get(id ?? '') ?? null;
  return {
    branchId: null,
    faq: [
      ...globalFaq.map(({ id, question, answer }) => ({ id, question, answer })),
      ...faq.filter((f) => f.branch_id && label(f.branch_id))
        .map((f) => ({ id: f.id, question: `${f.question} (סניף ${label(f.branch_id)})`, answer: f.answer })),
    ],
    knowledge: [
      ...globalKn.map(({ title, body }) => ({ title, body })),
      ...knowledge.filter((k) => k.branch_id && label(k.branch_id))
        .map((k) => ({ title: `${k.title} — סניף ${label(k.branch_id)}`, body: k.body })),
    ],
  };
}
