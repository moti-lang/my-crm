'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'geo.db');

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  init(db);
  return db;
}

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      name_variants TEXT DEFAULT '[]',
      trade TEXT, city TEXT, city2 TEXT, extra TEXT, domain TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_variants TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id),
      engine TEXT NOT NULL,
      raw_text TEXT,
      screenshot_path TEXT,
      status INTEGER,
      position INTEGER,
      auto_detected INTEGER DEFAULT 1,
      verified_by_human INTEGER DEFAULT 0,
      rivals_found TEXT DEFAULT '[]',
      sources_found TEXT DEFAULT '[]',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
  `);
}

/* ---------- clients ---------- */

function upsertClient(db, c) {
  const existing = db.prepare('SELECT id FROM clients WHERE slug = ?').get(c.slug);
  if (existing) {
    db.prepare(`UPDATE clients SET name=?, name_variants=?, trade=?, city=?, city2=?, extra=?, domain=?
                WHERE id=?`)
      .run(c.name, JSON.stringify(c.nameVariants || []), c.trade, c.city, c.city2 || null,
           c.extra || null, c.domain || null, existing.id);
    db.prepare('DELETE FROM competitors WHERE client_id = ?').run(existing.id);
    db.prepare('DELETE FROM questions WHERE client_id = ?').run(existing.id);
    insertChildren(db, existing.id, c);
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO clients (slug,name,name_variants,trade,city,city2,extra,domain)
                           VALUES (?,?,?,?,?,?,?,?)`)
    .run(c.slug, c.name, JSON.stringify(c.nameVariants || []), c.trade, c.city,
         c.city2 || null, c.extra || null, c.domain || null);
  insertChildren(db, info.lastInsertRowid, c);
  return info.lastInsertRowid;
}

function insertChildren(db, clientId, c) {
  const ins = db.prepare('INSERT INTO competitors (client_id,name,name_variants) VALUES (?,?,?)');
  for (const r of (c.competitors || [])) {
    ins.run(clientId, r.name, JSON.stringify(r.variants || []));
  }
  const insQ = db.prepare('INSERT INTO questions (client_id,text,active,sort_order) VALUES (?,?,1,?)');
  (c.questions || []).forEach((q, i) => insQ.run(clientId, q, i));
}

function getClient(db, slug) {
  const c = db.prepare('SELECT * FROM clients WHERE slug = ?').get(slug);
  if (!c) return null;
  c.nameVariants = JSON.parse(c.name_variants || '[]');
  c.competitors = db.prepare('SELECT * FROM competitors WHERE client_id = ?').all(c.id)
    .map(r => ({ name: r.name, variants: JSON.parse(r.name_variants || '[]') }));
  c.questions = db.prepare('SELECT * FROM questions WHERE client_id = ? AND active = 1 ORDER BY sort_order').all(c.id);
  return c;
}

/* ---------- runs ---------- */

function newRun(db, clientId, notes) {
  return db.prepare('INSERT INTO runs (client_id, notes) VALUES (?,?)').run(clientId, notes || null).lastInsertRowid;
}

function finishRun(db, runId, status) {
  db.prepare("UPDATE runs SET finished_at = datetime('now'), status = ? WHERE id = ?").run(status || 'done', runId);
}

function saveResult(db, r) {
  return db.prepare(`INSERT INTO results
    (run_id,question_id,engine,raw_text,screenshot_path,status,position,auto_detected,rivals_found,sources_found,error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.runId, r.questionId, r.engine, r.rawText || null, r.screenshotPath || null,
         r.status === undefined ? null : r.status,
         r.position === undefined ? null : r.position,
         1, JSON.stringify(r.rivals || []), JSON.stringify(r.sources || []), r.error || null)
    .lastInsertRowid;
}

function updateResult(db, id, fields) {
  db.prepare(`UPDATE results SET status=?, position=?, verified_by_human=1 WHERE id=?`)
    .run(fields.status, fields.position === undefined ? null : fields.position, id);
}

function getRunResults(db, runId) {
  return db.prepare(`
    SELECT r.*, q.text AS question_text
    FROM results r JOIN questions q ON q.id = r.question_id
    WHERE r.run_id = ? ORDER BY q.sort_order, r.engine
  `).all(runId).map(r => ({
    ...r,
    rivals: JSON.parse(r.rivals_found || '[]'),
    sources: JSON.parse(r.sources_found || '[]'),
    questionText: r.question_text
  }));
}

function listRuns(db, slug) {
  if (slug) {
    return db.prepare(`SELECT runs.*, clients.slug FROM runs JOIN clients ON clients.id = runs.client_id
                       WHERE clients.slug = ? ORDER BY runs.id DESC`).all(slug);
  }
  return db.prepare(`SELECT runs.*, clients.slug FROM runs JOIN clients ON clients.id = runs.client_id
                     ORDER BY runs.id DESC LIMIT 30`).all();
}

function getRun(db, runId) {
  return db.prepare(`SELECT runs.*, clients.slug FROM runs JOIN clients ON clients.id = runs.client_id
                     WHERE runs.id = ?`).get(runId);
}

module.exports = {
  open, upsertClient, getClient, newRun, finishRun,
  saveResult, updateResult, getRunResults, listRuns, getRun, DB_PATH
};
