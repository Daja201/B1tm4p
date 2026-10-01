const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_DIR = path.join(DATA_DIR, 'db');
const CONTENT_DB_PATH = path.join(DB_DIR, 'content.db');
const REPORTS_DB_PATH = path.join(DB_DIR, 'reports.db');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function openDatabase(filePath) {
  ensureDir(path.dirname(filePath));
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function applySchema(db, schemaFile) {
  const sql = fs.readFileSync(schemaFile, 'utf8');
  db.exec(sql);
}

function initContentDb() {
  const db = openDatabase(CONTENT_DB_PATH);
  applySchema(db, path.join(__dirname, '..', 'db', 'schema_content.sql'));
  return db;
}

function initReportsDb() {
  const db = openDatabase(REPORTS_DB_PATH);
  applySchema(db, path.join(__dirname, '..', 'db', 'schema_reports.sql'));
  return db;
}

module.exports = {
  DATA_DIR,
  DB_DIR,
  CONTENT_DB_PATH,
  REPORTS_DB_PATH,
  initContentDb,
  initReportsDb
};
