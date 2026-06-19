const express = require('express');
const { query } = require('../db');
const { authRequired, requireRole, requireScope } = require('../auth');

const router = express.Router();

// Wszystkie endpointy ponizej wymagaja roli 'admin'.
router.use(authRequired, requireRole('admin'));

// GET /api/admin/tasks - WSZYSTKIE zadania wszystkich userow (audyt).
router.get('/tasks', requireScope('tasks.read'), async (_req, res) => {
  const { rows } = await query(
    `SELECT t.*,
            o.username  AS owner_username,
            o.email     AS owner_email,
            a.username  AS assignee_username
       FROM tasks t
       LEFT JOIN users o ON o.id = t.owner_id
       LEFT JOIN users a ON a.id = t.assignee_id
      ORDER BY t.created_at DESC`,
  );
  res.json({ tasks: rows });
});

// GET /api/admin/users - lista userow ktorzy uzywali API.
router.get('/users', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, username, email, name, roles, last_seen, created_at
       FROM users
      ORDER BY last_seen DESC`,
  );
  res.json({ users: rows });
});

// POST /api/admin/tasks/:id/assign - przypisanie zadania userowi (po sub/UUID).
router.post('/tasks/:id/assign', requireScope('tasks.write'), express.json(), async (req, res) => {
  const assigneeId = req.body?.assignee_id;
  if (assigneeId !== null && typeof assigneeId !== 'string') {
    return res.status(400).json({ error: 'bad_request', detail: 'assignee_id must be UUID or null' });
  }

  if (assigneeId) {
    const { rows: u } = await query('SELECT id FROM users WHERE id = $1', [assigneeId]);
    if (u.length === 0) {
      return res.status(404).json({ error: 'assignee_not_found' });
    }
  }

  const { rows } = await query(
    `UPDATE tasks SET assignee_id = $2 WHERE id = $1 RETURNING *`,
    [req.params.id, assigneeId || null],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ task: rows[0] });
});

module.exports = router;
