const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_DB_PATH = path.join(DATA_DIR, 'db', 'users.db');
const TAGS_DB_PATH = path.join(DATA_DIR, 'db', 'tags.db');

let usersDb = null;
let tagsDb = null;
let usersMtime = 0;
let tagsMtime = 0;

function tryOpen(pathname, current, readonly) {
  if (!fs.existsSync(pathname)) return null;
  try {
    const stat = fs.statSync(pathname);
    const mtime = stat.mtimeMs;
    if (current && current.__mtime === mtime && current.open) return current;
    if (current && current.open) {
      try { current.close(); } catch (_) {}
    }
    const db = new Database(pathname, { readonly, fileMustExist: true });
    db.pragma('query_only = ON');
    return Object.assign(db, { __mtime: mtime });
  } catch (_) {
    return null;
  }
}

function getUsersDb() {
  const opened = tryOpen(USERS_DB_PATH, usersDb, true);
  if (opened) usersDb = opened;
  return usersDb;
}

function getTagsDb() {
  const opened = tryOpen(TAGS_DB_PATH, tagsDb, true);
  if (opened) tagsDb = opened;
  return tagsDb;
}

function requireUsersDb() {
  const db = getUsersDb();
  if (!db) {
    const err = new Error('users database unavailable');
    err.code = 'DEPENDENCY_DB_UNAVAILABLE';
    throw err;
  }
  return db;
}

function requireTagsDb() {
  const db = getTagsDb();
  if (!db) {
    const err = new Error('tags database unavailable');
    err.code = 'DEPENDENCY_DB_UNAVAILABLE';
    throw err;
  }
  return db;
}

function getUsersByIds(ids) {
  const unique = [...new Set(ids.filter(Number.isInteger))];
  if (!unique.length) return new Map();
  const db = requireUsersDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, username, avatar_type, avatar_value, avatar_shape, avatar_color
    FROM users WHERE id IN (${placeholders})
  `).all(...unique);
  return new Map(rows.map(r => [r.id, r]));
}

function getUserById(id) {
  if (!Number.isInteger(id)) return null;
  return getUsersByIds([id]).get(id) || null;
}

function getTagsByIds(ids) {
  const unique = [...new Set(ids.filter(Number.isInteger))];
  if (!unique.length) return new Map();
  const db = requireTagsDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, master_tag_id, name, slug
    FROM tags WHERE id IN (${placeholders})
  `).all(...unique);
  return new Map(rows.map(r => [r.id, r]));
}

function getMastersByIds(ids) {
  const unique = [...new Set(ids.filter(Number.isInteger))];
  if (!unique.length) return new Map();
  const db = requireTagsDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, name, slug, header_image_path, description
    FROM master_tags WHERE id IN (${placeholders})
  `).all(...unique);
  return new Map(rows.map(r => [r.id, r]));
}

function getMasterBySlug(slug) {
  const db = requireTagsDb();
  return db.prepare(`
    SELECT id, name, slug, header_image_path, description
    FROM master_tags WHERE slug = ?
  `).get(slug) || null;
}

function getTagBySlug(masterTagId, slug) {
  const db = requireTagsDb();
  return db.prepare(`
    SELECT id, master_tag_id, name, slug
    FROM tags WHERE master_tag_id = ? AND slug = ?
  `).get(masterTagId, slug) || null;
}

function validateTagPair(masterTagId, tagId) {
  const db = requireTagsDb();
  const row = db.prepare(`
    SELECT t.id, t.master_tag_id, t.name, t.slug,
           m.name AS master_name, m.slug AS master_slug
    FROM tags t
    JOIN master_tags m ON m.id = t.master_tag_id
    WHERE t.id = ? AND t.master_tag_id = ?
  `).get(tagId, masterTagId);
  return row || null;
}

function searchTagIds(term) {
  const db = requireTagsDb();
  const q = `%${term.toLowerCase()}%`;
  const tags = db.prepare(`
    SELECT t.id
    FROM tags t
    JOIN master_tags m ON m.id = t.master_tag_id
    WHERE LOWER(t.name) LIKE ?
       OR LOWER(t.slug) LIKE ?
       OR LOWER(m.name) LIKE ?
       OR LOWER(m.slug) LIKE ?
  `).all(q, q, q, q);
  return tags.map(r => r.id);
}

function searchUserIds(term) {
  const db = requireUsersDb();
  const q = `%${term.toLowerCase()}%`;
  const users = db.prepare(`
    SELECT id FROM users WHERE LOWER(username) LIKE ?
  `).all(q);
  return users.map(r => r.id);
}

function closeCrossDbConnections() {
  if (usersDb && usersDb.open) usersDb.close();
  if (tagsDb && tagsDb.open) tagsDb.close();
  usersDb = null;
  tagsDb = null;
}

module.exports = {
  USERS_DB_PATH,
  TAGS_DB_PATH,
  getUsersDb,
  getTagsDb,
  requireUsersDb,
  requireTagsDb,
  getUsersByIds,
  getUserById,
  getTagsByIds,
  getMastersByIds,
  getMasterBySlug,
  getTagBySlug,
  validateTagPair,
  searchTagIds,
  searchUserIds,
  closeCrossDbConnections
};
