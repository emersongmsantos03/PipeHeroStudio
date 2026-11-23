-- 0004 — Lista de prospecção: todos os negócios encontrados pelo prospector (no PC), com estado e "não contatar".
CREATE TABLE IF NOT EXISTS prospects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id         INTEGER NOT NULL UNIQUE,            -- id no banco do prospector
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT,
  name           TEXT,
  category       TEXT,
  city           TEXT,
  state          TEXT,
  country        TEXT,
  email          TEXT COLLATE NOCASE,
  phone          TEXT,
  website        TEXT,
  source         TEXT,                               -- overture | openstreetmap | google
  product        TEXT,                               -- P1..P7
  score          INTEGER,
  status         TEXT,                               -- encontrado | qualificado | contatado | respondeu | interessado | descartado | nao_contactar | devolvido
  stage_raw      TEXT,
  reason         TEXT,
  emails_sent    INTEGER NOT NULL DEFAULT 0,
  last_email_at  TEXT,
  last_subject   TEXT,
  clicked        INTEGER NOT NULL DEFAULT 0,
  replied_at     TEXT,
  reply_class    TEXT,
  do_not_contact INTEGER NOT NULL DEFAULT 0,
  dnc_reason     TEXT,
  dnc_source     TEXT,                               -- unsubscribe | not_interested | spam_complaint | bounce | manual | manual_off
  dnc_at         TEXT,
  crm_lead_id    INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS prospects_status  ON prospects(status);
CREATE INDEX IF NOT EXISTS prospects_email   ON prospects(email);
CREATE INDEX IF NOT EXISTS prospects_dnc     ON prospects(do_not_contact, dnc_source, dnc_at);
CREATE INDEX IF NOT EXISTS prospects_updated ON prospects(updated_at);
