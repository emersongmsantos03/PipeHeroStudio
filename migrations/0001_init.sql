-- Pipe Hero Studio — CRM, financeiro e métricas (D1: pipehero-crm).
-- Partilhada pelo site (pipeherostudio.digital) e pelo painel (admin.pipeherostudio.digital).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                       -- pbkdf2-sha256$iter$salt$hash
  role          TEXT NOT NULL DEFAULT 'member',      -- admin | member
  status        TEXT NOT NULL DEFAULT 'pending',     -- active | pending | disabled
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE leads (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source               TEXT NOT NULL,                -- form | chat | agent | manual
  stage                TEXT NOT NULL DEFAULT 'new',  -- new | contacted | meeting | proposal | won | lost
  qualification        TEXT,                         -- hot | warm | cold
  qualification_reason TEXT,
  name                 TEXT,
  email                TEXT COLLATE NOCASE,
  phone                TEXT,
  preferred_contact    TEXT,
  business             TEXT,
  business_type        TEXT,
  country              TEXT,
  location             TEXT,
  language             TEXT,
  services             TEXT,                         -- JSON array
  needs                TEXT,
  current_situation    TEXT,
  timeline             TEXT,
  budget               TEXT,
  decision_maker       TEXT,
  summary              TEXT,
  next_step            TEXT,
  page                 TEXT,
  session_id           TEXT,
  ip_country           TEXT,
  value_cents          INTEGER,
  currency             TEXT NOT NULL DEFAULT 'EUR',
  next_action_at       TEXT,                         -- YYYY-MM-DD
  lost_reason          TEXT,
  tags                 TEXT,
  transcript           TEXT,                         -- JSON [{role, content}]
  closed_at            TEXT
);
CREATE INDEX leads_created ON leads(created_at);
CREATE INDEX leads_stage   ON leads(stage);
CREATE INDEX leads_email   ON leads(email);
CREATE INDEX leads_session ON leads(session_id);

CREATE TABLE activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type       TEXT NOT NULL,       -- created | note | call | email | whatsapp | meeting | stage | update | system
  content    TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX activities_lead ON activities(lead_id, created_at);

CREATE TABLE transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  date         TEXT NOT NULL,     -- YYYY-MM-DD
  kind         TEXT NOT NULL,     -- income | expense
  category     TEXT NOT NULL DEFAULT 'Outros',
  description  TEXT,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EUR',
  status       TEXT NOT NULL DEFAULT 'paid',   -- paid | pending
  recurring    INTEGER NOT NULL DEFAULT 0,     -- 1 = mensal
  lead_id      INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX transactions_date ON transactions(date);
CREATE INDEX transactions_lead ON transactions(lead_id);

-- Tudo o que se conta: e-mails enviados, mensagens do chat, formulários, cadastros…
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type       TEXT NOT NULL,   -- email_sent | email_failed | whatsapp_sent | chat_message | form_submit | lead_created | signup | login
  source     TEXT,            -- ava | site | agent | system | admin
  ref        TEXT,            -- id de sessão do chat, destinatário, etc.
  lead_id    INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  meta       TEXT             -- JSON
);
CREATE INDEX events_type_created ON events(type, created_at);
CREATE INDEX events_created      ON events(created_at);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO settings (key, value) VALUES ('digest_enabled', '1');
