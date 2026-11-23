/** Tipos e constantes partilhados pelo painel. */
export interface AppEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  EMAIL: SendEmail;
  LEADS: KVNamespace;
  LOGIN_RL: RateLimit;
  SIGNUP_RL: RateLimit;
  INGEST_RL: RateLimit;
  NOTIFY_TO?: string;
  RESEND_API_KEY?: string;
  ASSISTANT_KEY?: string;
  MAILER: { send(mail: import('../../shared/crm').Mail): Promise<{ ok: boolean; error?: string }> };
}

export const FROM = { email: 'site@pipeherostudio.digital', name: 'Painel Pipe Hero Studio' };
export const notifyTo = (env: AppEnv) => env.NOTIFY_TO || 'emerson@pipeherostudio.digital';
export const STAGE_LABEL: Record<string, string> = { new: 'Novo', contacted: 'Em contato', meeting: 'Reunião', proposal: 'Proposta', won: 'Ganho', lost: 'Perdido' };

export async function getSetting(db: D1Database, key: string) {
  return (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
}
export async function setSetting(db: D1Database, key: string, value: string) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}
