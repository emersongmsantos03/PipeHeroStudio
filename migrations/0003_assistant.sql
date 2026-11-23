-- 0003 — Aba "Assistente": fila de perguntas respondidas pelo agente Qwen no PC do Emerson.
CREATE TABLE IF NOT EXISTS assistant_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  history    TEXT,                               -- JSON [{role, content}]
  status     TEXT NOT NULL DEFAULT 'pending',    -- pending | working | done | error
  answer     TEXT
);
CREATE INDEX IF NOT EXISTS assistant_jobs_status ON assistant_jobs(status, id);
