const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_DB_PATH = path.join(DATA_DIR, 'db', 'users.db');
const SESSION_COOKIE = 'b1tm4p_sid';

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function getUsersDb() {
  return new Database(USERS_DB_PATH, { readonly: true, fileMustExist: true });
}

function closeDb(db) {
  try { if (db && db.open) db.close(); } catch (_) {}
}

function authenticate(req, res, next) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  let db;
  try {
    db = getUsersDb();
    const row = db.prepare(`
      SELECT u.id, u.email, u.username, u.role,
             u.avatar_type, u.avatar_value, u.avatar_shape
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashSessionToken(token), Math.floor(Date.now() / 1000));

    if (!row) return res.status(401).json({ error: 'unauthorized' });
    req.user = row;
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'unauthorized' });
  } finally {
    closeDb(db);
  }
}

function optionalAuthenticate(req, _res, next) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return next();

  let db;
  try {
    db = getUsersDb();
    const row = db.prepare(`
      SELECT u.id, u.email, u.username, u.role,
             u.avatar_type, u.avatar_value, u.avatar_shape
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashSessionToken(token), Math.floor(Date.now() / 1000));
    if (row) req.user = row;
  } catch (_) {
    // Public endpoints remain public if the auth DB is unavailable.
  } finally {
    closeDb(db);
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { authenticate, optionalAuthenticate, requireRole };
