const express = require('express');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const {
  validateTagPair,
  getUsersByIds,
  getTagsByIds,
  getMastersByIds,
  getMasterBySlug,
  getTagBySlug,
  searchTagIds,
  searchUserIds
} = require('../lib/crossDb');
const {
  upload,
  persistUploadedFile,
  deletePublicMediaPath
} = require('../lib/uploads');

function now() {
  return (Date.now() / 1000) | 0;
}

function intParam(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanOptionalText(value, max = 20000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  return value.slice(0, max);
}

function normalizeBodyInput(body, isReply, hasFile) {
  const bodyType = body.body_type;
  if (!['text', 'image', 'sound', 'video'].includes(bodyType)) {
    return { error: 'invalid_body_type' };
  }
  const bodyText = cleanOptionalText(body.body_text);
  const headerTitle = cleanOptionalText(body.header_title, 500);
  if (bodyType === 'text' && !bodyText) return { error: 'invalid_input' };
  if (bodyType !== 'text' && !hasFile) return { error: 'invalid_input' };
  if (!isReply && (!body.master_tag_id || !body.tag_id)) return { error: 'invalid_input' };
  return { bodyType, bodyText, headerTitle };
}

// Recognizes a handful of common date/time spellings typed into the search
// box (ISO, slash and dot formats, plus bare "YYYY-MM" and "YYYY") and turns
// them into a UTC start-of-period timestamp. The caller then filters for
// created_at >= that timestamp, i.e. "everything from that date forward".
function validDate(y, mo, d) {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 2200;
}

function parseDateQuery(term) {
  const t = term.trim();
  let m;

  if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(t))) {
    const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
    if (!validDate(y, mo, d) || h > 23 || mi > 59) return null;
    return { startTs: Math.floor(Date.UTC(y, mo - 1, d, h, mi, 0) / 1000) };
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
    const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
    if (!validDate(y, mo, d)) return null;
    return { startTs: Math.floor(Date.UTC(y, mo - 1, d, 0, 0, 0) / 1000) };
  }
  if ((m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(t))) {
    const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
    if (!validDate(y, mo, d)) return null;
    return { startTs: Math.floor(Date.UTC(y, mo - 1, d, 0, 0, 0) / 1000) };
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
    const [mo, d, y] = [m[1], m[2], m[3]].map(Number);
    if (!validDate(y, mo, d)) return null;
    return { startTs: Math.floor(Date.UTC(y, mo - 1, d, 0, 0, 0) / 1000) };
  }
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) {
    const [d, mo, y] = [m[1], m[2], m[3]].map(Number);
    if (!validDate(y, mo, d)) return null;
    return { startTs: Math.floor(Date.UTC(y, mo - 1, d, 0, 0, 0) / 1000) };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(t))) {
    const [y, mo] = [m[1], m[2]].map(Number);
    if (mo < 1 || mo > 12 || y < 1970 || y > 2200) return null;
    return { startTs: Math.floor(Date.UTC(y, mo - 1, 1, 0, 0, 0) / 1000) };
  }
  if ((m = /^(\d{4})$/.exec(t))) {
    const y = Number(m[1]);
    if (y < 1970 || y > 2200) return null;
    return { startTs: Math.floor(Date.UTC(y, 0, 1, 0, 0, 0) / 1000) };
  }
  return null;
}

function authorMap(ids) {
  return getUsersByIds(ids);
}

function decoratePost(row, users, tags, masters) {
  const author = users.get(row.author_id) || null;
  const tag = tags.get(row.tag_id) || null;
  const master = masters.get(row.master_tag_id) || null;
  return {
    id: row.id,
    master_tag_id: row.master_tag_id,
    tag_id: row.tag_id,
    author: author ? {
      id: author.id,
      username: author.username,
      avatar_type: author.avatar_type,
      avatar_value: author.avatar_value,
      avatar_shape: author.avatar_shape,
      avatar_color: author.avatar_color
    } : null,
    master_tag: master,
    tag,
    header_title: row.deleted ? '[deleted]' : row.header_title,
    body_text: row.deleted ? null : row.body_text,
    body_type: row.deleted ? 'text' : row.body_type,
    file_path: row.deleted ? null : row.file_path,
    file_mime: row.deleted ? null : row.file_mime,
    created_at: row.created_at,
    likes_count: row.likes_count,
    reply_count: row.reply_count,
    deleted: !!row.deleted
  };
}

function decorateReply(row, users, deletedPlaceholder) {
  const author = users.get(row.author_id) || null;
  const deleted = !!row.deleted;
  const keepVisible = !deleted || deletedPlaceholder;
  if (!keepVisible) return null;
  return {
    id: row.id,
    post_id: row.post_id,
    parent_reply_id: row.parent_reply_id,
    author: author ? {
      id: author.id,
      username: author.username,
      avatar_type: author.avatar_type,
      avatar_value: author.avatar_value,
      avatar_shape: author.avatar_shape,
      avatar_color: author.avatar_color
    } : null,
    header_title: deleted ? '[deleted]' : row.header_title,
    body_text: deleted ? null : row.body_text,
    body_type: deleted ? 'text' : row.body_type,
    file_path: deleted ? null : row.file_path,
    file_mime: deleted ? null : row.file_mime,
    created_at: row.created_at,
    likes_count: row.likes_count,
    deleted
  };
}

function buildReplyTree(rows, users) {
  const children = new Map();
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const row of rows) {
    const key = row.parent_reply_id === null ? null : row.parent_reply_id;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(row);
  }

  function hasVisibleDescendant(id) {
    const direct = children.get(id) || [];
    return direct.some(child => !child.deleted || hasVisibleDescendant(child.id));
  }

  function build(parentId) {
    return (children.get(parentId) || []).map(row => {
      const node = decorateReply(row, users, !row.deleted || hasVisibleDescendant(row.id));
      if (!node) return null;
      node.replies = build(row.id);
      return node;
    }).filter(Boolean);
  }

  return build(null);
}

function recursiveRepliesQuery() {
  return `
    WITH RECURSIVE thread AS (
      SELECT
        r.id, r.post_id, r.parent_reply_id, r.author_id, r.header_title,
        r.body_text, r.body_type, r.file_path, r.file_mime, r.created_at,
        r.likes_count, r.deleted,
        printf('%08d', r.id) AS tree_path,
        0 AS depth
      FROM replies r
      WHERE r.post_id = ?
        AND r.parent_reply_id IS NULL

      UNION ALL

      SELECT
        c.id, c.post_id, c.parent_reply_id, c.author_id, c.header_title,
        c.body_text, c.body_type, c.file_path, c.file_mime, c.created_at,
        c.likes_count, c.deleted,
        thread.tree_path || '.' || printf('%08d', c.id) AS tree_path,
        thread.depth + 1 AS depth
      FROM replies c
      JOIN thread ON c.parent_reply_id = thread.id
      WHERE c.post_id = ?
    )
    SELECT * FROM thread
    ORDER BY tree_path
  `;
}

function createContentRouter({ contentDb }) {
  const router = express.Router();

  router.get('/posts', optionalAuthenticate, (req, res, next) => {
    try {
      const limit = intParam(req.query.limit, 20, 1, 100);
      const offset = intParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const masterSlug = typeof req.query.master_slug === 'string' ? req.query.master_slug.trim() : '';
      const tagSlug = typeof req.query.tag_slug === 'string' ? req.query.tag_slug.trim() : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

      let master = null;
      let tag = null;
      if (masterSlug) {
        master = getMasterBySlug(masterSlug);
        if (!master) return res.json({ items: [], total: 0 });
      }
      if (tagSlug) {
        if (!master) return res.json({ items: [], total: 0 });
        tag = getTagBySlug(master.id, tagSlug);
        if (!tag) return res.json({ items: [], total: 0 });
      }

      // A search term that looks like a date/time (ISO, slash, dot, bare
      // year or year-month) is treated as "everything from that moment
      // forward", rather than text-matched — that's the only sane reading
      // of a date typed into a free-text box.
      const dateQuery = search ? parseDateQuery(search) : null;

      let searchTagIdList = null;
      let searchUserIdList = null;
      if (search && !dateQuery) {
        searchTagIdList = searchTagIds(search);
        searchUserIdList = searchUserIds(search);
      }

      const clauses = ['p.deleted = 0'];
      const params = [];
      if (master) { clauses.push('p.master_tag_id = ?'); params.push(master.id); }
      if (tag) { clauses.push('p.tag_id = ?'); params.push(tag.id); }
      if (dateQuery) {
        clauses.push('p.created_at >= ?');
        params.push(dateQuery.startTs);
      } else if (search) {
        const like = `%${search.toLowerCase()}%`;
        const pieces = [
          'LOWER(COALESCE(p.body_text, \'\')) LIKE ?',
          'LOWER(COALESCE(p.header_title, \'\')) LIKE ?'
        ];
        params.push(like, like);
        if (searchTagIdList && searchTagIdList.length) {
          pieces.push(`p.tag_id IN (${searchTagIdList.map(() => '?').join(',')})`);
          params.push(...searchTagIdList);
        }
        if (searchUserIdList && searchUserIdList.length) {
          // Matches the post's own author...
          pieces.push(`p.author_id IN (${searchUserIdList.map(() => '?').join(',')})`);
          params.push(...searchUserIdList);
        }
        // ...and posts that have a matching (non-deleted) reply, by text or
        // by the replying user's name, so comment search surfaces the post
        // it belongs to in the main feed.
        const replyPieces = [
          'LOWER(COALESCE(r.body_text, \'\')) LIKE ?',
          'LOWER(COALESCE(r.header_title, \'\')) LIKE ?'
        ];
        const replyParams = [like, like];
        if (searchUserIdList && searchUserIdList.length) {
          replyPieces.push(`r.author_id IN (${searchUserIdList.map(() => '?').join(',')})`);
          replyParams.push(...searchUserIdList);
        }
        pieces.push(`EXISTS (
          SELECT 1 FROM replies r
          WHERE r.post_id = p.id AND r.deleted = 0 AND (${replyPieces.join(' OR ')})
        )`);
        params.push(...replyParams);
        clauses.push(`(${pieces.join(' OR ')})`);
      }

      const where = clauses.join(' AND ');
      const total = contentDb.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`).get(...params).n;
      const rows = contentDb.prepare(`
        SELECT p.*
        FROM posts p
        WHERE ${where}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      const users = authorMap(rows.map(r => r.author_id));
      const tags = getTagsByIds(rows.map(r => r.tag_id));
      const masters = getMastersByIds(rows.map(r => r.master_tag_id));
      res.json({
        items: rows.map(r => decoratePost(r, users, tags, masters)),
        total,
        search_meta: dateQuery ? { type: 'date', from: dateQuery.startTs } : (search ? { type: 'text' } : null)
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/posts/:id', (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });

      const post = contentDb.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
      if (!post || post.deleted) return res.status(404).json({ error: 'not_found' });

      const replyRows = contentDb.prepare(recursiveRepliesQuery()).all(id, id);
      const users = authorMap([post.author_id, ...replyRows.map(r => r.author_id)]);
      const tags = getTagsByIds([post.tag_id]);
      const masters = getMastersByIds([post.master_tag_id]);

      res.json({
        post: decoratePost(post, users, tags, masters),
        replies: buildReplyTree(replyRows, users)
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/posts', authenticate, upload.single('file'), async (req, res, next) => {
    let persisted = null;
    try {
      const input = normalizeBodyInput(req.body, false, !!req.file);
      if (input.error) return res.status(400).json({ error: input.error });

      const masterTagId = Number.parseInt(req.body.master_tag_id, 10);
      const tagId = Number.parseInt(req.body.tag_id, 10);
      if (!Number.isInteger(masterTagId) || !Number.isInteger(tagId)) {
        return res.status(400).json({ error: 'invalid_input' });
      }

      const tag = validateTagPair(masterTagId, tagId);
      if (!tag) return res.status(400).json({ error: 'invalid_tag' });

      if (input.bodyType === 'text' && req.file) {
        return res.status(400).json({ error: 'unexpected_file' });
      }
      persisted = req.file ? await persistUploadedFile(req.file, input.bodyType) : null;

      const result = contentDb.transaction(() => {
        const info = contentDb.prepare(`
          INSERT INTO posts (
            master_tag_id, tag_id, author_id, header_title, body_text, body_type,
            file_path, file_mime, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          masterTagId, tagId, req.user.id, input.headerTitle, input.bodyText, input.bodyType,
          persisted && persisted.filePath, persisted && persisted.fileMime, now()
        );
        return contentDb.prepare(`SELECT * FROM posts WHERE id = ?`).get(info.lastInsertRowid);
      })();

      const users = authorMap([result.author_id]);
      const tags = getTagsByIds([result.tag_id]);
      const masters = getMastersByIds([result.master_tag_id]);
      return res.status(201).json(decoratePost(result, users, tags, masters));
    } catch (err) {
      if (persisted) deletePublicMediaPath(persisted.filePath);
      next(err);
    }
  });

  router.post('/posts/:id/reply', authenticate, upload.single('file'), async (req, res, next) => {
    let persisted = null;
    try {
      const postId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(postId)) return res.status(404).json({ error: 'not_found' });

      const post = contentDb.prepare(`SELECT id, deleted FROM posts WHERE id = ?`).get(postId);
      if (!post || post.deleted) return res.status(404).json({ error: 'not_found' });

      const input = normalizeBodyInput(req.body, true, !!req.file);
      if (input.error) return res.status(400).json({ error: input.error });

      let parentReplyId = null;
      if (req.body.parent_reply_id !== undefined && req.body.parent_reply_id !== '') {
        parentReplyId = Number.parseInt(req.body.parent_reply_id, 10);
        if (!Number.isInteger(parentReplyId)) return res.status(400).json({ error: 'invalid_parent_reply' });
        const parent = contentDb.prepare(`
          SELECT id, post_id, deleted FROM replies WHERE id = ?
        `).get(parentReplyId);
        if (!parent || parent.post_id !== postId) return res.status(400).json({ error: 'invalid_parent_reply' });
      }

      if (input.bodyType === 'text' && req.file) {
        return res.status(400).json({ error: 'unexpected_file' });
      }
      persisted = req.file ? await persistUploadedFile(req.file, input.bodyType) : null;

      const result = contentDb.transaction(() => {
        const info = contentDb.prepare(`
          INSERT INTO replies (
            post_id, parent_reply_id, author_id, header_title, body_text, body_type,
            file_path, file_mime, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          postId, parentReplyId, req.user.id, input.headerTitle, input.bodyText, input.bodyType,
          persisted && persisted.filePath, persisted && persisted.fileMime, now()
        );
        contentDb.prepare(`UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?`).run(postId);
        return contentDb.prepare(`SELECT * FROM replies WHERE id = ?`).get(info.lastInsertRowid);
      })();

      const users = authorMap([result.author_id]);
      return res.status(201).json(decorateReply(result, users, true));
    } catch (err) {
      if (persisted) deletePublicMediaPath(persisted.filePath);
      next(err);
    }
  });

  router.delete('/posts/:id', authenticate, (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const post = contentDb.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
      if (!post) return res.status(404).json({ error: 'not_found' });
      if (req.user.id !== post.author_id && !['manager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      contentDb.prepare(`UPDATE posts SET deleted = 1 WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.delete('/replies/:id', authenticate, (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const reply = contentDb.prepare(`SELECT * FROM replies WHERE id = ?`).get(id);
      if (!reply) return res.status(404).json({ error: 'not_found' });
      if (req.user.id !== reply.author_id && !['manager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      contentDb.prepare(`UPDATE replies SET deleted = 1 WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  function toggleLike(contentType) {
    return (req, res, next) => {
      try {
        const contentId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(contentId)) return res.status(404).json({ error: 'not_found' });

        const table = contentType === 'post' ? 'posts' : 'replies';
        const row = contentDb.prepare(`SELECT id, deleted FROM ${table} WHERE id = ?`).get(contentId);
        if (!row || row.deleted) return res.status(404).json({ error: 'not_found' });

        const existing = contentDb.prepare(`
          SELECT id FROM likes WHERE user_id = ? AND content_type = ? AND content_id = ?
        `).get(req.user.id, contentType, contentId);

        let liked;
        contentDb.transaction(() => {
          if (existing) {
            contentDb.prepare(`DELETE FROM likes WHERE id = ?`).run(existing.id);
            liked = false;
          } else {
            contentDb.prepare(`
              INSERT INTO likes (user_id, content_type, content_id, created_at)
              VALUES (?, ?, ?, ?)
            `).run(req.user.id, contentType, contentId, now());
            liked = true;
          }
          const count = contentDb.prepare(`
            SELECT COUNT(*) AS n FROM likes WHERE content_type = ? AND content_id = ?
          `).get(contentType, contentId).n;
          contentDb.prepare(`UPDATE ${table} SET likes_count = ? WHERE id = ?`).run(count, contentId);
        })();

        const count = contentDb.prepare(`
          SELECT likes_count FROM ${table} WHERE id = ?
        `).get(contentId).likes_count;
        res.json({ liked, likes_count: count });
      } catch (err) { next(err); }
    };
  }

  router.post('/posts/:id/like', authenticate, toggleLike('post'));
  router.post('/replies/:id/like', authenticate, toggleLike('reply'));

  return router;
}

module.exports = { createContentRouter, recursiveRepliesQuery };