-- 0002 — CRM mais completo: responsável, previsão de fecho, tarefas e modelos de mensagem.
-- Só acrescenta (colunas novas são opcionais); o site continua a gravar leads como antes.

ALTER TABLE leads ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN expected_close_at TEXT;   -- YYYY-MM-DD
ALTER TABLE leads ADD COLUMN probability INTEGER;      -- 0–100; NULL = valor padrão da etapa
CREATE INDEX leads_owner ON leads(owner_id);
CREATE INDEX leads_next  ON leads(next_action_at);

-- Tarefas (follow-ups, chamadas, reuniões…). leads.next_action_at passa a ser a data da próxima tarefa aberta.
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'todo',   -- todo | call | email | whatsapp | meeting
  due_date    TEXT,                           -- YYYY-MM-DD
  due_time    TEXT,                           -- HH:MM
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes       TEXT,
  done_at     TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX tasks_open     ON tasks(done_at, due_date);
CREATE INDEX tasks_lead     ON tasks(lead_id, done_at);
CREATE INDEX tasks_assignee ON tasks(assignee_id, done_at);

-- As "próximas ações" que já existiam passam a tarefas.
INSERT INTO tasks (title, type, due_date, lead_id)
SELECT 'Fazer follow-up', 'todo', next_action_at, id FROM leads
WHERE next_action_at IS NOT NULL AND stage NOT IN ('won', 'lost');

-- Modelos de mensagem (WhatsApp / e-mail) com variáveis: {primeiro_nome} {nome} {negocio} {meu_nome}.
CREATE TABLE templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  name       TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'any',     -- any | whatsapp | email
  subject    TEXT,
  body       TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO templates (name, channel, subject, body) VALUES
('Primeiro contacto', 'whatsapp', NULL,
 'Olá {primeiro_nome}! Aqui é o {meu_nome}, da Pipe Hero Studio. Recebi o seu pedido pelo site e queria perceber melhor o que precisa. Tem 10 minutos hoje ou amanhã para conversarmos?'),
('Marcar reunião', 'any', 'Vamos conversar? — Pipe Hero Studio',
 'Olá {primeiro_nome}, tudo bem? Para avançarmos com {negocio}, que tal uma chamada rápida de 20 minutos? Diga-me o dia e a hora que lhe dão mais jeito esta semana.'),
('Follow-up da proposta', 'email', 'A sua proposta — Pipe Hero Studio',
 'Olá {primeiro_nome},

Queria saber se já teve oportunidade de ver a proposta que enviei. Fico à disposição para esclarecer dúvidas ou ajustar o que for preciso.

Um abraço,
{meu_nome}
Pipe Hero Studio'),
('Sem resposta', 'whatsapp', NULL,
 'Olá {primeiro_nome}! Só para não deixar passar: ainda faz sentido conversarmos sobre {negocio}? Se não for o momento, sem problema — é só dizer.');
