/**
 * admin.pipeherostudio.digital — painel da Pipe Hero Studio.
 *
 *  /api/auth/*       login, logout, pedido de acesso (cadastro → aprovação + e-mail ao Emerson)
 *  /api/me           conta do utilizador
 *  /api/stats        visão geral (leads, Ava, e-mails, financeiro)
 *  /api/leads        CRM (lista, quadro, detalhe, notas, etapas)
 *  /api/transactions financeiro
 *  /api/agent        métricas da Ava e de agentes externos, registo de e-mails
 *  /api/users        utilizadores (admin)
 *  /api/settings     chave da API, resumo diário, e-mail de teste, importação (admin)
 *  /api/ingest/*     API para agentes externos (n8n, Make, GPT…) com chave Bearer
 *  cron              resumo diário por e-mail
 */
import { createSession, destroySession, getUser, hashPassword, randomToken, sha256, verifyPassword, weakPassword, type User } from './auth';
import {
  ADMIN_URL, LEAD_FIELDS, QUALS, SOURCES, STAGES, addActivity, escHtml, logEvent, now, saveLead, sendMail, type LeadInput,
} from '../../shared/crm';
import { emailLayout, sendDigest } from './digest';
import { FROM, STAGE_LABEL, getSetting, notifyTo, setSetting, type AppEnv } from './common';

const CURRENCIES = ['EUR', 'USD', 'BRL', 'GBP'];
const ACTIVITY_TYPES = ['note', 'call', 'email', 'whatsapp', 'meeting'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code);
  }
}

type Ctx = { req: Request; env: AppEnv; url: URL; user: User; params: string[]; ctx: ExecutionContext };
type Handler = (c: Ctx) => Promise<Response | unknown>;
type Access = 'public' | 'user' | 'admin' | 'ingest';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}

async function readBody(req: Request): Promise<Record<string, any>> {
  if (!(req.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'unsupported_type');
  const text = await req.text();
  if (text.length > 1_000_000) throw new HttpError(413, 'too_large');
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
    return v;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

const str = (v: unknown, max = 400) => (v == null ? '' : String(v).trim().slice(0, max));
const intId = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'not_found');
  return n;
};
const today = () => new Date().toISOString().slice(0, 10);

function rangeStart(range: string | null) {
  if (range === 'all') return '2000-01-01T00:00:00.000Z';
  const days = Math.min(Math.max(Number(range) || 30, 1), 3650);
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString();
}
function prevRange(from: string) {
  const start = new Date(from).getTime();
  const span = Date.now() - start;
  return { from: new Date(start - span).toISOString(), to: from };
}

const sumBy = (rows: { currency: string; total: number }[]) => Object.fromEntries(rows.map((r) => [r.currency, r.total || 0])) as Record<string, number>;

/* ====================================================================== */
/* Auth                                                                   */
/* ====================================================================== */

const login: Handler = async ({ req, env }) => {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await env.LOGIN_RL.limit({ key: ip })).success) throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Espere um minuto.');
  const b = await readBody(req);
  const email = str(b.email, 200).toLowerCase();
  const password = String(b.password ?? '').slice(0, 200);
  const user = await env.DB.prepare('SELECT id, password_hash, status FROM users WHERE email = ?').bind(email).first<{ id: number; password_hash: string; status: string }>();
  // Mesmo trabalho com ou sem utilizador, para não revelar quais e-mails existem.
  const ok = await verifyPassword(password, user?.password_hash || 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!user || !ok) throw new HttpError(401, 'invalid', 'E-mail ou senha incorretos.');
  if (user.status === 'pending') throw new HttpError(403, 'pending', 'O seu acesso ainda está à espera de aprovação.');
  if (user.status !== 'active') throw new HttpError(403, 'disabled', 'Este acesso foi desativado.');
  const cookie = await createSession(env.DB, user.id, req);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  await logEvent(env.DB, 'login', 'admin', { ref: email, meta: { ip, country: (req as any).cf?.country || null } });
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
};

const logout: Handler = async ({ req, env }) => json({ ok: true }, 200, { 'Set-Cookie': await destroySession(env.DB, req) });

const signup: Handler = async ({ req, env }) => {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await env.SIGNUP_RL.limit({ key: ip })).success) throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Espere um minuto.');
  const b = await readBody(req);
  if (str(b.website)) return json({ ok: true }); // honeypot
  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  const password = String(b.password ?? '');
  const reason = str(b.reason, 500);
  if (!name) throw new HttpError(400, 'validation', 'Escreva o seu nome.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'validation', 'E-mail inválido.');
  const weak = weakPassword(password);
  if (weak) throw new HttpError(400, 'validation', weak);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!exists) {
    await env.DB
      .prepare(`INSERT INTO users (email, name, password_hash, role, status) VALUES (?, ?, ?, 'member', 'pending')`)
      .bind(email, name, await hashPassword(password))
      .run();
    await logEvent(env.DB, 'signup', 'admin', { ref: email, meta: { name, reason, ip, country: (req as any).cf?.country || null } });
    const link = `${ADMIN_URL}/#/users`;
    await sendMail(
      env,
      {
        to: notifyTo(env),
        from: FROM,
        replyTo: email,
        subject: `Novo cadastro no painel: ${name}`,
        text: `${name} (${email}) pediu acesso ao painel da Pipe Hero Studio.\n${reason ? `\nMotivo: ${reason}\n` : ''}\nAprovar ou recusar: ${link}\n`,
        html: emailLayout(
          'Novo cadastro no painel',
          `<p><strong>${escHtml(name)}</strong> (${escHtml(email)}) pediu acesso ao painel.</p>${reason ? `<p style="color:#4a556b">Motivo: ${escHtml(reason)}</p>` : ''}<p>O acesso só fica ativo depois de o aprovar.</p>`,
          { label: 'Aprovar ou recusar', href: link },
        ),
      },
      { source: 'system', kind: 'signup', leadId: null },
    );
  }
  // A mesma resposta exista ou não a conta (não revela e-mails registados).
  return json({ ok: true });
};

const me: Handler = async ({ user, env }) => {
  const pending = user.role === 'admin' ? (await env.DB.prepare(`SELECT COUNT(*) n FROM users WHERE status = 'pending'`).first<{ n: number }>())!.n : 0;
  return { user, pendingUsers: pending };
};

const updateMe: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const name = str(b.name, 120);
  if (!name) throw new HttpError(400, 'validation', 'Escreva o seu nome.');
  await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  return { ok: true };
};

const changePassword: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(b.current ?? ''), row.password_hash))) throw new HttpError(400, 'validation', 'A senha atual está errada.');
  const weak = weakPassword(String(b.next ?? ''));
  if (weak) throw new HttpError(400, 'validation', weak);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(String(b.next)), user.id).run();
  // Termina as outras sessões.
  const cookie = await createSession(env.DB, user.id, req);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND created_at < ?').bind(user.id, new Date(Date.now() - 1000).toISOString()).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
};

/* ====================================================================== */
/* Visão geral                                                            */
/* ====================================================================== */

const stats: Handler = async ({ env, url }) => {
  const range = url.searchParams.get('range') || '30';
  const from = rangeStart(range);
  const prev = prevRange(from);
  const db = env.DB;
  const monthStart = today().slice(0, 7) + '-01';
  const yearAgo = new Date();
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11, 1);
  const financeFrom = yearAgo.toISOString().slice(0, 7) + '-01';

  const q = (sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b);
  const res = await db.batch([
    /* 0 */ q('SELECT source, COUNT(*) n FROM leads WHERE created_at >= ? GROUP BY source', from),
    /* 1 */ q('SELECT COUNT(*) n FROM leads WHERE created_at >= ? AND created_at < ?', prev.from, prev.to),
    /* 2 */ q(`SELECT substr(created_at,1,10) d, source, COUNT(*) n FROM leads WHERE created_at >= ? GROUP BY d, source`, from),
    /* 3 */ q(`SELECT stage, COUNT(*) n, currency, COALESCE(SUM(value_cents),0) total FROM leads GROUP BY stage, currency`),
    /* 4 */ q(`SELECT COUNT(*) n FROM leads WHERE stage = 'won' AND closed_at >= ?`, from),
    /* 5 */ q(`SELECT currency, COALESCE(SUM(value_cents),0) total FROM leads WHERE stage = 'won' AND closed_at >= ? GROUP BY currency`, from),
    /* 6 */ q(`SELECT type, source, COUNT(*) n, COUNT(DISTINCT ref) sessions FROM events WHERE created_at >= ? AND type IN ('email_sent','email_failed','chat_message','form_submit','whatsapp_sent','signup') GROUP BY type, source`, from),
    /* 7 */ q(`SELECT COUNT(*) n FROM leads WHERE source = 'chat' AND created_at >= ?`, from),
    /* 8 */ q(`SELECT kind, status, currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE date >= ? GROUP BY kind, status, currency`, from.slice(0, 10)),
    /* 9 */ q(`SELECT currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE kind = 'income' AND status = 'pending' GROUP BY currency`),
    /* 10 */ q(`SELECT substr(date,1,7) m, kind, currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE status = 'paid' AND date >= ? GROUP BY m, kind, currency`, financeFrom),
    /* 11 */ q(`SELECT id, created_at, source, stage, qualification, name, business, email, phone, summary, needs FROM leads ORDER BY created_at DESC LIMIT 8`),
    /* 12 */ q(`SELECT id, name, business, stage, next_action_at, next_step, phone, email FROM leads WHERE next_action_at IS NOT NULL AND next_action_at <= ? AND stage NOT IN ('won','lost') ORDER BY next_action_at LIMIT 10`, today()),
    /* 13 */ q(`SELECT currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE kind = 'income' AND recurring = 1 AND date >= ? GROUP BY currency`, new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)),
    /* 14 */ q(`SELECT kind, currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE status = 'paid' AND date >= ? GROUP BY kind, currency`, monthStart),
    /* 15 */ q(`SELECT qualification q, COUNT(*) n FROM leads WHERE created_at >= ? GROUP BY q`, from),
    /* 16 */ q(`SELECT COUNT(*) n FROM users WHERE status = 'pending'`),
  ]);
  const r = <T>(i: number) => (res[i].results || []) as T[];

  const bySource: Record<string, number> = { form: 0, chat: 0, agent: 0, manual: 0 };
  for (const row of r<{ source: string; n: number }>(0)) bySource[row.source] = row.n;
  const leadsTotal = Object.values(bySource).reduce((a, b) => a + b, 0);

  const funnel = STAGES.map((stage) => {
    const rows = r<{ stage: string; n: number; currency: string; total: number }>(3).filter((x) => x.stage === stage);
    return { stage, count: rows.reduce((a, x) => a + x.n, 0), value: Object.fromEntries(rows.map((x) => [x.currency, x.total])) };
  });
  const openValue: Record<string, number> = {};
  for (const f of funnel) if (!['won', 'lost'].includes(f.stage)) for (const [c, v] of Object.entries(f.value)) openValue[c] = (openValue[c] || 0) + (v as number);

  const ev = r<{ type: string; source: string; n: number; sessions: number }>(6);
  const evCount = (type: string, source?: string) => ev.filter((e) => e.type === type && (!source || e.source === source)).reduce((a, e) => a + e.n, 0);
  const emailsBySource: Record<string, number> = {};
  for (const e of ev.filter((e) => e.type === 'email_sent')) emailsBySource[e.source] = (emailsBySource[e.source] || 0) + e.n;
  const chatSessions = ev.filter((e) => e.type === 'chat_message').reduce((a, e) => a + e.sessions, 0);
  const chatLeads = r<{ n: number }>(7)[0]?.n || 0;

  const fin = r<{ kind: string; status: string; currency: string; total: number }>(8);
  const finSum = (kind: string, status: string) => {
    const o: Record<string, number> = {};
    for (const f of fin.filter((x) => x.kind === kind && x.status === status)) o[f.currency] = (o[f.currency] || 0) + f.total;
    return o;
  };
  const month = r<{ kind: string; currency: string; total: number }>(14);
  const monthSum = (kind: string) => Object.fromEntries(month.filter((x) => x.kind === kind).map((x) => [x.currency, x.total]));

  const wonCount = r<{ n: number }>(4)[0]?.n || 0;
  return {
    range,
    from,
    leads: {
      total: leadsTotal,
      previous: r<{ n: number }>(1)[0]?.n || 0,
      bySource,
      byQualification: Object.fromEntries(r<{ q: string | null; n: number }>(15).map((x) => [x.q || 'none', x.n])),
      daily: r<{ d: string; source: string; n: number }>(2),
      won: wonCount,
      wonValue: sumBy(r(5)),
      conversion: leadsTotal ? wonCount / leadsTotal : 0,
      openValue,
    },
    funnel,
    ava: {
      messages: evCount('chat_message', 'ava'),
      conversations: chatSessions,
      leads: chatLeads,
      conversion: chatSessions ? chatLeads / chatSessions : 0,
    },
    emails: { sent: evCount('email_sent'), failed: evCount('email_failed'), bySource: emailsBySource },
    forms: evCount('form_submit'),
    whatsapp: evCount('whatsapp_sent'),
    signups: evCount('signup'),
    pendingUsers: r<{ n: number }>(16)[0]?.n || 0,
    finance: {
      income: finSum('income', 'paid'),
      expense: finSum('expense', 'paid'),
      receivable: sumBy(r(9)),
      mrr: sumBy(r(13)),
      monthIncome: monthSum('income'),
      monthExpense: monthSum('expense'),
      monthly: r<{ m: string; kind: string; currency: string; total: number }>(10),
      monthsFrom: financeFrom.slice(0, 7),
    },
    recentLeads: r(11),
    followups: r(12),
  };
};

/* ====================================================================== */
/* CRM                                                                    */
/* ====================================================================== */

const LIST_COLS = `id, created_at, updated_at, source, stage, qualification, name, email, phone, business, business_type, country, location,
  services, value_cents, currency, next_action_at, next_step, summary, substr(needs,1,300) needs, language, tags, closed_at`;

const listLeads: Handler = async ({ env, url }) => {
  const p = url.searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  const stage = p.get('stage');
  if (stage && STAGES.includes(stage as never)) { where.push('stage = ?'); binds.push(stage); }
  if (p.get('open') === '1') where.push(`stage NOT IN ('won','lost')`);
  const source = p.get('source');
  if (source && SOURCES.includes(source as never)) { where.push('source = ?'); binds.push(source); }
  const qual = p.get('qualification');
  if (qual && QUALS.includes(qual as never)) { where.push('qualification = ?'); binds.push(qual); }
  const qs = str(p.get('q'), 100);
  if (qs) {
    const like = `%${qs.replace(/[%_]/g, '')}%`;
    where.push('(name LIKE ? OR email LIKE ? OR business LIKE ? OR phone LIKE ? OR needs LIKE ? OR tags LIKE ?)');
    binds.push(like, like, like, like, like, like);
  }
  if (p.get('from') && DATE_RE.test(p.get('from')!)) { where.push('created_at >= ?'); binds.push(p.get('from')); }
  const limit = Math.min(Number(p.get('limit')) || 500, 2000);
  const { results } = await env.DB
    .prepare(`SELECT ${LIST_COLS} FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all();
  return { leads: results };
};

const getLead: Handler = async ({ env, params }) => {
  const id = intId(params[0]);
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  if (!lead) throw new HttpError(404, 'not_found');
  const [acts, txs, evs] = await env.DB.batch([
    env.DB.prepare('SELECT a.*, u.name user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 200').bind(id),
    env.DB.prepare('SELECT * FROM transactions WHERE lead_id = ? ORDER BY date DESC').bind(id),
    env.DB.prepare(`SELECT id, created_at, type, source, ref, meta FROM events WHERE lead_id = ? AND type IN ('email_sent','email_failed','whatsapp_sent','form_submit','lead_created') ORDER BY created_at DESC LIMIT 100`).bind(id),
  ]);
  return { lead, activities: acts.results, transactions: txs.results, events: evs.results };
};

function leadPatch(b: Record<string, any>) {
  const set: Record<string, unknown> = {};
  for (const f of [...LEAD_FIELDS, 'lost_reason'] as string[]) {
    if (f in b) set[f] = str(b[f], ['needs', 'summary', 'current_situation'].includes(f) ? 8000 : 400) || null;
  }
  if ('email' in set && set.email) {
    set.email = String(set.email).toLowerCase();
    if (!EMAIL_RE.test(String(set.email))) throw new HttpError(400, 'validation', 'E-mail inválido.');
  }
  if ('qualification' in set && set.qualification && !QUALS.includes(set.qualification as never)) throw new HttpError(400, 'validation', 'Qualificação inválida.');
  if ('stage' in b) {
    if (!STAGES.includes(b.stage)) throw new HttpError(400, 'validation', 'Etapa inválida.');
    set.stage = b.stage;
  }
  if ('value_cents' in b) {
    if (b.value_cents === null || b.value_cents === '') set.value_cents = null;
    else {
      const v = Math.round(Number(b.value_cents));
      if (!Number.isFinite(v) || v < 0 || v > 1e11) throw new HttpError(400, 'validation', 'Valor inválido.');
      set.value_cents = v;
    }
  }
  if ('currency' in b) {
    if (!CURRENCIES.includes(b.currency)) throw new HttpError(400, 'validation', 'Moeda inválida.');
    set.currency = b.currency;
  }
  if ('next_action_at' in b) {
    if (b.next_action_at && !DATE_RE.test(b.next_action_at)) throw new HttpError(400, 'validation', 'Data inválida.');
    set.next_action_at = b.next_action_at || null;
  }
  if ('services' in b) {
    if (!Array.isArray(b.services)) throw new HttpError(400, 'validation', 'Serviços inválidos.');
    set.services = JSON.stringify(b.services.map((s: unknown) => str(s, 40)).filter(Boolean).slice(0, 10));
  }
  return set;
}


const createLead: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const set = leadPatch(b);
  if (!set.name && !set.email && !set.phone && !set.business) throw new HttpError(400, 'validation', 'Preencha pelo menos o nome, e-mail, telefone ou negócio.');
  const input: LeadInput = { ...(set as LeadInput), services: b.services, stage: set.stage as string | undefined };
  const { id } = await saveLead(env.DB, input, { source: 'manual', userId: user.id, note: `Lead criado por ${user.name}.` });
  // saveLead não grava estes campos; aplica-os já.
  const extra = Object.fromEntries(Object.entries(set).filter(([k]) => ['value_cents', 'currency', 'next_action_at', 'lost_reason', 'stage'].includes(k)));
  if (Object.keys(extra).length) {
    await env.DB.prepare(`UPDATE leads SET ${Object.keys(extra).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(extra), id).run();
  }
  return { ok: true, id };
};

const updateLead: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const before = await env.DB.prepare('SELECT stage, value_cents, currency, next_action_at FROM leads WHERE id = ?').bind(id).first<{ stage: string; value_cents: number | null; currency: string; next_action_at: string | null }>();
  if (!before) throw new HttpError(404, 'not_found');
  const set = leadPatch(await readBody(req));
  if (!Object.keys(set).length) return { ok: true };
  if (set.stage && set.stage !== before.stage) {
    set.closed_at = ['won', 'lost'].includes(set.stage as string) ? now() : null;
  }
  set.updated_at = now();
  await env.DB.prepare(`UPDATE leads SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), id).run();

  if (set.stage && set.stage !== before.stage) {
    await addActivity(env.DB, id, 'stage', `Etapa: ${STAGE_LABEL[before.stage]} → ${STAGE_LABEL[set.stage as string]}${set.lost_reason ? ` (motivo: ${set.lost_reason})` : ''}`, user.id);
  }
  if ('value_cents' in set && set.value_cents !== before.value_cents) {
    await addActivity(env.DB, id, 'update', `Valor do negócio: ${set.value_cents == null ? '—' : (Number(set.value_cents) / 100).toFixed(2) + ' ' + (set.currency || before.currency)}`, user.id);
  }
  if ('next_action_at' in set && set.next_action_at !== before.next_action_at && set.next_action_at) {
    await addActivity(env.DB, id, 'update', `Próxima ação marcada para ${set.next_action_at}.`, user.id);
  }
  return { ok: true };
};

const deleteLead: Handler = async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(intId(params[0])).run();
  return { ok: true };
};

const addLeadActivity: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const b = await readBody(req);
  const type = ACTIVITY_TYPES.includes(b.type) ? b.type : 'note';
  const content = str(b.content, 8000);
  if (!content) throw new HttpError(400, 'validation', 'Escreva a nota.');
  if (!(await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first())) throw new HttpError(404, 'not_found');
  await addActivity(env.DB, id, type, content, user.id);
  const set: string[] = ['updated_at = ?'];
  const binds: unknown[] = [now()];
  // Primeiro contacto registado: passa de "Novo" para "Em contato".
  if (['call', 'email', 'whatsapp', 'meeting'].includes(type)) {
    const lead = await env.DB.prepare('SELECT stage FROM leads WHERE id = ?').bind(id).first<{ stage: string }>();
    if (lead?.stage === 'new') {
      set.push(`stage = 'contacted'`);
      await addActivity(env.DB, id, 'stage', 'Etapa: Novo → Em contato (primeiro contacto registado)', user.id);
    }
  }
  await env.DB.prepare(`UPDATE leads SET ${set.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  return { ok: true };
};

const deleteActivity: Handler = async ({ env, params, user }) => {
  const id = intId(params[0]);
  const a = await env.DB.prepare('SELECT user_id, type FROM activities WHERE id = ?').bind(id).first<{ user_id: number | null; type: string }>();
  if (!a) throw new HttpError(404, 'not_found');
  if (!ACTIVITY_TYPES.includes(a.type)) throw new HttpError(400, 'validation', 'Só pode apagar notas e contactos registados à mão.');
  if (a.user_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'forbidden');
  await env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id).run();
  return { ok: true };
};

/* ---------- CSV ---------- */
function csv(rows: Record<string, unknown>[], cols: string[], name: string) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas no Excel
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${today()}.csv"`, ...SECURITY_HEADERS },
  });
}

const exportLeads: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  const cols = ['id', 'created_at', 'source', 'stage', 'qualification', 'name', 'email', 'phone', 'business', 'business_type', 'country', 'location', 'language', 'services', 'needs', 'timeline', 'budget', 'decision_maker', 'summary', 'next_step', 'value_cents', 'currency', 'next_action_at', 'lost_reason', 'tags', 'page'];
  return csv(results as Record<string, unknown>[], cols, 'leads');
};

const exportTransactions: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT t.*, l.name lead_name FROM transactions t LEFT JOIN leads l ON l.id = t.lead_id ORDER BY date DESC').all();
  return csv(
    (results as any[]).map((r) => ({ ...r, amount: (r.amount_cents / 100).toFixed(2) })),
    ['id', 'date', 'kind', 'category', 'description', 'amount', 'currency', 'status', 'recurring', 'lead_name'],
    'financeiro',
  );
};

/* ====================================================================== */
/* Financeiro                                                             */
/* ====================================================================== */

function txPatch(b: Record<string, any>, partial = false) {
  const set: Record<string, unknown> = {};
  if (!partial || 'date' in b) {
    if (!DATE_RE.test(b.date || '')) throw new HttpError(400, 'validation', 'Data inválida.');
    set.date = b.date;
  }
  if (!partial || 'kind' in b) {
    if (!['income', 'expense'].includes(b.kind)) throw new HttpError(400, 'validation', 'Tipo inválido.');
    set.kind = b.kind;
  }
  if (!partial || 'amount_cents' in b) {
    const v = Math.round(Number(b.amount_cents));
    if (!Number.isFinite(v) || v <= 0 || v > 1e11) throw new HttpError(400, 'validation', 'Valor inválido.');
    set.amount_cents = v;
  }
  if (!partial || 'currency' in b) {
    const c = b.currency || 'EUR';
    if (!CURRENCIES.includes(c)) throw new HttpError(400, 'validation', 'Moeda inválida.');
    set.currency = c;
  }
  if (!partial || 'status' in b) {
    const s = b.status || 'paid';
    if (!['paid', 'pending'].includes(s)) throw new HttpError(400, 'validation', 'Estado inválido.');
    set.status = s;
  }
  if (!partial || 'category' in b) set.category = str(b.category, 60) || 'Outros';
  if (!partial || 'description' in b) set.description = str(b.description, 400) || null;
  if (!partial || 'recurring' in b) set.recurring = b.recurring ? 1 : 0;
  if (!partial || 'lead_id' in b) set.lead_id = b.lead_id ? Number(b.lead_id) || null : null;
  return set;
}

const listTransactions: Handler = async ({ env, url }) => {
  const p = url.searchParams;
  const from = DATE_RE.test(p.get('from') || '') ? p.get('from')! : '2000-01-01';
  const to = DATE_RE.test(p.get('to') || '') ? p.get('to')! : '2999-12-31';
  const { results } = await env.DB
    .prepare('SELECT t.*, l.name lead_name, l.business lead_business FROM transactions t LEFT JOIN leads l ON l.id = t.lead_id WHERE t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC LIMIT 2000')
    .bind(from, to)
    .all();
  const cats = await env.DB.prepare('SELECT DISTINCT category FROM transactions ORDER BY category').all<{ category: string }>();
  return { transactions: results, categories: cats.results.map((c) => c.category) };
};

const createTransaction: Handler = async ({ req, env, user }) => {
  const set = txPatch(await readBody(req));
  set.user_id = user.id;
  const row = await env.DB
    .prepare(`INSERT INTO transactions (${Object.keys(set).join(', ')}) VALUES (${Object.keys(set).map(() => '?').join(', ')}) RETURNING id`)
    .bind(...Object.values(set))
    .first<{ id: number }>();
  if (set.lead_id) {
    await addActivity(env.DB, Number(set.lead_id), 'update', `${set.kind === 'income' ? 'Receita' : 'Despesa'} registada: ${(Number(set.amount_cents) / 100).toFixed(2)} ${set.currency} (${set.status === 'paid' ? 'paga' : 'a receber'}).`, user.id);
  }
  return { ok: true, id: row!.id };
};

const updateTransaction: Handler = async ({ req, env, params }) => {
  const id = intId(params[0]);
  const set = txPatch(await readBody(req), true);
  if (!Object.keys(set).length) return { ok: true };
  const r = await env.DB.prepare(`UPDATE transactions SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), id).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found');
  return { ok: true };
};

const deleteTransaction: Handler = async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(intId(params[0])).run();
  return { ok: true };
};

/* ====================================================================== */
/* Ava e agentes                                                          */
/* ====================================================================== */

const agent: Handler = async ({ env, url }) => {
  const range = url.searchParams.get('range') || '30';
  const from = rangeStart(range);
  const db = env.DB;
  const [daily, emailsDaily, emailsBySource, recentEmails, chatLeads, pages, agentEvents] = await db.batch([
    db.prepare(`SELECT substr(created_at,1,10) d, COUNT(*) messages, COUNT(DISTINCT ref) conversations FROM events WHERE type = 'chat_message' AND created_at >= ? GROUP BY d`).bind(from),
    db.prepare(`SELECT substr(created_at,1,10) d, source, COUNT(*) n FROM events WHERE type = 'email_sent' AND created_at >= ? GROUP BY d, source`).bind(from),
    db.prepare(`SELECT source, type, COUNT(*) n FROM events WHERE type IN ('email_sent','email_failed') AND created_at >= ? GROUP BY source, type`).bind(from),
    db.prepare(`SELECT e.id, e.created_at, e.type, e.source, e.ref, e.meta, e.lead_id, l.name lead_name FROM events e LEFT JOIN leads l ON l.id = e.lead_id WHERE e.type IN ('email_sent','email_failed') ORDER BY e.created_at DESC LIMIT 200`),
    db.prepare(`SELECT id, created_at, name, business, qualification, stage, summary FROM leads WHERE source = 'chat' AND created_at >= ? ORDER BY created_at DESC LIMIT 50`).bind(from),
    db.prepare(`SELECT json_extract(meta,'$.page') page, COUNT(DISTINCT ref) conversations FROM events WHERE type = 'chat_message' AND created_at >= ? GROUP BY page ORDER BY conversations DESC LIMIT 8`).bind(from),
    db.prepare(`SELECT type, COUNT(*) n FROM events WHERE source = 'agent' AND created_at >= ? GROUP BY type`).bind(from),
  ]);
  const d = daily.results as { d: string; messages: number; conversations: number }[];
  const conversations = (await db.prepare(`SELECT COUNT(DISTINCT ref) n FROM events WHERE type = 'chat_message' AND created_at >= ?`).bind(from).first<{ n: number }>())!.n;
  const leadCount = (chatLeads.results as unknown[]).length;
  return {
    range,
    from,
    totals: {
      conversations,
      messages: d.reduce((a, x) => a + x.messages, 0),
      leads: leadCount,
      conversion: conversations ? leadCount / conversations : 0,
      avgMessages: conversations ? d.reduce((a, x) => a + x.messages, 0) / conversations : 0,
    },
    daily: d,
    emailsDaily: emailsDaily.results,
    emailsBySource: emailsBySource.results,
    recentEmails: recentEmails.results,
    chatLeads: chatLeads.results,
    pages: pages.results,
    agentEvents: agentEvents.results,
  };
};

/* ====================================================================== */
/* Utilizadores (admin)                                                   */
/* ====================================================================== */

const listUsers: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT id, email, name, role, status, created_at, last_login_at FROM users ORDER BY status = \'pending\' DESC, created_at').all();
  return { users: results };
};

const createUser: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  if (!name || !EMAIL_RE.test(email)) throw new HttpError(400, 'validation', 'Nome e e-mail válidos são obrigatórios.');
  const weak = weakPassword(String(b.password ?? ''));
  if (weak) throw new HttpError(400, 'validation', weak);
  const role = b.role === 'admin' ? 'admin' : 'member';
  if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'exists', 'Já existe um utilizador com este e-mail.');
  await env.DB.prepare(`INSERT INTO users (email, name, password_hash, role, status) VALUES (?, ?, ?, ?, 'active')`).bind(email, name, await hashPassword(String(b.password)), role).run();
  return { ok: true };
};

const updateUser: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const b = await readBody(req);
  const set: Record<string, unknown> = {};
  if ('name' in b) set.name = str(b.name, 120) || undefined;
  if ('role' in b) set.role = b.role === 'admin' ? 'admin' : 'member';
  if ('status' in b) {
    if (!['active', 'disabled', 'pending'].includes(b.status)) throw new HttpError(400, 'validation', 'Estado inválido.');
    set.status = b.status;
  }
  if (id === user.id && (set.role === 'member' || (set.status && set.status !== 'active'))) throw new HttpError(400, 'validation', 'Não pode retirar o seu próprio acesso de admin.');
  if (b.password) {
    const weak = weakPassword(String(b.password));
    if (weak) throw new HttpError(400, 'validation', weak);
    set.password_hash = await hashPassword(String(b.password));
  }
  for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];
  if (!Object.keys(set).length) return { ok: true };
  const target = await env.DB.prepare('SELECT status, email, name FROM users WHERE id = ?').bind(id).first<{ status: string; email: string; name: string }>();
  if (!target) throw new HttpError(404, 'not_found');
  await env.DB.prepare(`UPDATE users SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), id).run();
  if (set.status && set.status !== 'active') await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  return { ok: true };
};

const deleteUser: Handler = async ({ env, params, user }) => {
  const id = intId(params[0]);
  if (id === user.id) throw new HttpError(400, 'validation', 'Não pode apagar a sua própria conta.');
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return { ok: true };
};

/* ====================================================================== */
/* Configurações (admin)                                                  */
/* ====================================================================== */

async function ingestKey(db: D1Database) {
  let key = await getSetting(db, 'ingest_key');
  if (!key) {
    key = `phs_${randomToken(24)}`;
    await setSetting(db, 'ingest_key', key);
  }
  return key;
}

const getSettings: Handler = async ({ env }) => {
  const [key, digest, last] = await Promise.all([
    ingestKey(env.DB),
    getSetting(env.DB, 'digest_enabled'),
    env.DB.prepare(`SELECT created_at, type FROM events WHERE source = 'agent' ORDER BY created_at DESC LIMIT 1`).first<{ created_at: string; type: string }>(),
  ]);
  return { ingestKey: key, digestEnabled: digest !== '0', notifyTo: notifyTo(env), lastAgentEvent: last, endpoint: `${ADMIN_URL}/api/ingest` };
};

const patchSettings: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  if ('digestEnabled' in b) await setSetting(env.DB, 'digest_enabled', b.digestEnabled ? '1' : '0');
  return { ok: true };
};

const rotateKey: Handler = async ({ env }) => {
  const key = `phs_${randomToken(24)}`;
  await setSetting(env.DB, 'ingest_key', key);
  return { ingestKey: key };
};

const testEmail: Handler = async ({ env, user }) => {
  const ok = await sendMail(
    env,
    {
      to: notifyTo(env),
      from: FROM,
      subject: 'Teste do painel Pipe Hero Studio',
      text: `E-mail de teste pedido por ${user.name}. Se chegou, os avisos estão a funcionar.\n\n${ADMIN_URL}`,
      html: emailLayout('Os avisos estão a funcionar', `<p>E-mail de teste pedido por ${escHtml(user.name)}.</p><p>Vai receber aqui os novos leads, os cadastros no painel e o resumo diário.</p>`, { label: 'Abrir o painel', href: ADMIN_URL }),
    },
    { source: 'system', kind: 'test' },
  );
  if (!ok) throw new HttpError(502, 'send_failed', `Não foi possível enviar para ${notifyTo(env)}. Veja o registo de e-mails (Agente → E-mails) para o erro.`);
  return { ok: true, to: notifyTo(env) };
};

const digestNow: Handler = async ({ env }) => {
  const r = await sendDigest(env, { force: true });
  if (!r.sent) throw new HttpError(502, 'send_failed', 'Não foi possível enviar o resumo. Veja o registo de e-mails.');
  return { ok: true };
};

/** Importa os leads antigos da Ava que estavam só no KV (não duplica). */
const importKv: Handler = async ({ env }) => {
  let imported = 0, skipped = 0, cursor: string | undefined;
  do {
    const page = await env.LEADS.list({ prefix: 'lead:', cursor });
    for (const k of page.keys) {
      const rec = await env.LEADS.get<Record<string, any>>(k.name, 'json');
      if (!rec) continue;
      const sid = String(rec.sessionId || '');
      if (sid && (await env.DB.prepare('SELECT id FROM leads WHERE session_id = ?').bind(sid).first())) { skipped++; continue; }
      await saveLead(
        env.DB,
        {
          ...Object.fromEntries(LEAD_FIELDS.filter((f) => typeof rec[f] === 'string').map((f) => [f, rec[f]])),
          country: rec.location || null,
          ip_country: rec.country_ip || null,
          services: Array.isArray(rec.services) ? rec.services : [],
          transcript: Array.isArray(rec.transcript) ? rec.transcript : [],
          created_at: rec.when,
        },
        { source: 'chat', sessionId: sid || null, note: `Importado do histórico da Ava: ${rec.summary || ''}` },
      );
      imported++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { ok: true, imported, skipped };
};

/* ====================================================================== */
/* API para agentes externos                                              */
/* ====================================================================== */

async function checkIngest(req: Request, env: AppEnv) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const auth = req.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : req.headers.get('X-API-Key') || '';
  if (!(await env.INGEST_RL.limit({ key: given.slice(0, 12) || ip })).success) throw new HttpError(429, 'rate_limited');
  const key = await getSetting(env.DB, 'ingest_key');
  if (!key || !given) throw new HttpError(401, 'unauthorized', 'Falta a chave da API (Authorization: Bearer ...).');
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(given)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  if (!crypto.subtle.timingSafeEqual(a, b)) throw new HttpError(401, 'unauthorized', 'Chave da API inválida.');
}

async function findLeadId(db: D1Database, b: Record<string, any>) {
  if (b.lead_id && Number.isInteger(Number(b.lead_id))) {
    const r = await db.prepare('SELECT id FROM leads WHERE id = ?').bind(Number(b.lead_id)).first<{ id: number }>();
    if (r) return r.id;
  }
  const email = str(b.lead_email || b.to, 200).toLowerCase();
  if (EMAIL_RE.test(email)) {
    const r = await db.prepare('SELECT id FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1').bind(email).first<{ id: number }>();
    if (r) return r.id;
  }
  return null;
}

const ingestLead: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const input: LeadInput = {};
  for (const f of LEAD_FIELDS) if (b[f] != null) (input as any)[f] = str(b[f], 8000);
  if (b.message && !input.needs) input.needs = str(b.message, 8000);
  if (b.company && !input.business) input.business = str(b.company, 400);
  if (input.email && !EMAIL_RE.test(input.email)) throw new HttpError(400, 'validation', 'email inválido.');
  if (!input.name && !input.email && !input.phone) throw new HttpError(400, 'validation', 'Envie pelo menos name, email ou phone.');
  if (Array.isArray(b.services)) input.services = b.services.map((s: unknown) => str(s, 40));
  if (Array.isArray(b.transcript)) input.transcript = b.transcript.slice(0, 100).map((m: any) => ({ role: str(m?.role, 20), content: str(m?.content, 4000) }));
  if (b.value != null && Number.isFinite(Number(b.value))) input.value_cents = Math.round(Number(b.value) * 100);
  if (b.currency && CURRENCIES.includes(String(b.currency).toUpperCase())) input.currency = String(b.currency).toUpperCase();
  const agentName = str(b.agent || 'agente externo', 60);
  const sessionId = b.session_id ? `agent:${str(b.session_id, 100)}` : null;
  const { id, created } = await saveLead(env.DB, input, { source: 'agent', sessionId, note: `Recebido de ${agentName}${input.summary ? ': ' + input.summary : ''}` });

  if (created && b.notify !== false) {
    const link = `${ADMIN_URL}/#/leads/${id}`;
    const rows: [string, string | undefined | null][] = [
      ['Nome', input.name], ['E-mail', input.email], ['Telefone', input.phone], ['Negócio', input.business], ['Local', input.location || input.country],
      ['Qualificação', input.qualification], ['Necessidade', input.needs], ['Próximo passo', input.next_step],
    ];
    const filled = rows.filter(([, v]) => v);
    await sendMail(
      env,
      {
        to: notifyTo(env),
        from: FROM,
        ...(input.email ? { replyTo: input.email } : {}),
        subject: `Novo lead (${agentName}): ${input.name || input.email || input.phone}${input.business ? ' — ' + input.business : ''}`,
        text: `${input.summary || ''}\n\n${filled.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nAbrir no CRM: ${link}\n`,
        html: emailLayout(
          `Novo lead de ${escHtml(agentName)}`,
          `${input.summary ? `<p><strong>${escHtml(input.summary)}</strong></p>` : ''}<table cellpadding="6" style="border-collapse:collapse">${filled.map(([k, v]) => `<tr><td style="color:#4a556b;vertical-align:top">${k}</td><td>${escHtml(String(v))}</td></tr>`).join('')}</table>`,
          { label: 'Abrir no CRM', href: link },
        ),
      },
      { source: 'system', leadId: id, kind: 'lead_agent' },
    );
  }
  return json({ ok: true, lead_id: id, created, url: `${ADMIN_URL}/#/leads/${id}` }, created ? 201 : 200);
};

const EVENT_TYPES = ['email_sent', 'email_failed', 'email_opened', 'email_replied', 'whatsapp_sent', 'call', 'meeting_booked', 'message', 'note'];

const ingestEvent: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const list: Record<string, any>[] = Array.isArray(b.events) ? b.events.slice(0, 100) : [b];
  const out: { type: string; lead_id: number | null }[] = [];
  for (const e of list) {
    const type = str(e.type || 'email_sent', 40);
    if (!EVENT_TYPES.includes(type)) throw new HttpError(400, 'validation', `type inválido. Use: ${EVENT_TYPES.join(', ')}`);
    const leadId = await findLeadId(env.DB, e);
    const meta = {
      agent: str(e.agent, 60) || null,
      subject: str(e.subject, 200) || null,
      summary: str(e.summary || e.body_preview, 500) || null,
      kind: str(e.kind, 40) || null,
      status: str(e.status, 40) || null,
    };
    await logEvent(env.DB, type, 'agent', { ref: str(e.to || e.lead_email || e.ref, 200) || null, leadId, meta, at: e.at && !isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : undefined });
    if (leadId) {
      const label: Record<string, string> = {
        email_sent: 'E-mail enviado', email_failed: 'E-mail falhou', email_opened: 'E-mail aberto', email_replied: 'E-mail respondido',
        whatsapp_sent: 'WhatsApp enviado', call: 'Chamada', meeting_booked: 'Reunião marcada', message: 'Mensagem', note: 'Nota',
      };
      const actType = type.startsWith('email') ? 'email' : type === 'whatsapp_sent' ? 'whatsapp' : type === 'call' ? 'call' : type === 'meeting_booked' ? 'meeting' : 'note';
      await addActivity(env.DB, leadId, actType, `${label[type]} pelo ${meta.agent || 'agente'}${meta.subject ? `: "${meta.subject}"` : ''}${meta.summary ? `\n${meta.summary}` : ''}`);
      if (type === 'meeting_booked') await env.DB.prepare(`UPDATE leads SET stage = 'meeting', updated_at = ? WHERE id = ? AND stage IN ('new','contacted')`).bind(now(), leadId).run();
      else if (['email_sent', 'whatsapp_sent', 'call'].includes(type)) await env.DB.prepare(`UPDATE leads SET stage = 'contacted', updated_at = ? WHERE id = ? AND stage = 'new'`).bind(now(), leadId).run();
    }
    out.push({ type, lead_id: leadId });
  }
  return json({ ok: true, recorded: out.length, events: out }, 201);
};

/* ====================================================================== */
/* Router                                                                 */
/* ====================================================================== */

const routes: [string, RegExp, Handler, Access][] = [
  ['POST', /^\/api\/auth\/login$/, login, 'public'],
  ['POST', /^\/api\/auth\/logout$/, logout, 'public'],
  ['POST', /^\/api\/auth\/signup$/, signup, 'public'],
  ['GET', /^\/api\/me$/, me, 'user'],
  ['PATCH', /^\/api\/me$/, updateMe, 'user'],
  ['POST', /^\/api\/me\/password$/, changePassword, 'user'],
  ['GET', /^\/api\/stats$/, stats, 'user'],
  ['GET', /^\/api\/leads$/, listLeads, 'user'],
  ['POST', /^\/api\/leads$/, createLead, 'user'],
  ['GET', /^\/api\/leads\/(\d+)$/, getLead, 'user'],
  ['PATCH', /^\/api\/leads\/(\d+)$/, updateLead, 'user'],
  ['DELETE', /^\/api\/leads\/(\d+)$/, deleteLead, 'admin'],
  ['POST', /^\/api\/leads\/(\d+)\/activities$/, addLeadActivity, 'user'],
  ['DELETE', /^\/api\/activities\/(\d+)$/, deleteActivity, 'user'],
  ['GET', /^\/api\/export\/leads\.csv$/, exportLeads, 'user'],
  ['GET', /^\/api\/export\/transactions\.csv$/, exportTransactions, 'user'],
  ['GET', /^\/api\/transactions$/, listTransactions, 'user'],
  ['POST', /^\/api\/transactions$/, createTransaction, 'user'],
  ['PATCH', /^\/api\/transactions\/(\d+)$/, updateTransaction, 'user'],
  ['DELETE', /^\/api\/transactions\/(\d+)$/, deleteTransaction, 'user'],
  ['GET', /^\/api\/agent$/, agent, 'user'],
  ['GET', /^\/api\/users$/, listUsers, 'admin'],
  ['POST', /^\/api\/users$/, createUser, 'admin'],
  ['PATCH', /^\/api\/users\/(\d+)$/, updateUser, 'admin'],
  ['DELETE', /^\/api\/users\/(\d+)$/, deleteUser, 'admin'],
  ['GET', /^\/api\/settings$/, getSettings, 'admin'],
  ['PATCH', /^\/api\/settings$/, patchSettings, 'admin'],
  ['POST', /^\/api\/settings\/rotate-key$/, rotateKey, 'admin'],
  ['POST', /^\/api\/settings\/test-email$/, testEmail, 'admin'],
  ['POST', /^\/api\/settings\/digest-now$/, digestNow, 'admin'],
  ['POST', /^\/api\/settings\/import-kv$/, importKv, 'admin'],
  ['GET', /^\/api\/ingest\/ping$/, async () => ({ ok: true, service: 'Pipe Hero Studio CRM' }), 'ingest'],
  ['POST', /^\/api\/ingest\/lead$/, ingestLead, 'ingest'],
  ['POST', /^\/api\/ingest\/event$/, ingestEvent, 'ingest'],
  ['POST', /^\/api\/ingest\/email$/, async (c) => ingestEvent(c), 'ingest'],
];

async function handleApi(req: Request, env: AppEnv, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  let methodMatched = false;
  for (const [method, re, handler, access] of routes) {
    const m = path.match(re);
    if (!m) continue;
    methodMatched = true;
    if (method !== req.method) continue;

    if (access === 'ingest') {
      await checkIngest(req, env);
      const out = await handler({ req, env, url, user: null as unknown as User, params: m.slice(1), ctx });
      return out instanceof Response ? out : json(out);
    }
    // Pedidos que alteram dados só do próprio painel (proteção CSRF, além do cookie SameSite=Strict).
    if (req.method !== 'GET') {
      const origin = req.headers.get('Origin');
      if (!origin || new URL(origin).host !== url.host) throw new HttpError(403, 'forbidden_origin');
    }
    let user: User | null = null;
    if (access !== 'public') {
      user = await getUser(env.DB, req);
      if (!user) throw new HttpError(401, 'unauthorized', 'Sessão expirada. Entre novamente.');
      if (access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Só administradores.');
    }
    const out = await handler({ req, env, url, user: user!, params: m.slice(1), ctx });
    return out instanceof Response ? out : json(out);
  }
  throw new HttpError(methodMatched ? 405 : 404, methodMatched ? 'method_not_allowed' : 'not_found');
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, ctx, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
        console.error('admin: error', url.pathname, (e as Error).stack || (e as Error).message);
        return json({ ok: false, error: 'internal_error', message: 'Erro interno. Tente de novo.' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
        await sendDigest(env, { force: false });
      })(),
    );
  },
} satisfies ExportedHandler<AppEnv>;

