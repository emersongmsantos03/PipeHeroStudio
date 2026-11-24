-- Agendamento de chamadas de 15 minutos pelo site (/en/book/, /pt/marcar/, /es/reservar/).
CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  start_at     TEXT NOT NULL,              -- início em UTC, ISO (YYYY-MM-DDTHH:MM:00.000Z)
  minutes      INTEGER NOT NULL DEFAULT 15,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  business     TEXT,
  phone        TEXT,
  timezone     TEXT,                       -- fuso escolhido pela pessoa (ex.: America/New_York)
  notes        TEXT,
  lang         TEXT,
  status       TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed | cancelled | done | no_show
  lead_id      INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  task_id      INTEGER,
  cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot ON bookings(start_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS bookings_start ON bookings(start_at);
