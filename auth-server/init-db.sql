-- Schema dla Authorization Servera. Tylko tabela userow z rolami.
-- (Tokeny/sesje OIDC sa krotkozyjace i trzymane w pamieci providera.)

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(64)  UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    name          VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    roles         TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
