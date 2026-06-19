import { getUser } from './auth';

const BASE = import.meta.env.VITE_API_BASE_URL;

async function authHeaders() {
  const u = await getUser();
  if (!u) throw new Error('not_authenticated');
  return { Authorization: `Bearer ${u.access_token}` };
}

async function call(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.skipAuth ? {} : await authHeaders()),
    ...(opts.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const api = {
  health:        () => call('/health',          { skipAuth: true }),
  ready:         () => call('/ready',           { skipAuth: true }),
  profile:       () => call('/api/profile'),
  listTasks:     () => call('/api/tasks'),
  createTask:    (t) => call('/api/tasks',                  { method: 'POST',   body: t }),
  updateTask:    (id, t) => call(`/api/tasks/${id}`,        { method: 'PUT',    body: t }),
  deleteTask:    (id) => call(`/api/tasks/${id}`,           { method: 'DELETE' }),
  adminAllTasks: () => call('/api/admin/tasks'),
  adminUsers:    () => call('/api/admin/users'),
  assignTask:    (id, assignee_id) =>
    call(`/api/admin/tasks/${id}/assign`,                   { method: 'POST',   body: { assignee_id } }),
};
