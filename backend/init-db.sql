-- Schema bazy aplikacji (tasks + lokalny mirror userow z auth-servera).
-- Mirror jest aktualizowany przy kazdym requeście (upsert wg sub z JWT).

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY,
    username    VARCHAR(64),
    email       VARCHAR(255),
    name        VARCHAR(128),
    roles       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignee_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    status       VARCHAR(20)  NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','in_progress','done')),
    priority     VARCHAR(10)  NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low','medium','high')),
    due_date     DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner    ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);

-- Trigger ktory aktualizuje updated_at automatycznie.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
