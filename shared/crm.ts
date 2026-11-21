/**
 * Código partilhado entre o site (worker/) e o painel (admin/):
 * - saveLead: grava ou atualiza um lead no CRM (D1), sem duplicar.
 * - logEvent: regista tudo o que se conta (e-mails enviados, mensagens do chat, formulários…).
 * - sendMail: envia e-mail e conta-o (com a origem: ava, site, system…).
 */

/** Painel (CRM). Os e-mails levam o link direto para o lead. */
export const ADMIN_URL = 'https://admin.pipeherostudio.digital';

export const STAGES = ['new', 'contacted', 'meeting', 'proposal', 'won', 'lost'] as const;
export const SOURCES = ['form', 'chat', 'agent', 'manual'] as const;
export const QUALS = ['hot', 'warm', 'cold'] as const;

/** Campos de texto do lead que podem ser escritos por qualquer origem. */
export const LEAD_FIELDS = [
  'qualification', 'qualification_reason', 'name', 'email', 'phone', 'preferred_contact', 'business', 'business_type',
  'country', 'location', 'language', 'needs', 'current_situation', 'timeline', 'budget', 'decision_maker', 'summary',
  'next_step', 'page', 'ip_country', 'tags',
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export type LeadInput = Partial<Record<LeadField, string | null>> & {
  services?: string[];
  transcript?: { role: string; content: string }[];
  value_cents?: number | null;
  currency?: string;
  stage?: string;
  created_at?: string;
};

export const now = () => new Date().toISOString();
const clip = (v: unknown, max = 4000) => (v == null ? null : String(v).trim().slice(0, max) || null);

export async function logEvent(
  db: D1Database | undefined,
  type: string,
  source: string,
  opts: { ref?: string | null; leadId?: number | null; meta?: unknown; at?: string } = {},
) {
  if (!db) return;
  try {
    await db
      .prepare('INSERT INTO events (created_at, type, source, ref, lead_id, meta) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(opts.at || now(), type, source, clip(opts.ref, 200), opts.leadId ?? null, opts.meta == null ? null : JSON.stringify(opts.meta).slice(0, 4000))
      .run();
  } catch (e) {
    console.error('crm: logEvent failed', type, (e as Error).message);
  }
}

export async function addActivity(db: D1Database, leadId: number, type: string, content: string | null, userId: number | null = null) {
  await db
    .prepare('INSERT INTO activities (lead_id, type, content, user_id) VALUES (?, ?, ?, ?)')
    .bind(leadId, type, clip(content, 8000), userId)
    .run();
}

/**
 * Grava o lead. Não duplica:
 * - mesmo `sessionId` (conversa da Ava) → atualiza esse lead;
 * - mesmo e-mail com um negócio ainda aberto (últimos 120 dias) → atualiza e regista o novo contacto no histórico.
 */
export async function saveLead(
  db: D1Database,
  input: LeadInput,
  opts: { source: (typeof SOURCES)[number]; sessionId?: string | null; note?: string | null; userId?: number | null },
): Promise<{ id: number; created: boolean }> {
  const values: Record<string, string | number | null> = {};
  for (const f of LEAD_FIELDS) {
    const v = clip(input[f], f === 'needs' || f === 'summary' || f === 'current_situation' ? 8000 : 400);
    if (v) values[f] = v;
  }
  if (values.email) values.email = String(values.email).toLowerCase();
  if (values.qualification && !QUALS.includes(values.qualification as never)) delete values.qualification;
  if (input.services?.length) values.services = JSON.stringify(input.services.map((s) => String(s).slice(0, 40)).slice(0, 10));
  if (input.transcript?.length) values.transcript = JSON.stringify(input.transcript).slice(0, 200_000);
  if (typeof input.value_cents === 'number' && Number.isFinite(input.value_cents)) values.value_cents = Math.round(input.value_cents);
  if (input.currency) values.currency = String(input.currency).toUpperCase().slice(0, 3);

  let existing: { id: number; services: string | null } | null = null;
  if (opts.sessionId) {
    existing = await db.prepare('SELECT id, services FROM leads WHERE session_id = ? ORDER BY id DESC LIMIT 1').bind(opts.sessionId).first();
  }
  if (!existing && values.email) {
    existing = await db
      .prepare(
        `SELECT id, services FROM leads WHERE email = ? AND stage NOT IN ('won','lost') AND created_at >= ? ORDER BY id DESC LIMIT 1`,
      )
      .bind(values.email, new Date(Date.now() - 120 * 864e5).toISOString())
      .first();
  }

  if (existing) {
    // Junta os serviços em vez de os substituir.
    if (values.services) {
      const merged = new Set<string>([...safeJson<string[]>(existing.services, []), ...safeJson<string[]>(String(values.services), [])]);
      values.services = JSON.stringify([...merged]);
    }
    const keys = Object.keys(values);
    if (opts.sessionId) keys.push('session_id');
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => (k === 'session_id' ? opts.sessionId! : values[k]));
    await db.prepare(`UPDATE leads SET ${sets ? sets + ', ' : ''}updated_at = ? WHERE id = ?`).bind(...binds, now(), existing.id).run();
    await addActivity(db, existing.id, 'update', opts.note || `Lead atualizado (${labelSource(opts.source)}).`, opts.userId ?? null);
    return { id: existing.id, created: false };
  }

  const stage = input.stage && STAGES.includes(input.stage as never) ? input.stage : 'new';
  const cols = ['source', 'stage', ...Object.keys(values)];
  const binds: (string | number | null)[] = [opts.source, stage, ...Object.values(values)];
  if (opts.sessionId) { cols.push('session_id'); binds.push(opts.sessionId); }
  if (input.created_at) { cols.push('created_at', 'updated_at'); binds.push(input.created_at, input.created_at); }
  const row = await db
    .prepare(`INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`)
    .bind(...binds)
    .first<{ id: number }>();
  const id = row!.id;
  await addActivity(db, id, 'created', opts.note || `Lead criado (${labelSource(opts.source)}).`, opts.userId ?? null);
  await logEvent(db, 'lead_created', opts.source, { leadId: id, at: input.created_at });
  return { id, created: true };
}

export function labelSource(s: string) {
  return ({ form: 'formulário do site', chat: 'Ava, assistente virtual', agent: 'agente externo', manual: 'manual' } as Record<string, string>)[s] || s;
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/* ---------- E-mail contabilizado ---------- */

export interface MailEnv {
  EMAIL: SendEmail;
  DB?: D1Database;
  RESEND_API_KEY?: string;
  /** Ligação interna (RPC) ao Worker do site, que envia pelo Resend. */
  MAILER?: { send(mail: Mail): Promise<{ ok: boolean; error?: string }> };
}

export type Mail = {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

/** Envia só pelo Resend (usado como reserva e pela ligação interna do painel). */
export async function sendViaResend(key: string, mail: Mail): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${mail.from.name} <${mail.from.email}>`,
        to: [mail.to],
        subject: mail.subject.replace(/[\r\n]+/g, ' ').slice(0, 150),
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `resend ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: `resend ${(e as Error).message}` };
  }
}

/**
 * Envia e regista o envio. Ordem:
 * 1) Cloudflare Email Service; 2) Resend (se este Worker tiver RESEND_API_KEY);
 * 3) ligação interna ao Worker do site (MAILER), que tem a chave do Resend — usada pelo painel.
 */
export async function sendMail(env: MailEnv, mail: Mail, track: { source: string; leadId?: number | null; kind?: string }): Promise<boolean> {
  const subject = mail.subject.replace(/[\r\n]+/g, ' ').slice(0, 150);
  mail = { ...mail, subject };
  let ok = false;
  let via = 'cloudflare';
  let error = '';
  try {
    await env.EMAIL.send({ ...mail, ...(mail.replyTo ? { replyTo: mail.replyTo } : {}) });
    ok = true;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    error = `${err.code || ''} ${err.message || ''}`.trim();
    console.error('mail: cloudflare send failed', error);
  }
  if (!ok && env.RESEND_API_KEY) {
    via = 'resend';
    const r = await sendViaResend(env.RESEND_API_KEY, mail);
    ok = r.ok;
    if (!ok) error += ` | ${r.error}`;
  } else if (!ok && env.MAILER) {
    via = 'resend';
    try {
      const r = await env.MAILER.send(mail);
      ok = r.ok;
      if (!ok) error += ` | ${r.error}`;
    } catch (e) {
      error += ` | mailer ${(e as Error).message}`;
    }
  }
  await logEvent(env.DB, ok ? 'email_sent' : 'email_failed', track.source, {
    ref: mail.to,
    leadId: track.leadId ?? null,
    meta: { subject, kind: track.kind || null, via, ...(ok ? {} : { error: error.slice(0, 300) }) },
  });
  return ok;
}

export const escHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
