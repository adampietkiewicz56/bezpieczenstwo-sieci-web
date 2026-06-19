import React, { useEffect, useState, useCallback } from 'react';
import { login, logout, getUser, handleCallback } from './auth';
import { api } from './api';

function Topbar({ user }) {
  return (
    <div className="topbar">
      <div className="brand">
        <h1>bezpsw - Task Manager</h1>
        <span className="badge">OAuth 2.0 + PKCE</span>
      </div>
      <div className="user-area">
        {user && (
          <>
            <span>{user.profile.name || user.profile.preferred_username}</span>
            <div className="roles">
              {(user.profile.roles || []).map((r) => (
                <span key={r} className={`role-chip ${r === 'admin' ? 'admin' : ''}`}>{r}</span>
              ))}
            </div>
            <button className="btn-ghost" onClick={() => logout()}>Wyloguj</button>
          </>
        )}
      </div>
    </div>
  );
}

function TaskForm({ onCreate }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('todo');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        priority,
        status,
        due_date: dueDate || null,
      });
      setTitle('');
      setDueDate('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-row" onSubmit={submit}>
      <input
        placeholder="Tytul zadania..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <select value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="todo">todo</option>
        <option value="in_progress">in_progress</option>
        <option value="done">done</option>
      </select>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <button className="btn-primary" disabled={busy}>Dodaj</button>
    </form>
  );
}

function TasksTable({ tasks, isAdmin, onUpdate, onDelete, showOwner }) {
  if (!tasks.length) {
    return <div className="empty">Brak zadan. Dodaj pierwsze powyzej.</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Tytul</th>
          {showOwner && <th>Wlasciciel</th>}
          <th>Status</th>
          <th>Priorytet</th>
          <th>Termin</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>
              {t.title}
              {t.description && <div style={{ color: '#94a3b8', fontSize: 11 }}>{t.description}</div>}
            </td>
            {showOwner && <td>{t.owner_username || t.owner_id.slice(0, 8)}</td>}
            <td><span className={`pill status-${t.status}`}>{t.status}</span></td>
            <td><span className={`pill prio-${t.priority}`}>{t.priority}</span></td>
            <td>{t.due_date ? new Date(t.due_date).toISOString().slice(0, 10) : '-'}</td>
            <td className="actions">
              <select
                value={t.status}
                onChange={(e) => onUpdate(t.id, { status: e.target.value })}
                style={{ width: 120 }}
              >
                <option value="todo">todo</option>
                <option value="in_progress">in_progress</option>
                <option value="done">done</option>
              </select>
              <button className="btn-danger" onClick={() => onDelete(t.id)}>
                {isAdmin && t.owner_id !== undefined ? 'Usun' : 'Usun'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UsersTable({ users }) {
  if (!users.length) {
    return <div className="empty">Brak userow w lokalnym mirrorze.</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>Email</th>
          <th>Imie</th>
          <th>Role</th>
          <th>Ostatnie zalogowanie</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.username || '-'}</td>
            <td>{u.email || '-'}</td>
            <td>{u.name || '-'}</td>
            <td>
              {(u.roles || []).map((r) => (
                <span key={r} className={`role-chip ${r === 'admin' ? 'admin' : ''}`}>{r}</span>
              ))}
            </td>
            <td>{new Date(u.last_seen).toLocaleString('pl-PL')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AppMain({ user }) {
  const isAdmin = (user.profile.roles || []).includes('admin');
  const [tab, setTab] = useState('my');
  const [tasks, setTasks] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);

  const refreshMy = useCallback(async () => {
    try {
      const data = await api.listTasks();
      setTasks(data.tasks);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refreshAdmin = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([api.adminAllTasks(), api.adminUsers()]);
      setAllTasks(t.tasks);
      setUsers(u.users);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (tab === 'my') refreshMy();
    if (tab === 'admin' && isAdmin) refreshAdmin();
  }, [tab, refreshMy, refreshAdmin, isAdmin]);

  const onCreate = async (t) => {
    try {
      await api.createTask(t);
      await refreshMy();
    } catch (e) { setError(e.message); }
  };
  const onUpdate = async (id, patch) => {
    try {
      await api.updateTask(id, patch);
      await refreshMy();
      if (tab === 'admin') await refreshAdmin();
    } catch (e) { setError(e.message); }
  };
  const onDelete = async (id) => {
    if (!window.confirm('Usunac zadanie?')) return;
    try {
      await api.deleteTask(id);
      await refreshMy();
      if (tab === 'admin') await refreshAdmin();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="container">
      <div className="tabs">
        <button className={`tab ${tab === 'my' ? 'active' : ''}`} onClick={() => setTab('my')}>Moje zadania</button>
        <button className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profil</button>
        {isAdmin && (
          <button className={`tab ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}>
            Admin
          </button>
        )}
      </div>

      {error && <div className="error-banner">Blad: {error}</div>}

      {tab === 'my' && (
        <>
          <div className="section">
            <h2>Nowe zadanie</h2>
            <TaskForm onCreate={onCreate} />
          </div>
          <div className="section">
            <h2>Moje zadania ({tasks.length})</h2>
            <TasksTable tasks={tasks} isAdmin={isAdmin} onUpdate={onUpdate} onDelete={onDelete} showOwner={false} />
          </div>
        </>
      )}

      {tab === 'profile' && (
        <div className="section">
          <h2>Profil z access tokenu</h2>
          <table>
            <tbody>
              <tr><th>sub</th><td><code>{user.profile.sub}</code></td></tr>
              <tr><th>name</th><td>{user.profile.name}</td></tr>
              <tr><th>preferred_username</th><td>{user.profile.preferred_username}</td></tr>
              <tr><th>email</th><td>{user.profile.email}</td></tr>
              <tr><th>roles</th><td>{(user.profile.roles || []).join(', ')}</td></tr>
              <tr><th>scopes (z access tokenu)</th><td>{user.scope}</td></tr>
              <tr><th>access token (skrocony)</th><td><code>{user.access_token.slice(0, 60)}...</code></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'admin' && isAdmin && (
        <>
          <div className="section">
            <h2>Wszystkie zadania w systemie ({allTasks.length})</h2>
            <TasksTable tasks={allTasks} isAdmin onUpdate={onUpdate} onDelete={onDelete} showOwner />
          </div>
          <div className="section">
            <h2>Uzytkownicy ({users.length})</h2>
            <UsersTable users={users} />
          </div>
        </>
      )}

      <div className="health-banner">
        Resource server: <code>{import.meta.env.VITE_API_BASE_URL}</code> |
        Issuer: <code>{import.meta.env.VITE_OIDC_AUTHORITY}</code> |
        Client: <code>{import.meta.env.VITE_OIDC_CLIENT_ID}</code>
      </div>
    </div>
  );
}

function Landing() {
  return (
    <div className="landing">
      <h1>bezpsw - Task Manager</h1>
      <p>
        Aplikacja zabezpieczona standardem <b>OAuth 2.0 / OpenID Connect</b> z wymuszonym{' '}
        <b>PKCE</b>. Zaloguj sie, zeby zarzadzac swoimi zadaniami. Administratorzy maja dodatkowy
        widok zarzadczy.
      </p>
      <button className="btn-primary" onClick={() => login()}>Zaloguj sie</button>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Obsluga redirectu z auth-servera (z ?code=...).
        if (window.location.pathname === '/callback') {
          await handleCallback();
          // Czyscimy URL i wracamy na strone glowna.
          window.history.replaceState({}, document.title, '/');
        }
        const u = await getUser();
        setUser(u);
      } catch (e) {
        console.error(e);
        setError(e.message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) return <div className="spinner">Ladowanie...</div>;
  if (error) return <div className="error-banner">Blad: {error}</div>;

  return (
    <div className="app">
      <Topbar user={user} />
      {user ? <AppMain user={user} /> : <Landing />}
    </div>
  );
}
