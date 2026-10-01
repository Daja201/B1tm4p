const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getUsersByIds } = require('../lib/crossDb');

function now() {
  return (Date.now() / 1000) | 0;
}

function createReportsRouter({ contentDb, reportsDb }) {
  const router = express.Router();

  function findContent(contentType, contentId) {
    if (contentType === 'post') {
      return contentDb.prepare(`
        SELECT id, body_text, body_type, file_path, deleted, created_at
        FROM posts WHERE id = ?
      `).get(contentId) || null;
    }
    if (contentType === 'reply') {
      return contentDb.prepare(`
        SELECT id, body_text, body_type, file_path, deleted, created_at
        FROM replies WHERE id = ?
      `).get(contentId) || null;
    }
    return null;
  }

  router.post('/reports', authenticate, (req, res, next) => {
    try {
      const contentType = req.body && req.body.content_type;
      const contentId = Number.parseInt(req.body && req.body.content_id, 10);
      const reason = typeof (req.body && req.body.reason) === 'string'
        ? req.body.reason.trim().slice(0, 2000)
        : '';

      if (!['post', 'reply'].includes(contentType) || !Number.isInteger(contentId) || !reason) {
        return res.status(400).json({ error: 'invalid_input' });
      }

      const content = findContent(contentType, contentId);
      if (!content) return res.status(404).json({ error: 'not_found' });

      const info = reportsDb.prepare(`
        INSERT INTO reports (
          content_type, content_id, reporter_id, reason, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(contentType, contentId, req.user.id, reason, now());

      const report = reportsDb.prepare(`SELECT * FROM reports WHERE id = ?`).get(info.lastInsertRowid);
      return res.status(201).json(report);
    } catch (err) { next(err); }
  });

  router.get('/reports', authenticate, requireRole('manager', 'admin'), (req, res, next) => {
    try {
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
      const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
      const status = req.query.status || 'pending';
      if (!['pending', 'reviewed', 'dismissed'].includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }

      const total = reportsDb.prepare(`SELECT COUNT(*) AS n FROM reports WHERE status = ?`).get(status).n;
      const reports = reportsDb.prepare(`
        SELECT * FROM reports
        WHERE status = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(status, limit, offset);

      const reporters = getUsersByIds(reports.map(r => r.reporter_id));
      const items = reports.map(report => {
        const content = findContent(report.content_type, report.content_id);
        const reporter = reporters.get(report.reporter_id) || null;
        return {
          ...report,
          reporter: reporter ? {
            id: reporter.id,
            username: reporter.username,
            avatar_type: reporter.avatar_type,
            avatar_value: reporter.avatar_value,
            avatar_shape: reporter.avatar_shape,
            avatar_color: reporter.avatar_color
          } : null,
          content: content ? {
            body_text: content.deleted ? null : content.body_text,
            body_type: content.body_type,
            file_path: content.deleted ? null : content.file_path,
            deleted: !!content.deleted,
            snippet: content.deleted
              ? '[deleted]'
              : (content.body_text ? content.body_text.slice(0, 300) : content.file_path || '')
          } : null
        };
      });

      res.json({ items, total });
    } catch (err) { next(err); }
  });

  router.patch('/reports/:id', authenticate, requireRole('manager', 'admin'), (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const report = reportsDb.prepare(`SELECT * FROM reports WHERE id = ?`).get(id);
      if (!report) return res.status(404).json({ error: 'not_found' });

      const status = req.body && req.body.status;
      const reviewNote = req.body && req.body.review_note !== undefined
        ? String(req.body.review_note).slice(0, 2000)
        : null;

      if (!['pending', 'reviewed', 'dismissed'].includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }

      const reviewedAt = status === 'pending' ? null : now();
      reportsDb.prepare(`
        UPDATE reports
        SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ?
        WHERE id = ?
      `).run(status, status === 'pending' ? null : req.user.id, reviewNote, reviewedAt, id);

      res.json(reportsDb.prepare(`SELECT * FROM reports WHERE id = ?`).get(id));
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createReportsRouter };
