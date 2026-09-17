/**
 * נתוני דוגמה — להרצה מקומית בלבד: npx prisma db seed
 * מסרב לרוץ אם כבר יש לידים, אלא אם SEED_FORCE=1.
 */
import { prisma } from "../src/lib/db";
import { createLead } from "../src/lib/lead-service";
import { addDaysIL, dateAtIL, ymdIL } from "../src/lib/dates";
import { addDaysYmd, nextFullWorkdayYmd } from "../src/lib/hebrew-dates";

async function main() {
  const existing = await prisma.lead.count();
  if (existing > 0 && process.env.SEED_FORCE !== "1") {
    console.log(`יש כבר ${existing} לידים — לא מזריע. להכריח: SEED_FORCE=1`);
    return;
  }
  const now = new Date();
  const today = ymdIL(now);
  const iso = (ymd: string, hm = "00:00") => dateAtIL(ymd, hm).toISOString();
  const wd = (days: number) => nextFullWorkdayYmd(addDaysYmd(today, days));

  await createLead({
    descriptor: "נגריה ליד רחוב הסלע",
    area: "רחוב הסלע",
    addressNote: "בניין הסלע, קומה תחתונה",
    category: "נגרייה",
    contactName: "עדי",
    contactRole: "מנהלת",
    status: "WAITING_THEM",
    heat: "WARM",
    nextActionAt: iso(wd(5)),
    nextActionType: "VISIT",
    nextActionNote: "עדי הבטיחה לחזור ביום חמישי — לקפוץ אם לא חזרה",
    observation: "הרבה ניירת על השולחן, לוח מחיק עם הזמנות לשבועיים קדימה, 3 עובדים במפעל",
    currentTools: "מחברת + וואטסאפ",
    lat: 31.7935,
    lng: 35.1802,
    initialTouch: { type: "VISIT", summary: "נכנסתי, דיברתי עם עדי. יש להם בלגן בהזמנות. מבטיחה לחזור ביום חמישי.", withWhom: "עדי", durationMin: 10 },
  });

  await createLead({
    name: "מוסך דני",
    descriptor: "מוסך גדול בכניסה לרחוב",
    area: "רחוב הסלע",
    category: "מוסך",
    contactName: "דני",
    contactRole: "בעלים",
    phone: "052-1234567",
    status: "SCHEDULED",
    heat: "HOT",
    nextActionAt: iso(wd(1), "10:00"),
    nextActionType: "MEETING",
    nextActionNote: "פגישת אבחון — להביא דוגמת דוח",
    nextActionRemindMinutesBefore: 60,
    observation: "מנהלים הכל במחברת, 4 מכונאים, תור של רכבים בחוץ",
    painPoints: "לקוחות מתקשרים לשאול מתי הרכב מוכן, אין מעקב על חלפים שהוזמנו",
    lat: 31.7941,
    lng: 35.1795,
    initialTouch: { type: "VISIT", summary: "ישב איתי חצי שעה, מאוד מעוניין. קבענו פגישת אבחון.", withWhom: "דני", durationMin: 30, outcome: "פגישת אבחון" },
  });

  await createLead({
    name: "הסעות כרמל",
    area: "הר טוב",
    category: "הסעות",
    contactName: "משה",
    phone: "03-9876543",
    status: "WAITING_THEM",
    heat: "WARM",
    nextActionAt: iso(addDaysYmd(today, -4)),
    nextActionType: "CALL",
    nextActionNote: "משה אמר שיחזור אליי אחרי שידבר עם השותף",
    observation: "משרד קטן, מזכירה עם 3 טלפונים, לוח נהגים על הקיר",
    initialTouch: { type: "VISIT", summary: "דיברתי עם משה, מעוניין אבל צריך לדבר עם השותף", withWhom: "משה", durationMin: 15, at: iso(addDaysYmd(today, -8), "11:00") },
  });

  await createLead({
    descriptor: "חנות חלפים בקומה תחתונה",
    area: "תלפיות",
    addressNote: "מתחם המסגר, מול הכניסה לחניון",
    category: "יבוא חלפים",
    status: "NEW",
    heat: "WARM",
    nextActionAt: iso(today),
    nextActionType: "VISIT",
    nextActionNote: "לחזור כשהבעלים נמצא (בבוקר)",
    observation: "תור של 5 אנשים בקופה, פקידה רושמת הזמנות בפנקס",
    lat: 31.7512,
    lng: 35.2138,
    initialTouch: { type: "VISIT", summary: "הבעלים לא היה. הפקידה אמרה לבוא בבוקר.", at: iso(addDaysYmd(today, -2), "16:30") },
  });

  await createLead({
    name: "המסעדה של יוסי",
    area: "תלפיות",
    category: "מסעדה",
    contactName: "יוסי",
    contactRole: "בעלים",
    phone: "050-5555555",
    email: "yossi@example.com",
    status: "PROPOSED",
    heat: "HOT",
    nextActionAt: iso(wd(3)),
    nextActionType: "CALL",
    nextActionNote: "לבדוק אם עבר על ההצעה",
    observation: "משלוחים בוואטסאפ, טלפון לא מפסיק לצלצל",
    currentTools: "וואטסאפ + אקסל",
    lat: 31.7525,
    lng: 35.2151,
    initialTouch: { type: "MEETING", summary: "פגישת אבחון של שעה. שלחתי הצעה באותו יום.", withWhom: "יוסי", durationMin: 60, at: iso(addDaysYmd(today, -5), "17:00") },
  });

  const contract = await createLead({
    name: "דפוס אופסט",
    area: "הר טוב",
    category: "דפוס",
    contactName: "רונית",
    phone: "02-6543210",
    status: "CONTRACT",
    heat: "HOT",
    nextActionAt: iso(addDaysYmd(today, -1)),
    nextActionType: "CALL",
    nextActionNote: "לבדוק מה עם החתימה",
    observation: "מכונות דפוס ישנות, משרד מסודר",
    initialTouch: { type: "EMAIL", summary: "שלחתי חוזה", at: iso(addDaysYmd(today, -10), "09:00") },
  });
  await prisma.lead.update({ where: { id: contract.id }, data: { statusChangedAt: addDaysIL(now, -10) } });

  const stuck = await createLead({
    descriptor: "מסגרייה ליד הצומת",
    area: "רחוב הסלע",
    category: "מסגרייה",
    status: "TO_CLARIFY",
    heat: "COLD",
    observation: "לא ברור מה בדיוק עושים, ראיתי שערים ומעקות",
    initialTouch: { type: "VISIT", summary: "ביקור נימוס, לא היה עם מי לדבר", at: iso(addDaysYmd(today, -40), "12:00") },
  });
  await prisma.lead.update({ where: { id: stuck.id }, data: { lastTouchAt: addDaysIL(now, -40), firstSeenAt: addDaysIL(now, -40) } });

  await createLead({
    name: "משרד רו״ח כהן",
    area: "תלפיות",
    addressNote: "בניין המשרדים, קומה 3",
    category: "רואי חשבון",
    contactName: "אבי כהן",
    phone: "054-1112222",
    email: "avi@example.com",
    status: "PARKED",
    heat: "WARM",
    closedReason: "עמוסים לפני סוף שנה — לחזור אחרי החגים",
    nextActionAt: iso(wd(30)),
    nextActionType: "CALL",
    nextActionNote: "לחזור אחרי החגים",
    nextActionIsApproximate: true,
    initialTouch: { type: "CALL", summary: "שיחה קצרה, ביקש לחזור אחרי החגים", withWhom: "אבי", durationMin: 5, at: iso(addDaysYmd(today, -3), "10:00") },
  });

  await prisma.task.create({ data: { title: "להזמין כרטיסי ביקור חדשים", dueAt: dateAtIL(addDaysYmd(today, 2)), allDay: true, source: "MANUAL" } });

  console.log("נזרעו", await prisma.lead.count(), "לידים ו-", await prisma.task.count(), "משימות");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
