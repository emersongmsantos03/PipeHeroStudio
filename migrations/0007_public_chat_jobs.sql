CREATE TABLE IF NOT EXISTS public_chat_jobs (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','failed')),
  answer TEXT
);
CREATE INDEX IF NOT EXISTS public_chat_jobs_expiry ON public_chat_jobs(expires);
CREATE INDEX IF NOT EXISTS public_chat_jobs_claim ON public_chat_jobs(state, expires);
