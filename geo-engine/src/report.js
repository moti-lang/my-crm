'use strict';

const fs = require('fs');
const path = require('path');
const DB = require('./db');
const A = require('./analyze');

const ROOT = path.join(__dirname, '..');
const ENGINE_LABEL = { chatgpt: 'ChatGPT', gemini: 'Gemini', google_aio: 'תשובות AI בגוגל' };

/**
 * זהות המשרד לדוח: לוגו, שם ופרטי קשר.
 * נטען מ-config/brand.json. אם הקובץ לא קיים — הדוח יוצא בדיוק כמו קודם.
 *
 * הלוגו מוטמע כ-data URI ולא כנתיב: ה-PDF נבנה מ-HTML בזיכרון, וקישור
 * לקובץ מקומי לא ייטען בו. גם ה-HTML נשאר עצמאי וניתן לשליחה כמו שהוא.
 */
function loadBrand() {
  const file = path.join(ROOT, 'config', 'brand.json');
  if (!fs.existsSync(file)) return null;

  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('config/brand.json אינו JSON תקין: ' + e.message); }

  if (b.logo) {
    const lp = path.isAbsolute(b.logo) ? b.logo : path.join(ROOT, b.logo);
    if (!fs.existsSync(lp)) {
      console.log('⚠ הלוגו לא נמצא: ' + lp + ' — הדוח ייווצר בלעדיו.');
    } else {
      const ext = path.extname(lp).toLowerCase();
      const mime = ext === '.svg' ? 'image/svg+xml'
                 : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
                 : ext === '.webp' ? 'image/webp' : 'image/png';
      const bytes = fs.readFileSync(lp);
      if (bytes.length > 600 * 1024) {
        console.log('⚠ הלוגו גדול (' + Math.round(bytes.length / 1024) + 'KB) ומנפח את ה-PDF. שווה לכווץ אותו.');
      }
      b.logoData = 'data:' + mime + ';base64,' + bytes.toString('base64');
    }
  }
  return b;
}

/** פרטי הקשר כשורה אחת, רק מה שמולא */
function brandContact(b) {
  return [b.phone, b.email, b.site].filter(Boolean).join(' · ');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pct(x) { return Math.round(x * 100) + '%'; }

/* ---------- השוואה בין מדידות ---------- */

// זוג מתבדר: השתפר מול הידרדר. שני הגוונים עברו את בדיקת הפלטה מול רקע בהיר
// (הפרדה לעיוורי צבעים ΔE 11.7, ניגודיות מעל 3:1), והכיוון מסומן גם במספר
// ובחץ ולא בצבע בלבד.
const UP = '#00897B', DOWN = '#C25F1E', FLAT = '#5A6379', PREV = '#98A2B8';

function delta(now, before) {
  const d = Math.round(now * 100) - Math.round(before * 100);
  return { n: d, sign: d > 0 ? '▲' : d < 0 ? '▼' : '=', color: d > 0 ? UP : d < 0 ? DOWN : FLAT,
           text: (d > 0 ? '+' : '') + d };
}

/**
 * דמבל: שתי נקודות על ציר משותף וקו ביניהן.
 * עם שתי מדידות בלבד, קו מגמה הוא שתי נקודות ותו לא — הדמבל מראה
 * את שני הערכים ואת גודל השינוי במבט אחד, וגם נדפס היטב.
 * הציר מימין לשמאל, כמו שאר המסמך.
 */
function dumbbell(metrics) {
  const W = 680, ROW = 52, TOP = 34, H = TOP + metrics.length * ROW + 16;
  const X0 = 500, X1 = 90;               // 0% מימין, 100% משמאל
  const x = (v) => X0 - (v * (X0 - X1));

  // direction=ltr הכרחי: המסמך כולו RTL, ובתוך SVG התכונה text-anchor
  // מתייחסת לכיוון הכתיבה ולא לגאומטריה — בלי זה התוויות נמתחות אל מחוץ
  // למסגרת ונחתכות. הטקסט העברי עצמו עדיין נכתב מימין לשמאל.
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" direction="ltr" role="img" aria-label="השוואת מדדים בין שתי המדידות">`;

  for (let t = 0; t <= 100; t += 25) {
    const gx = x(t / 100);
    g += `<line x1="${gx}" y1="${TOP - 12}" x2="${gx}" y2="${H - 18}" stroke="#E8ECF2" stroke-width="1"/>`
       + `<text x="${gx}" y="${H - 4}" font-size="10" fill="#8E9AB4" text-anchor="middle">${t}%</text>`;
  }

  metrics.forEach((m, i) => {
    const y = TOP + i * ROW + 12;
    const xa = x(m.before), xb = x(m.now);
    const d = delta(m.now, m.before);
    g += `<text x="${W - 10}" y="${y + 4}" font-size="12.5" fill="#12172B" text-anchor="end">${esc(m.label)}</text>`;
    if (Math.abs(xa - xb) > 1) {
      g += `<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="${d.color}" stroke-width="2" stroke-linecap="round"/>`;
    }
    g += `<circle cx="${xa}" cy="${y}" r="5" fill="#fff" stroke="${PREV}" stroke-width="2"/>`
       + `<circle cx="${xb}" cy="${y}" r="5.5" fill="${d.color}" stroke="#fff" stroke-width="2"/>`
       + `<text x="${x(m.now)}" y="${y - 11}" font-size="11.5" font-weight="700" fill="#12172B" text-anchor="middle">${pct(m.now)}</text>`
       + `<text x="${W - 10}" y="${y + 20}" font-size="11" fill="${d.color}" text-anchor="end">${d.sign} ${d.text} נקודות אחוז</text>`;
  });

  g += `</svg>`;
  return g;
}

/** ניסוח כמות בעברית תקינה: "מנוע אחד" ולא "1 מנועים" */
function count(n, one, many) { return n === 1 ? one : n + ' ' + many; }

/** תיאור מקור הנתונים בכותרת: ריצה אחת או איחוד של כמה */
function runsLabel(runs) {
  const dates = runs.map(r => String(r.started_at || '').slice(0, 10)).filter(Boolean);
  const uniq = [];
  for (const d of dates) if (uniq.indexOf(d) === -1) uniq.push(d);
  uniq.sort();
  const when = uniq.length <= 1 ? (uniq[0] || '') : (uniq[0] + ' עד ' + uniq[uniq.length - 1]);
  return runs.length === 1 ? ('ריצה #' + runs[0].id + ' · ' + when) : when;
}

function buildHtml(client, runs, rows, s, prev, brand) {
  if (!Array.isArray(runs)) runs = [runs];
  // המשפט הזה הוא הדבר הראשון שהלקוח קורא, ולכן הוא חייב לתאר את המספרים
  // שמעליו ולא רק את הטווח שאליו נפל הציון. ציון 66 עם 87% הופעה אינו
  // "מפסיד את רוב השאלות" — זו סתירה גלויה שהורסת אמון בדוח כולו.
  let verdict;
  if (s.pAppear < 0.4) {
    verdict = 'נראות נמוכה. ברוב השאלות שלקוח אמיתי שואל, העסק לא עולה כלל.';
  } else if (s.pAppear < 0.7) {
    verdict = 'נראות חלקית. העסק עולה בחלק מהשאלות ונעדר מאחרות, והפער בין השתיים הוא העבודה.';
  } else if (s.pDirect < 0.25) {
    verdict = 'נוכחות רחבה, המלצה נדירה. העסק עולה כמעט בכל השאלות, אבל המנועים ממעטים להמליץ עליו במפורש — וזה הפער.';
  } else if (s.pTop3 < 0.7) {
    verdict = 'העסק עולה כמעט בכל השאלות, אך לרוב לא בראש הרשימה. המיקוד הוא לעלות במיקום.';
  } else {
    verdict = 'נראות חזקה. העסק עולה כמעט בכל השאלות וגם בראש הרשימה. המיקוד הוא שמירה על המצב והרחבה לשאלות נוספות.';
  }

  // מיפוי שאלה → מנוע
  const byQ = {};
  for (const r of rows) {
    if (!byQ[r.questionText]) byQ[r.questionText] = {};
    byQ[r.questionText][r.engine] = r;
  }
  const engines = Object.keys(ENGINE_LABEL).filter(e => rows.some(r => r.engine === e));

  const mark = (r) => {
    if (!r) return '·';
    if (r.status === null || r.status === undefined) return '—';
    return r.status === 0 ? '✗' : r.status === 3 ? '★' : r.status === 2 ? '▲' : '•';
  };

  let h = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>דוח נראות — ${esc(client.name)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Arial Hebrew","Noto Sans Hebrew",Arial,sans-serif;color:#12172B;direction:rtl;line-height:1.6;font-size:11pt}
h1{font-size:20pt;font-weight:900}
h2{font-size:14pt;margin-top:18px;margin-bottom:6px}
.muted{color:#5A6379;font-size:10pt}
.score{background:#12172B;color:#fff;border-radius:12px;padding:20px;text-align:center;margin-top:14px}
.score .n{font-size:46pt;font-weight:900;color:#00C2A8;line-height:1}
.score .of{color:#8E9AB4;font-size:10pt;margin-top:4px}
.score .v{color:#D5DCE6;margin-top:10px;font-size:11pt}
.metrics{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.m{flex:1 1 120px;background:#F4F6F9;border-radius:9px;padding:12px}
.m .n{font-size:18pt;font-weight:900}
.m .l{font-size:9pt;color:#5A6379;margin-top:3px}
.m.hi .n{color:#E07B39}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:10pt}
th,td{text-align:right;padding:6px 5px;border-bottom:1px solid #DDE3EC;vertical-align:top}
th{font-size:9.5pt;color:#5A6379}
.note{background:#F4F6F9;border-radius:9px;padding:12px;font-size:10pt;color:#5A6379;margin-top:12px}
ul{margin-right:18px}
li{margin-top:4px}
.brandbar{display:flex;align-items:center;gap:11px;margin-bottom:14px}
.brandbar .logo{max-height:44px;max-width:190px;width:auto;height:auto}
.brandbar .bname{font-weight:900;font-size:12pt;line-height:1.25}
.brandbar .bname span{display:block;font-weight:400;font-size:9pt;color:#5A6379;margin-top:1px}
.brandfoot{margin-top:26px;padding-top:12px;border-top:1px solid #DDE3EC;font-size:9.5pt;color:#5A6379;display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}
.brandfoot b{color:#12172B;font-size:10pt}
</style></head><body>`;

  if (brand && (brand.logoData || brand.name)) {
    h += `<div class="brandbar">`;
    if (brand.logoData) h += `<img class="logo" src="${brand.logoData}" alt="${esc(brand.name || '')}">`;
    if (brand.name) {
      h += `<div class="bname">${esc(brand.name)}`
         + (brand.tagline ? `<span>${esc(brand.tagline)}</span>` : '')
         + `</div>`;
    }
    h += `</div>`;
  }

  h += `<h1>דוח נראות במנועי AI</h1>
<div class="muted">${esc(client.name)} · ${esc(client.trade)} · ${esc(client.city)}${client.city2 ? ' ו' + esc(client.city2) : ''} · ${esc(runsLabel(runs))}</div>`;

  const scoreDelta = prev ? (s.score - prev.s.score) : null;
  h += `<div class="score"><div class="n">${s.score}</div><div class="of">מתוך 100`
     + (scoreDelta === null ? '' :
        ` · <span style="color:${scoreDelta > 0 ? '#4ADFC8' : scoreDelta < 0 ? '#F0A16A' : '#8E9AB4'}">`
        + `${scoreDelta > 0 ? '▲ +' : scoreDelta < 0 ? '▼ ' : '= '}${scoreDelta !== 0 ? scoreDelta : ''} מהמדידה הקודמת</span>`)
     + `</div><div class="v">${verdict}</div></div>`;

  h += `<div class="metrics">
<div class="m"><div class="n">${pct(s.pAppear)}</div><div class="l">הופעה בתשובות</div></div>
<div class="m"><div class="n">${pct(s.pTop3)}</div><div class="l">בשלושת הראשונים</div></div>
<div class="m"><div class="n">${pct(s.pDirect)}</div><div class="l">המלצה ישירה</div></div>`;
  // המכפיל הוא יחס בין הופעות המתחרים להופעות העסק. מתחת ל-1 המשמעות הפוכה,
  // ולכן גם המספר וגם הכיתוב מוצגים בכיוון שמתאים למציאות.
  if (s.multiplier === null) {
    h += `<div class="m hi"><div class="n">—</div><div class="l">המתחרים הופיעו ${s.rivalTotal} פעמים, העסק אף פעם</div></div>`;
  } else if (s.multiplier > 1) {
    h += `<div class="m hi"><div class="n">פי ${Math.round(s.multiplier * 10) / 10}</div><div class="l">המתחרים מופיעים יותר ממך</div></div>`;
  } else if (s.multiplier < 1) {
    h += `<div class="m"><div class="n">פי ${Math.round((1 / s.multiplier) * 10) / 10}</div><div class="l">אתה מופיע יותר מהמתחרים</div></div>`;
  } else {
    h += `<div class="m"><div class="n">שוויון</div><div class="l">אתה והמתחרים מופיעים אותו מספר פעמים</div></div>`;
  }
  h += `</div>`;

  const skipped = rows.length - s.measured;
  h += `<div class="note">הבדיקה כללה ${count(Object.keys(byQ).length, 'שאלה אחת', 'שאלות')} על ${count(engines.length, 'מנוע אחד', 'מנועים')}. נמדדו בפועל ${count(s.measured, 'תא אחד', 'תאים')}${skipped > 0 ? ` (${count(skipped, 'תא אחד לא נמדד', 'תאים לא נמדדו')} — לא הוצג בלוק AI או אירעה שגיאה, ואינם נספרים בציון)` : ''}. חישוב הציון: 40% הופעה, 30% מיקום בשלושת הראשונים, 30% המלצה ישירה.</div>`;

  if (prev) {
    h += `<h2>מה השתנה מאז המדידה הקודמת</h2>`;
    h += `<div class="muted" style="margin-bottom:8px">מדידה קודמת: ${esc(runsLabel(prev.runs))} · ${count(prev.s.measured, 'תא אחד', 'תאים')} · ציון ${prev.s.score}</div>`;
    h += `<div style="border:1px solid #DDE3EC;border-radius:9px;padding:10px 6px 4px;margin-top:8px">`
       + dumbbell([
           { label: 'הופעה בתשובות',   before: prev.s.pAppear, now: s.pAppear },
           { label: 'בשלושת הראשונים', before: prev.s.pTop3,   now: s.pTop3 },
           { label: 'המלצה ישירה',     before: prev.s.pDirect, now: s.pDirect }
         ])
       + `<div style="font-size:9.5pt;color:#5A6379;padding:0 10px 6px;text-align:right">`
       + `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid ${PREV};background:#fff;margin-left:5px"></span>המדידה הקודמת`
       + `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${UP};margin:0 14px 0 5px"></span>המדידה הנוכחית`
       + `</div></div>`;

    // מה באמת זז: שאלה-מנוע שהסיווג שלה השתנה. זה החלק שאפשר לפעול לפיו,
    // בניגוד לאחוזים שמסכמים אותו.
    const label = (v) => v === null || v === undefined ? 'לא נמדד'
      : v === 0 ? 'לא מופיע' : v === 1 ? 'מוזכר' : v === 2 ? 'בשלושת הראשונים' : 'מומלץ במפורש';
    const before = {};
    for (const r of prev.rows) before[r.questionText + '\u0000' + r.engine] = r.status;

    const moved = [];
    for (const r of rows) {
      const k = r.questionText + '\u0000' + r.engine;
      if (!(k in before)) continue;
      const b = before[k], n = r.status;
      if (b === n) continue;
      const bn = (b === null || b === undefined) ? -1 : b;
      const nn = (n === null || n === undefined) ? -1 : n;
      moved.push({ q: r.questionText, engine: r.engine, from: b, to: n, up: nn > bn });
    }
    moved.sort((a, b) => (a.up === b.up) ? 0 : (a.up ? -1 : 1));

    if (moved.length) {
      h += `<table><tr><th>שאלה</th><th>מנוע</th><th>קודם</th><th>עכשיו</th></tr>`;
      for (const m of moved.slice(0, 14)) {
        h += `<tr><td>${esc(m.q)}</td><td>${esc(ENGINE_LABEL[m.engine] || m.engine)}</td>`
           + `<td style="color:#5A6379">${esc(label(m.from))}</td>`
           + `<td style="color:${m.up ? UP : DOWN};font-weight:700">${m.up ? '▲' : '▼'} ${esc(label(m.to))}</td></tr>`;
      }
      h += `</table>`;
    } else {
      h += `<div class="note">אף תוצאה לא שינתה סיווג בין שתי המדידות. יציבות היא ממצא בפני עצמו — תשובות של מודלים משתנות מטבען, וחוסר תזוזה אומר שהתמונה אמיתית ולא רעש.</div>`;
    }
  }

  // דוח על כמה מנועים שנותן ציון אחד בלבד מסתיר את כל הסיפור:
  // אותו עסק יכול להיות ראשון בגוגל ונעדר ב-ChatGPT.
  if (engines.length > 1) {
    h += `<h2>לפי מנוע</h2><table>
<tr><th>מנוע</th><th>הופעה</th><th>בשלושת הראשונים</th><th>המלצה ישירה</th><th>ציון</th></tr>`;
    for (const e of engines) {
      const es = A.score(rows.filter(r => r.engine === e));
      h += `<tr><td>${esc(ENGINE_LABEL[e] || e)}</td><td>${pct(es.pAppear)}</td>`
         + `<td>${pct(es.pTop3)}</td><td>${pct(es.pDirect)}</td>`
         + `<td><b>${es.score}</b></td></tr>`;
    }
    h += `</table><div class="muted" style="margin-top:6px">כל מנוע שואב מידע ממקורות אחרים ומנסח אחרת, ולכן אותו עסק יכול להיות בולט באחד ונעדר באחר. הפער בין השורות הוא לרוב הכיוון לעבודה.</div>`;
  }

  if (s.rivalTally.length) {
    h += `<h2>מי תופס את המקום שלך</h2><table><tr><th>מתחרה</th><th>הופעות</th></tr>`;
    for (const [name, n] of s.rivalTally.slice(0, 10)) h += `<tr><td>${esc(name)}</td><td>${n}</td></tr>`;
    h += `</table>`;
  }

  // האתר של הלקוח עצמו חייב להיות מופרד משאר המקורות. אחרת הוא יושב בראש
  // טבלה שכתוב מתחתיה "אלה המקומות שצריך להיות בהם" — סתירה גלויה, ועוד
  // כזאת שמבזבזת ממצא טוב: ציטוט חוזר של האתר הוא הישג, לא משימה.
  const own = String(client.domain || '').replace(/^www\./, '').toLowerCase();
  const isOwn = (d) => own && (d === own || d.endsWith('.' + own));
  const ownCites = s.sourceTally.filter(([d]) => isOwn(d)).reduce((a, x) => a + x[1], 0);
  const thirdParty = s.sourceTally.filter(([d]) => !isOwn(d));

  if (ownCites > 0) {
    h += `<h2>האתר שלך כמקור</h2><div class="note">המודלים ציטטו את <b>${esc(own)}</b> ${count(ownCites, 'פעם אחת', 'פעמים')} בתשובות שנבדקו. משמעות הדבר שהאתר עצמו נקרא ומשמש מקור מידע — וזו נקודת פתיחה טובה. ${thirdParty.length ? 'הטבלה שלמטה היא המקורות החיצוניים, ושם נמצאת העבודה.' : ''}</div>`;
  }

  if (thirdParty.length) {
    h += `<h2>מאיפה עוד המודלים שואבים מידע בתחום הזה</h2><table><tr><th>מקור</th><th>ציטוטים</th></tr>`;
    for (const [d, n] of thirdParty.slice(0, 12)) h += `<tr><td>${esc(d)}</td><td>${n}</td></tr>`;
    h += `</table><div class="muted" style="margin-top:6px">אלה מקומות שאינם בשליטתך, והמודלים חוזרים אליהם. נוכחות מדויקת ומעודכנת שם משפיעה על התשובות יותר מכל שינוי באתר.</div>`;
  }

  h += `<h2>פירוט לפי שאלה</h2><table><tr><th>שאלה</th>`;
  for (const e of engines) h += `<th>${esc(ENGINE_LABEL[e])}</th>`;
  h += `</tr>`;
  for (const q of Object.keys(byQ)) {
    h += `<tr><td>${esc(q)}</td>`;
    for (const e of engines) h += `<td style="text-align:center">${mark(byQ[q][e])}</td>`;
    h += `</tr>`;
  }
  h += `</table><div class="muted" style="margin-top:6px">✗ לא מופיע · • מוזכר · ▲ בשלושת הראשונים · ★ מומלץ במפורש · — לא נמדד</div>`;

  if (s.gaps.length) {
    h += `<h2>השאלות שבהן העסק לא מופיע כלל</h2><ul>`;
    for (const g of s.gaps) h += `<li>${esc(g)}</li>`;
    h += `</ul><div class="muted">אלה העדיפויות לעבודה. כל שאלה כזאת היא לקוח שהלך למתחרה.</div>`;
  }

  h += `<h2>הערה על השיטה</h2><div class="muted">הבדיקה בוצעה בצ׳אט זמני ובסביבה מבודדת, כדי למנוע הטיה מהיסטוריית שימוש. תשובות של מודלים משתנות מטבען גם ללא שינוי מצד העסק, ולכן המדידה חוזרת אחת לחודש על אותו מערך שאלות. אין דרך להבטיח הופעה או מיקום בתשובות AI — המטרה היא להגדיל את הסיכוי להופעה ולציטוט.</div>`;

  if (brand && (brand.name || brandContact(brand))) {
    h += `<div class="brandfoot">`
       + (brand.name ? `<b>${esc(brand.name)}</b>` : '')
       + (brandContact(brand) ? `<span>${esc(brandContact(brand))}</span>` : '')
       + `</div>`;
  }

  h += `</body></html>`;
  return h;
}

async function generate(runIds, opts) {
  opts = opts || {};
  const ids = (Array.isArray(runIds) ? runIds : [runIds])
    .map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) throw new Error('לא צוין מזהה ריצה.');

  const db = DB.open();
  const runs = [];
  const rows = [];
  for (const id of ids) {
    const run = DB.getRun(db, id);
    if (!run) { db.close(); throw new Error('ריצה לא נמצאה: ' + id); }
    runs.push(run);
    for (const r of DB.getRunResults(db, id)) rows.push(r);
  }

  // דוח אחד על שני לקוחות שונים הוא חסר משמעות, ולא בטוח שהיה מכוון
  const slugs = [];
  for (const r of runs) if (slugs.indexOf(r.slug) === -1) slugs.push(r.slug);
  if (slugs.length > 1) {
    db.close();
    throw new Error('כל הריצות חייבות להיות של אותו לקוח. קיבלתי: ' + slugs.join(', '));
  }

  const client = DB.getClient(db, runs[0].slug);
  db.close();
  if (!rows.length) throw new Error('אין תוצאות בריצות האלה.');

  // אותה שאלה באותו מנוע בשתי ריצות — לוקחים את המאוחרת, אחרת התא נספר פעמיים
  const seen = {};
  const merged = [];
  for (const r of rows) {
    const key = r.questionText + '\u0000' + r.engine;
    if (seen[key] === undefined) { seen[key] = merged.length; merged.push(r); }
    else if (r.id > merged[seen[key]].id) { merged[seen[key]] = r; }
  }

  let prev = null;
  if (opts.vs && opts.vs.length) {
    const pdb = DB.open();
    const pruns = [], prows = [];
    for (const id of opts.vs) {
      const run = pdb.prepare('SELECT runs.*, clients.slug FROM runs JOIN clients ON clients.id = runs.client_id WHERE runs.id = ?').get(id);
      if (!run) { pdb.close(); throw new Error('ריצת ההשוואה לא נמצאה: ' + id); }
      if (run.slug !== runs[0].slug) { pdb.close(); throw new Error('ריצת ההשוואה ' + id + ' שייכת ללקוח אחר.'); }
      pruns.push(run);
      for (const r of DB.getRunResults(pdb, id)) prows.push(r);
    }
    pdb.close();
    if (prows.length) prev = { runs: pruns, rows: prows, s: A.score(prows) };
  }

  const s = A.score(merged);
  const html = buildHtml(client, runs, merged, s, prev, loadBrand());

  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = ids.length === 1
    ? `${client.slug}-run${ids[0]}`
    : `${client.slug}-runs-${ids.join('-')}`;
  const htmlPath = path.join(dir, base + '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  let pdfPath = null;
  if (opts.pdf !== false) {
    let browser = null;
    try {
      const { chromium } = require('playwright');
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const target = path.join(dir, base + '.pdf');
      await page.pdf({ path: target, format: 'A4', printBackground: true });
      // רק אחרי שהקובץ באמת נכתב — אחרת נדפיס נתיב לקובץ שאינו קיים
      pdfPath = target;
    } catch (e) {
      console.log('יצירת ה-PDF נכשלה (ה-HTML נוצר בהצלחה): ' + e.message);
      console.log('אפשר לפתוח את ה-HTML בדפדפן ולהדפיס אותו ל-PDF.');
    } finally {
      if (browser) { try { await browser.close(); } catch (e) { /* כבר נסגר */ } }
    }
  }

  console.log('\nדוח נוצר:');
  console.log('  ' + htmlPath);
  if (pdfPath) console.log('  ' + pdfPath);
  console.log(`\n  ציון: ${s.score}/100 · נמדדו ${s.measured} תאים · הופעה ${pct(s.pAppear)}\n`);
  return { htmlPath, pdfPath, score: s };
}

module.exports = { generate, buildHtml, count, runsLabel, loadBrand, brandContact };
