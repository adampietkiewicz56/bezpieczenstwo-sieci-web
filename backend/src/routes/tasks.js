const express = require('express');
const { query } = require('../db');
const { authRequired, requireScope } = require('../auth');

const router = express.Router();

const STATUSES   = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

function badRequest(res, msg) {
  return res.status(400).json({ error: 'bad_request', detail: msg });
}

function validateTaskBody(body, partial = false) {
  if (!partial) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 255) {
      return 'title required (1-255 chars)';
    }
  } else if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 255)) {
    return 'title invalid';
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return 'description must be string';
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return `status must be one of ${STATUSES.join(',')}`;
  }
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) {
    return `priority must be one of ${PRIORITIES.join(',')}`;
  }
  if (body.due_date !== undefined && body.due_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) return 'due_date must be YYYY-MM-DD';
  }
  return null;
}

// GET /api/tasks - lista wlasnych zadan + zadan przypisanych userowi.
router.get('/', authRequired, requireScope('tasks.read'), async (req, res) => {
  const { rows } = await query(
    `SELECT t.*,
            o.username AS owner_username,
            a.username AS assignee_username
       FROM tasks t
       LEFT JOIN users o ON o.id = t.owner_id
       LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.owner_id = $1 OR t.assignee_id = $1
      ORDER BY t.created_at DESC`,
    [req.user.sub],
  );
  res.json({ tasks: rows });
});

// POST /api/tasks
router.post('/', authRequired, requireScope('tasks.write'), express.json(), async (req, res) => {
  const err = validateTaskBody(req.body || {}, false);
  if (err) return badRequest(res, err);

  const { rows } = await query(
    `INSERT INTO tasks (owner_id, title, description, status, priority, due_date)
     VALUES ($1, $2, $3, COALESCE($4, 'todo'), COALESCE($5, 'medium'), $6)
     RETURNING *`,
    [
      req.user.sub,
      req.body.title.trim(),
      req.body.description || null,
      req.body.status,
      req.body.priority,
      req.body.due_date || null,
    ],
  );
  res.status(201).json({ task: rows[0] });
});

// PUT /api/tasks/:id - update (tylko wlasciciel; admin uzywa /api/admin/tasks/:id).
router.put('/:id', authRequired, requireScope('tasks.write'), express.json(), async (req, res) => {
  const err = validateTaskBody(req.body || {}, true);
  if (err) return badRequest(res, err);

  const { rows: existing } = await query('SELECT owner_id FROM tasks WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'not_found' });
  if (existing[0].owner_id !== req.user.sub) {
    return res.status(403).json({ error: 'forbidden', detail: 'not the owner' });
  }

  const { rows } = await query(
    `UPDATE tasks SET
        title       = COALESCE($2, title),
        description = COALESCE($3, description),
        status      = COALESCE($4, status),
        priority    = COALESCE($5, priority),
        due_date    = COALESCE($6, due_date)
     WHERE id = $1
     RETURNING *`,
    [
      req.params.id,
      req.body.title,
      req.body.description,
      req.body.status,
      req.body.priority,
      req.body.due_date,
    ],
  );
  res.json({ task: rows[0] });
});

// DELETE /api/tasks/:id - wlasciciel LUB admin.
router.delete('/:id', authRequired, requireScope('tasks.write'), async (req, res) => {
  const { rows: existing } = await query('SELECT owner_id FROM tasks WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'not_found' });
  const isOwner = existing[0].owner_id === req.user.sub;
  const isAdmin = req.user.roles.includes('admin');
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'forbidden' });
  }

  await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
