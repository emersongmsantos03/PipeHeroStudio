/**
 * admin.pipeherostudio.digital — painel da Pipe Hero Studio.
 *
 *  /api/auth/*       login, logout, pedido de acesso (cadastro → aprovação + e-mail ao Emerson)
 *  /api/me           conta do utilizador
 *  /api/stats        visão geral (leads, Ava, e-mails, financeiro)
 *  /api/leads        CRM (lista, quadro, detalhe, notas, etapas, ações em massa, importação CSV)
 *  /api/tasks        tarefas (follow-ups, chamadas, reuniões) por responsável
 *  /api/templates    modelos de mensagem para WhatsApp / e-mail
 *  /api/reports      relatórios (taxa de ganho, motivos de perda, previsão, equipa)
 *  /api/team         equipa ativa (para atribuir leads e tarefas)
 *  /api/transactions financeiro
 *  /api/agent        métricas da Ava e de agentes externos, registo de e-mails
 *  /api/users        utilizadores (admin)
 *  /api/settings     chave da API, resumo diário, e-mail de teste, importação (admin)
 *  /api/ingest/*     API para agentes externos (n8n, Make, GPT…) com chave Bearer
 *  /api/prospects    lista de prospecção (todos os negócios do prospector, "não contatar")
 *  /api/assistant    aba Assistente (fila de perguntas para o agente Qwen no PC)
 *  /api/bridge/*     usado só pelo agente no PC (chave ASSISTANT_KEY): fila, consulta só-leitura e CRUD
 *  cron              resumo diário por e-mail
 */
import { detailingStats } from './detailing';
import { createSession, destroySession, getUser, hashPassword, randomToken, sha256, verifyPassword, weakPassword, type User } from './auth';
import {
  ADMIN_URL, LEAD_FIELDS, QUALS, SOURCES, STAGES, addActivity, escHtml, logEvent, now, saveLead, sendMail, type LeadInput,
} from '../../shared/crm';
import { emailLayout, sendDigest } from './digest';
import { CAMPAIGN_STATS } from './campaign-stats';
import { readCampaign } from '../../shared/campaign';
import { instagramSource, readInstagramProfile, readInstagramInsights, refreshInstagramToken, instagramErrorMessage, type InstagramProfile } from './instagram';
import { DEFAULT_RULES, brt as brtOf, freeSlots, loadRules, normalizeRules } from '../../shared/booking';
import { FROM, STAGE_LABEL, getSetting, notifyTo, setSetting, type AppEnv } from './common';

const CURRENCIES = ['EUR', 'USD', 'BRL', 'GBP'];
const ACTIVITY_TYPES = ['note', 'call', 'email', 'whatsapp', 'meeting'];
const TASK_TYPES = ['todo', 'call', 'email', 'whatsapp', 'meeting'];
const TEMPLATE_CHANNELS = ['any', 'whatsapp', 'email'];
/** Atividades feitas por pessoas (contam como "última atividade"). */
const HUMAN_ACTS = `'note','call','email','whatsapp','meeting','task'`;
/** Probabilidade de fecho por etapa, quando o lead não tem uma definida. */
const STAGE_PROB: Record<string, number> = { new: 10, contacted: 20, meeting: 40, proposal: 60, won: 100, lost: 0 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code);
  }
}

type Ctx = { req: Request; env: AppEnv; url: URL; user: User; params: string[]; ctx: ExecutionContext };
type Handler = (c: Ctx) => Promise<Response | unknown>;
type Access = 'public' | 'user' | 'admin' | 'ingest' | 'assistant';

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
/** "Hoje" no fuso do utilizador (o browser envia ?today=YYYY-MM-DD); se não vier, usa UTC. */
const userToday = (url: URL) => {
  const t = url.searchParams.get('today') || '';
  return DATE_RE.test(t) ? t : today();
};

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

const me: Handler = async ({ user, env, url }) => {
  const [p, t] = await env.DB.batch<{ n: number }>([
    env.DB.prepare(`SELECT COUNT(*) n FROM users WHERE status = 'pending'`),
    env.DB.prepare(`SELECT COUNT(*) n FROM tasks WHERE done_at IS NULL AND due_date <= ? AND (assignee_id = ? OR assignee_id IS NULL)`).bind(userToday(url), user.id),
  ]);
  return { user, pendingUsers: user.role === 'admin' ? p.results[0]?.n || 0 : 0, tasksDue: t.results[0]?.n || 0 };
};

/** Equipa ativa (para atribuir leads e tarefas). */
const team: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare(`SELECT id, name, email, role FROM users WHERE status = 'active' ORDER BY name`).all();
  return { users: results };
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

const stats: Handler = async ({ env, url, user }) => {
  const range = url.searchParams.get('range') || '30';
  const tday = userToday(url);
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
    /* 12 */ q(`SELECT t.id, t.title, t.type, t.due_date, t.due_time, t.lead_id, l.name lead_name, l.business lead_business FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
               WHERE t.done_at IS NULL AND t.due_date <= ? AND (t.assignee_id = ? OR t.assignee_id IS NULL) ORDER BY t.due_date, t.due_time IS NULL, t.due_time LIMIT 8`, tday, user.id),
    /* 13 */ q(`SELECT currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE kind = 'income' AND recurring = 1 AND date >= ? GROUP BY currency`, new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)),
    /* 14 */ q(`SELECT kind, currency, COALESCE(SUM(amount_cents),0) total FROM transactions WHERE status = 'paid' AND date >= ? GROUP BY kind, currency`, monthStart),
    /* 15 */ q(`SELECT qualification q, COUNT(*) n FROM leads WHERE created_at >= ? GROUP BY q`, from),
    /* 16 */ q(`SELECT COUNT(*) n FROM users WHERE status = 'pending'`),
    /* 17 */ q(`SELECT COUNT(*) n FROM leads WHERE stage = 'new'`),
    /* 18 */ q(`SELECT a.id, a.created_at, a.type, a.content, a.lead_id, l.name lead_name, l.business lead_business, u.name user_name
               FROM activities a JOIN leads l ON l.id = a.lead_id LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC, a.id DESC LIMIT 10`),
    /* 19 */ q(`SELECT stage, probability, currency, value_cents FROM leads WHERE stage NOT IN ('won','lost') AND value_cents > 0`),
    /* 20 */ q(`SELECT COUNT(*) n FROM leads WHERE stage IN ('won','lost') AND closed_at >= ?`, from),
    /* 21 */ q(`SELECT COUNT(*) n FROM tasks WHERE done_at IS NULL AND due_date < ? AND (assignee_id = ? OR assignee_id IS NULL)`, tday, user.id),
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
  const closedCount = r<{ n: number }>(20)[0]?.n || 0;
  const weighted: Record<string, number> = {};
  for (const l of r<{ stage: string; probability: number | null; currency: string; value_cents: number }>(19)) {
    const p = l.probability ?? STAGE_PROB[l.stage] ?? 0;
    weighted[l.currency] = (weighted[l.currency] || 0) + Math.round((l.value_cents * p) / 100);
  }
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
      winRate: closedCount ? wonCount / closedCount : null,
      openValue,
      weightedValue: weighted,
      newCount: r<{ n: number }>(17)[0]?.n || 0,
    },
    tasks: { due: r(12), overdue: r<{ n: number }>(21)[0]?.n || 0 },
    activity: r(18),
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
  };
};

/* ====================================================================== */
/* CRM                                                                    */
/* ====================================================================== */

const LIST_COLS = `l.id, l.created_at, l.updated_at, l.source, l.stage, l.qualification, l.name, l.email, l.phone, l.business, l.business_type,
  l.country, l.location, l.services, l.value_cents, l.currency, l.next_action_at, l.next_step, l.summary, substr(l.needs,1,300) needs, l.language,
  l.tags, l.closed_at, l.owner_id, u.name owner_name, l.expected_close_at, l.probability,
  (SELECT MAX(a.created_at) FROM activities a WHERE a.lead_id = l.id AND a.type IN (${HUMAN_ACTS})) last_activity_at,
  (SELECT MAX(a.created_at) FROM activities a WHERE a.lead_id = l.id AND a.type = 'stage') stage_changed_at,
  (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.done_at IS NULL) open_tasks`;

const listLeads: Handler = async ({ env, url, user }) => {
  const p = url.searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  const stage = p.get('stage');
  if (stage && STAGES.includes(stage as never)) { where.push('l.stage = ?'); binds.push(stage); }
  if (p.get('open') === '1') where.push(`l.stage NOT IN ('won','lost')`);
  const source = p.get('source');
  if (source && SOURCES.includes(source as never)) { where.push('l.source = ?'); binds.push(source); }
  const qual = p.get('qualification');
  if (qual && QUALS.includes(qual as never)) { where.push('l.qualification = ?'); binds.push(qual); }
  const owner = p.get('owner');
  if (owner === 'me') { where.push('l.owner_id = ?'); binds.push(user.id); }
  else if (owner === 'none') where.push('l.owner_id IS NULL');
  else if (owner && /^\d+$/.test(owner)) { where.push('l.owner_id = ?'); binds.push(Number(owner)); }
  const tag = str(p.get('tag'), 40).replace(/[%_,]/g, '');
  if (tag) { where.push(`(',' || REPLACE(COALESCE(l.tags,''), ', ', ',') || ',') LIKE ?`); binds.push(`%,${tag},%`); }
  const qs = str(p.get('q'), 100);
  if (qs) {
    const like = `%${qs.replace(/[%_]/g, '')}%`;
    where.push('(l.name LIKE ? OR l.email LIKE ? OR l.business LIKE ? OR l.phone LIKE ? OR l.needs LIKE ? OR l.tags LIKE ?)');
    binds.push(like, like, like, like, like, like);
  }
  if (p.get('from') && DATE_RE.test(p.get('from')!)) { where.push('l.created_at >= ?'); binds.push(p.get('from')); }
  const limit = Math.min(Number(p.get('limit')) || 500, 2000);
  const { results } = await env.DB
    .prepare(`SELECT ${LIST_COLS} FROM leads l LEFT JOIN users u ON u.id = l.owner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.created_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all();
  return { leads: results };
};

/** Todas as etiquetas em uso (para filtros e sugestões). */
const listTags: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare(`SELECT tags FROM leads WHERE tags IS NOT NULL AND tags != ''`).all<{ tags: string }>();
  const count: Record<string, number> = {};
  for (const r of results) for (const t of splitTags(r.tags)) count[t] = (count[t] || 0) + 1;
  return { tags: Object.entries(count).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })) };
};

const splitTags = (s: string | null | undefined) => [...new Set(String(s || '').split(',').map((t) => t.trim()).filter(Boolean))];
const joinTags = (list: unknown[]) => [...new Set(list.map((t) => str(t, 40).replace(/,/g, ' ').trim()).filter(Boolean))].slice(0, 20).join(', ') || null;

const getLead: Handler = async ({ env, params }) => {
  const id = intId(params[0]);
  const lead = await env.DB.prepare('SELECT l.*, u.name owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = ?').bind(id).first();
  if (!lead) throw new HttpError(404, 'not_found');
  const [acts, txs, evs, tks] = await env.DB.batch([
    env.DB.prepare('SELECT a.*, u.name user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 200').bind(id),
    env.DB.prepare('SELECT * FROM transactions WHERE lead_id = ? ORDER BY date DESC').bind(id),
    env.DB.prepare(`SELECT id, created_at, type, source, ref, meta FROM events WHERE lead_id = ? AND type IN ('email_sent','email_failed','whatsapp_sent','form_submit','meeting_booked','lead_created') ORDER BY created_at DESC, id DESC LIMIT 100`).bind(id),
    env.DB.prepare(`SELECT t.*, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.lead_id = ? ORDER BY t.done_at IS NOT NULL, t.due_date IS NULL, t.due_date, t.due_time, t.id DESC LIMIT 100`).bind(id),
  ]);
  return { lead, activities: acts.results, transactions: txs.results, events: evs.results, tasks: tks.results };
};

function leadPatch(b: Record<string, any>) {
  const set: Record<string, unknown> = {};
  for (const f of [...LEAD_FIELDS, 'lost_reason'] as string[]) {
    if (f === 'tags') continue;
    if (f in b) set[f] = str(b[f], ['needs', 'summary', 'current_situation'].includes(f) ? 8000 : 400) || null;
  }
  if ('tags' in b) set.tags = Array.isArray(b.tags) ? joinTags(b.tags) : joinTags(splitTags(b.tags));
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
  if ('expected_close_at' in b) {
    if (b.expected_close_at && !DATE_RE.test(b.expected_close_at)) throw new HttpError(400, 'validation', 'Data de fecho inválida.');
    set.expected_close_at = b.expected_close_at || null;
  }
  if ('probability' in b) {
    if (b.probability === null || b.probability === '') set.probability = null;
    else {
      const v = Math.round(Number(b.probability));
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new HttpError(400, 'validation', 'A probabilidade vai de 0 a 100.');
      set.probability = v;
    }
  }
  if ('owner_id' in b) set.owner_id = b.owner_id ? Number(b.owner_id) || null : null;
  if ('services' in b) {
    if (!Array.isArray(b.services)) throw new HttpError(400, 'validation', 'Serviços inválidos.');
    set.services = JSON.stringify(b.services.map((s: unknown) => str(s, 40)).filter(Boolean).slice(0, 10));
  }
  return set;
}

async function checkOwner(db: D1Database, ownerId: unknown) {
  if (ownerId == null) return null;
  const u = await db.prepare(`SELECT id, name FROM users WHERE id = ? AND status = 'active'`).bind(ownerId).first<{ id: number; name: string }>();
  if (!u) throw new HttpError(400, 'validation', 'Responsável inválido.');
  return u;
}

/** leads.next_action_at = data da próxima tarefa aberta (o resumo diário e o quadro usam-na). */
async function syncNextAction(db: D1Database, leadId: number | null | undefined) {
  if (!leadId) return;
  await db
    .prepare(`UPDATE leads SET next_action_at = (SELECT MIN(due_date) FROM tasks WHERE lead_id = ? AND done_at IS NULL AND due_date IS NOT NULL) WHERE id = ?`)
    .bind(leadId, leadId)
    .run();
}

async function insertTask(db: D1Database, t: { title: string; type?: string; due_date?: string | null; due_time?: string | null; lead_id?: number | null; assignee_id?: number | null; notes?: string | null; created_by?: number | null }) {
  const row = await db
    .prepare('INSERT INTO tasks (title, type, due_date, due_time, lead_id, assignee_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(t.title, t.type || 'todo', t.due_date || null, t.due_time || null, t.lead_id ?? null, t.assignee_id ?? null, t.notes || null, t.created_by ?? null)
    .first<{ id: number }>();
  await syncNextAction(db, t.lead_id);
  return row!.id;
}

const createLead: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const set = leadPatch(b);
  if (!set.name && !set.email && !set.phone && !set.business) throw new HttpError(400, 'validation', 'Preencha pelo menos o nome, e-mail, telefone ou negócio.');
  if (!('owner_id' in b)) set.owner_id = user.id;
  await checkOwner(env.DB, set.owner_id);
  const input: LeadInput = { ...(set as LeadInput), services: b.services, stage: set.stage as string | undefined };
  const { id, created } = await saveLead(env.DB, input, { source: 'manual', userId: user.id, note: `Lead criado por ${user.name}.` });
  // saveLead não grava estes campos; aplica-os já.
  const extra = Object.fromEntries(
    Object.entries(set).filter(([k]) => ['value_cents', 'currency', 'lost_reason', 'stage', 'owner_id', 'expected_close_at', 'probability', 'tags'].includes(k)),
  );
  if (created && ['won', 'lost'].includes(set.stage as string)) extra.closed_at = now();
  if (Object.keys(extra).length) {
    await env.DB.prepare(`UPDATE leads SET ${Object.keys(extra).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(extra), id).run();
  }
  if (b.next_action_at && DATE_RE.test(b.next_action_at)) {
    await insertTask(env.DB, { title: str(b.task_title, 200) || 'Primeiro contacto', type: 'call', due_date: b.next_action_at, lead_id: id, assignee_id: (set.owner_id as number) ?? user.id, created_by: user.id });
  }
  return { ok: true, id, created };
};

const updateLead: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const before = await env.DB
    .prepare('SELECT stage, value_cents, currency, owner_id, expected_close_at, probability FROM leads WHERE id = ?')
    .bind(id)
    .first<{ stage: string; value_cents: number | null; currency: string; owner_id: number | null; expected_close_at: string | null; probability: number | null }>();
  if (!before) throw new HttpError(404, 'not_found');
  const b = await readBody(req);
  const set = leadPatch(b);
  const owner = 'owner_id' in set ? await checkOwner(env.DB, set.owner_id) : null;
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
  if ('owner_id' in set && set.owner_id !== before.owner_id) {
    await addActivity(env.DB, id, 'update', owner ? `Responsável: ${owner.name}` : 'Responsável removido', user.id);
  }
  if ('expected_close_at' in set && set.expected_close_at !== before.expected_close_at && set.expected_close_at) {
    await addActivity(env.DB, id, 'update', `Fecho previsto para ${set.expected_close_at}.`, user.id);
  }
  return { ok: true };
};

const deleteLead: Handler = async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(intId(params[0])).run();
  return { ok: true };
};

/** Ações em massa na lista: etapa, responsável, etiqueta, apagar. */
const bulkLeads: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const ids: number[] = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 500) as number[] : [];
  if (!ids.length) throw new HttpError(400, 'validation', 'Nenhum lead selecionado.');
  const marks = ids.map(() => '?').join(',');
  const db = env.DB;
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  const act = (leadId: number, type: string, content: string) =>
    db.prepare('INSERT INTO activities (lead_id, type, content, user_id) VALUES (?, ?, ?, ?)').bind(leadId, type, content, user.id);

  if (b.action === 'delete') {
    if (user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Só administradores podem apagar leads.');
    stmts.push(db.prepare(`DELETE FROM leads WHERE id IN (${marks})`).bind(...ids));
  } else if (b.action === 'stage') {
    if (!STAGES.includes(b.value)) throw new HttpError(400, 'validation', 'Etapa inválida.');
    const { results } = await db.prepare(`SELECT id, stage FROM leads WHERE id IN (${marks})`).bind(...ids).all<{ id: number; stage: string }>();
    const closed = ['won', 'lost'].includes(b.value) ? t : null;
    for (const l of results) {
      if (l.stage === b.value) continue;
      stmts.push(db.prepare('UPDATE leads SET stage = ?, closed_at = ?, updated_at = ? WHERE id = ?').bind(b.value, closed, t, l.id));
      stmts.push(act(l.id, 'stage', `Etapa: ${STAGE_LABEL[l.stage]} → ${STAGE_LABEL[b.value]} (em massa)`));
    }
  } else if (b.action === 'owner') {
    const owner = await checkOwner(db, b.value ? Number(b.value) : null);
    stmts.push(db.prepare(`UPDATE leads SET owner_id = ?, updated_at = ? WHERE id IN (${marks})`).bind(owner?.id ?? null, t, ...ids));
    for (const id of ids) stmts.push(act(id, 'update', owner ? `Responsável: ${owner.name}` : 'Responsável removido'));
  } else if (b.action === 'tag' || b.action === 'untag') {
    const tag = str(b.value, 40).replace(/,/g, ' ').trim();
    if (!tag) throw new HttpError(400, 'validation', 'Escreva a etiqueta.');
    const { results } = await db.prepare(`SELECT id, tags FROM leads WHERE id IN (${marks})`).bind(...ids).all<{ id: number; tags: string | null }>();
    for (const l of results) {
      const cur = splitTags(l.tags);
      const next = b.action === 'tag' ? [...cur, tag] : cur.filter((x) => x.toLowerCase() !== tag.toLowerCase());
      stmts.push(db.prepare('UPDATE leads SET tags = ?, updated_at = ? WHERE id = ?').bind(joinTags(next), t, l.id));
    }
  } else throw new HttpError(400, 'validation', 'Ação inválida.');

  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { ok: true, count: ids.length };
};

/** Importação de CSV (o browser lê o ficheiro e envia em blocos pequenos). Não duplica e-mails com negócio aberto. */
const importLeads: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const rows: Record<string, any>[] = Array.isArray(b.rows) ? b.rows.slice(0, 10) : [];
  const ownerId = b.owner_id ? (await checkOwner(env.DB, Number(b.owner_id)))!.id : null;
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const { stage, owner_id: _o, ...rest } = r;
    const set = (() => { try { return leadPatch(STAGES.includes(stage) ? { ...rest, stage } : rest); } catch { return null; } })();
    if (!set || (!set.name && !set.email && !set.phone && !set.business)) { skipped++; continue; }
    const res = await saveLead(env.DB, { ...(set as LeadInput), stage: set.stage as string | undefined }, { source: 'manual', userId: user.id, note: `Importado de CSV por ${user.name}.` });
    res.created ? created++ : updated++;
    const extra: Record<string, unknown> = {};
    for (const k of ['value_cents', 'currency', 'tags', 'expected_close_at']) if (set[k] != null) extra[k] = set[k];
    if (ownerId) extra.owner_id = ownerId;
    if (Object.keys(extra).length) await env.DB.prepare(`UPDATE leads SET ${Object.keys(extra).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(extra), res.id).run();
  }
  return { ok: true, created, updated, skipped };
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

/* ====================================================================== */
/* Tarefas                                                                */
/* ====================================================================== */

function taskPatch(b: Record<string, any>, partial = false) {
  const set: Record<string, unknown> = {};
  if (!partial || 'title' in b) {
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'validation', 'Escreva a tarefa.');
    set.title = title;
  }
  if (!partial || 'type' in b) set.type = TASK_TYPES.includes(b.type) ? b.type : 'todo';
  if (!partial || 'due_date' in b) {
    if (b.due_date && !DATE_RE.test(b.due_date)) throw new HttpError(400, 'validation', 'Data inválida.');
    set.due_date = b.due_date || null;
  }
  if (!partial || 'due_time' in b) {
    if (b.due_time && !TIME_RE.test(b.due_time)) throw new HttpError(400, 'validation', 'Hora inválida.');
    set.due_time = b.due_time || null;
  }
  if (!partial || 'notes' in b) set.notes = str(b.notes, 4000) || null;
  if (!partial || 'lead_id' in b) set.lead_id = b.lead_id ? Number(b.lead_id) || null : null;
  if ('assignee_id' in b) set.assignee_id = b.assignee_id ? Number(b.assignee_id) || null : null;
  return set;
}

const listTasks: Handler = async ({ env, url, user }) => {
  const p = url.searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  const done = p.get('done') === '1';
  where.push(done ? 't.done_at IS NOT NULL' : 't.done_at IS NULL');
  const who = p.get('assignee') || 'me';
  if (who === 'me') { where.push('(t.assignee_id = ? OR t.assignee_id IS NULL)'); binds.push(user.id); }
  else if (/^\d+$/.test(who)) { where.push('t.assignee_id = ?'); binds.push(Number(who)); }
  if (p.get('lead') && /^\d+$/.test(p.get('lead')!)) { where.push('t.lead_id = ?'); binds.push(Number(p.get('lead'))); }
  const order = done ? 't.done_at DESC' : 't.due_date IS NULL, t.due_date, t.due_time IS NULL, t.due_time, t.id';
  const { results } = await env.DB
    .prepare(
      `SELECT t.*, u.name assignee_name, l.name lead_name, l.business lead_business, l.phone lead_phone, l.email lead_email, l.stage lead_stage
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN leads l ON l.id = t.lead_id
       WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${done ? 100 : 1000}`,
    )
    .bind(...binds)
    .all();
  // Leads novos que ainda ninguém contactou nem têm tarefa (para não ficarem esquecidos).
  const uncontacted = done ? [] : (await env.DB
    .prepare(
      `SELECT l.id, l.created_at, l.name, l.business, l.source, l.qualification, l.phone, l.email, l.summary FROM leads l
       WHERE l.stage = 'new' AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.done_at IS NULL)
       ORDER BY l.created_at DESC LIMIT 20`,
    )
    .all()).results;
  return { tasks: results, uncontacted };
};

const createTask: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const set = taskPatch(b);
  if (!('assignee_id' in set)) set.assignee_id = user.id;
  if (set.assignee_id) await checkOwner(env.DB, set.assignee_id);
  if (set.lead_id && !(await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(set.lead_id).first())) throw new HttpError(400, 'validation', 'Lead inválido.');
  const id = await insertTask(env.DB, { ...(set as any), created_by: user.id });
  return { ok: true, id };
};

const updateTask: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const before = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<{ id: number; title: string; lead_id: number | null; done_at: string | null; type: string }>();
  if (!before) throw new HttpError(404, 'not_found');
  const b = await readBody(req);
  const set = taskPatch(b, true);
  if (set.assignee_id) await checkOwner(env.DB, set.assignee_id);
  if ('done' in b) set.done_at = b.done ? before.done_at || now() : null;
  if (Object.keys(set).length) {
    await env.DB.prepare(`UPDATE tasks SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), id).run();
  }
  const leadId = (('lead_id' in set ? set.lead_id : before.lead_id) as number | null) ?? null;
  if (b.done && !before.done_at && leadId) {
    await addActivity(env.DB, leadId, 'task', `Tarefa concluída: ${set.title || before.title}${b.outcome ? `\n${str(b.outcome, 4000)}` : ''}`, user.id);
    await env.DB.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').bind(now(), leadId).run();
  }
  await syncNextAction(env.DB, leadId);
  if (before.lead_id && before.lead_id !== leadId) await syncNextAction(env.DB, before.lead_id);
  return { ok: true };
};

const deleteTask: Handler = async ({ env, params }) => {
  const id = intId(params[0]);
  const t = await env.DB.prepare('SELECT lead_id FROM tasks WHERE id = ?').bind(id).first<{ lead_id: number | null }>();
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  await syncNextAction(env.DB, t?.lead_id);
  return { ok: true };
};

/* ====================================================================== */
/* Modelos de mensagem                                                    */
/* ====================================================================== */

function templatePatch(b: Record<string, any>) {
  const name = str(b.name, 80);
  const body = str(b.body, 4000);
  if (!name) throw new HttpError(400, 'validation', 'Dê um nome ao modelo.');
  if (!body) throw new HttpError(400, 'validation', 'Escreva a mensagem.');
  return { name, body, channel: TEMPLATE_CHANNELS.includes(b.channel) ? b.channel : 'any', subject: str(b.subject, 200) || null };
}

const listTemplates: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT t.*, u.name user_name FROM templates t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.name').all();
  return { templates: results };
};
const createTemplate: Handler = async ({ req, env, user }) => {
  const s = templatePatch(await readBody(req));
  const r = await env.DB.prepare('INSERT INTO templates (name, channel, subject, body, user_id) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(s.name, s.channel, s.subject, s.body, user.id).first<{ id: number }>();
  return { ok: true, id: r!.id };
};
const updateTemplate: Handler = async ({ req, env, params }) => {
  const s = templatePatch(await readBody(req));
  const r = await env.DB.prepare('UPDATE templates SET name = ?, channel = ?, subject = ?, body = ? WHERE id = ?').bind(s.name, s.channel, s.subject, s.body, intId(params[0])).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found');
  return { ok: true };
};
const deleteTemplate: Handler = async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(intId(params[0])).run();
  return { ok: true };
};

/* ====================================================================== */
/* Relatórios                                                             */
/* ====================================================================== */

const reports: Handler = async ({ env, url }) => {
  const range = url.searchParams.get('range') || '90';
  const from = rangeStart(range);
  const yearAgo = new Date();
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11, 1);
  const monthsFrom = yearAgo.toISOString().slice(0, 7);
  const db = env.DB;
  const q = (sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b);
  const res = await db.batch([
    /* 0 closed by source */ q(`SELECT source, stage, COUNT(*) n FROM leads WHERE stage IN ('won','lost') AND closed_at >= ? GROUP BY source, stage`, from),
    /* 1 lost reasons */ q(`SELECT lost_reason FROM leads WHERE stage = 'lost' AND closed_at >= ?`, from),
    /* 2 time to close */ q(`SELECT AVG(julianday(closed_at) - julianday(created_at)) d, COUNT(*) n FROM leads WHERE stage = 'won' AND closed_at >= ?`, from),
    /* 3 won per month */ q(`SELECT substr(closed_at,1,7) m, currency, COUNT(*) n, COALESCE(SUM(value_cents),0) total FROM leads WHERE stage = 'won' AND closed_at >= ? GROUP BY m, currency`, monthsFrom + '-01'),
    /* 4 open deals */ q(`SELECT id, name, business, stage, probability, value_cents, currency, expected_close_at FROM leads WHERE stage NOT IN ('won','lost')`),
    /* 5 by owner */ q(`SELECT l.owner_id, u.name owner_name, l.stage, COUNT(*) n, l.currency, COALESCE(SUM(l.value_cents),0) total FROM leads l LEFT JOIN users u ON u.id = l.owner_id
                        WHERE (l.stage IN ('won','lost') AND l.closed_at >= ?) OR l.stage NOT IN ('won','lost') GROUP BY l.owner_id, l.stage, l.currency`, from),
    /* 6 activities by user */ q(`SELECT a.user_id, u.name user_name, a.type, COUNT(*) n FROM activities a LEFT JOIN users u ON u.id = a.user_id
                        WHERE a.created_at >= ? AND a.type IN (${HUMAN_ACTS}) GROUP BY a.user_id, a.type`, from),
    /* 7 first response */ q(`SELECT AVG(julianday(f) - julianday(c)) d, COUNT(*) n FROM (SELECT l.created_at c, (SELECT MIN(a.created_at) FROM activities a WHERE a.lead_id = l.id AND a.type IN ('call','email','whatsapp','meeting','task')) f FROM leads l WHERE l.created_at >= ?) WHERE f IS NOT NULL`, from),
    /* 8 services */ q(`SELECT services, stage FROM leads WHERE created_at >= ? AND services IS NOT NULL`, from),
    /* 9 created in range */ q(`SELECT COUNT(*) n FROM leads WHERE created_at >= ?`, from),
    /* 10 won value in range */ q(`SELECT currency, COUNT(*) n, COALESCE(SUM(value_cents),0) total FROM leads WHERE stage = 'won' AND closed_at >= ? GROUP BY currency`, from),
  ]);
  const r = <T>(i: number) => (res[i].results || []) as T[];
  return {
    range,
    from,
    monthsFrom,
    closedBySource: r(0),
    lostReasons: r<{ lost_reason: string | null }>(1).map((x) => x.lost_reason),
    timeToClose: r(2)[0] || { d: null, n: 0 },
    wonMonthly: r(3),
    open: r(4),
    byOwner: r(5),
    activitiesByUser: r(6),
    firstResponse: r(7)[0] || { d: null, n: 0 },
    services: r(8),
    created: r<{ n: number }>(9)[0]?.n || 0,
    wonValue: r(10),
    stageProb: STAGE_PROB,
  };
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
  const { results } = await env.DB.prepare('SELECT l.*, u.name owner_name, ROUND(l.value_cents / 100.0, 2) value FROM leads l LEFT JOIN users u ON u.id = l.owner_id ORDER BY l.created_at DESC').all();
  const cols = ['id', 'created_at', 'source', 'stage', 'qualification', 'owner_name', 'name', 'email', 'phone', 'business', 'business_type', 'country', 'location', 'language', 'services', 'needs', 'timeline', 'budget', 'decision_maker', 'summary', 'next_step', 'value', 'currency', 'probability', 'expected_close_at', 'next_action_at', 'lost_reason', 'tags', 'page'];
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

  // Lead vindo da prospecção (clicou ou respondeu): já foi contactado, liga à lista de prospecção e cria a tarefa de seguimento.
  if (b.contacted) await env.DB.prepare(`UPDATE leads SET stage = 'contacted', updated_at = ? WHERE id = ? AND stage = 'new'`).bind(now(), id).run();
  if (input.email) await env.DB.prepare(`UPDATE prospects SET crm_lead_id = ? WHERE lower(email) = lower(?) AND crm_lead_id IS NULL`).bind(id, input.email).run().catch(() => null);
  const tk = b.task && typeof b.task === 'object' ? b.task : null;
  const tkTitle = tk ? str(tk.title, 200) : '';
  if (tkTitle) {
    const open = await env.DB.prepare(`SELECT 1 FROM tasks WHERE lead_id = ? AND done_at IS NULL AND title = ?`).bind(id, tkTitle).first();
    if (!open) {
      const row = await env.DB.prepare('SELECT owner_id FROM leads WHERE id = ?').bind(id).first<{ owner_id: number | null }>();
      const admin = await env.DB.prepare(`SELECT id FROM users WHERE status = 'active' AND role = 'admin' ORDER BY id LIMIT 1`).first<{ id: number }>();
      const who = row?.owner_id || admin?.id || null;
      if (!row?.owner_id && who) await env.DB.prepare('UPDATE leads SET owner_id = ? WHERE id = ?').bind(who, id).run();
      const due = typeof tk!.due_date === 'string' && DATE_RE.test(tk!.due_date) ? tk!.due_date : today();
      const type = ['todo', 'call', 'email', 'whatsapp', 'meeting'].includes(String(tk!.type)) ? String(tk!.type) : 'email';
      await insertTask(env.DB, { title: tkTitle, type, due_date: due, lead_id: id, assignee_id: who, notes: str(tk!.notes, 2000) || null } as any);
    }
  }

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
      token: str(e.token, 40) || null,
      send_id: str(e.send_id, 60) || null,
      ...readCampaign((key) => e[key]),
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
/* Assistente interno (agente Qwen no PC do Emerson)                      */
/* ====================================================================== */
// A aba "Assistente" grava a pergunta numa fila; o agente no PC busca a fila com a chave ASSISTANT_KEY,
// consulta os dados (só leitura), faz CRUD e devolve a resposta. Nada do PC fica exposto à internet.

async function checkAssistant(req: Request, env: AppEnv) {
  const auth = req.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const key = env.ASSISTANT_KEY || '';
  if (!key || !given) throw new HttpError(401, 'unauthorized', 'Falta a chave do assistente.');
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(given)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  if (!crypto.subtle.timingSafeEqual(a, b)) throw new HttpError(401, 'unauthorized', 'Chave do assistente inválida.');
}

const ASSIST_TABLES_BLOCKED = /\b(users|sessions|settings|public_chat_jobs|sqlite_\w+|password_hash|token_hash)\b/i;
const ASSIST_WRITE = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|trigger|begin|commit)\b/i;

/** Consulta só de leitura feita pelo agente (SELECT/WITH), sem tabelas de login. */
const assistantQuery: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  let sql = String(b.sql ?? '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(sql)) throw new HttpError(400, 'only_select', 'Só consultas SELECT.');
  if (sql.includes(';')) throw new HttpError(400, 'one_statement', 'Uma consulta de cada vez.');
  if (ASSIST_WRITE.test(sql)) throw new HttpError(400, 'read_only', 'Consulta só de leitura.');
  if (ASSIST_TABLES_BLOCKED.test(sql)) throw new HttpError(403, 'blocked_table', 'Tabela não permitida.');
  const params = Array.isArray(b.params) ? b.params.slice(0, 20) : [];
  const wrapped = `SELECT * FROM (${sql}) LIMIT 500`;
  try {
    const r = await env.DB.prepare(wrapped).bind(...params).all();
    return { ok: true, rows: r.results || [], count: (r.results || []).length };
  } catch (e) {
    throw new HttpError(400, 'sql_error', String((e as Error).message || e).slice(0, 300));
  }
};

const LEAD_EDIT = ['name', 'email', 'phone', 'business', 'business_type', 'country', 'location', 'stage', 'qualification', 'value_cents',
  'currency', 'probability', 'expected_close_at', 'summary', 'next_step', 'lost_reason', 'tags', 'needs', 'timeline', 'budget'];
const TASK_EDIT = ['title', 'type', 'due_date', 'due_time', 'lead_id', 'notes'];
const TX_EDIT = ['date', 'kind', 'category', 'description', 'amount_cents', 'currency', 'status', 'recurring', 'lead_id'];

function pickFields(d: Record<string, any>, allowed: string[]) {
  const out: Record<string, any> = {};
  for (const k of allowed) if (d[k] !== undefined) out[k] = d[k] === '' ? null : d[k];
  if ('stage' in out && !(STAGES as readonly string[]).includes(out.stage)) throw new HttpError(400, 'bad_stage', `Etapa inválida: ${out.stage}`);
  if ('currency' in out && out.currency && !CURRENCIES.includes(out.currency)) throw new HttpError(400, 'bad_currency');
  if ('kind' in out && !['income', 'expense'].includes(out.kind)) throw new HttpError(400, 'bad_kind');
  if ('status' in out && 'amount_cents' in out === false && !['paid', 'pending'].includes(out.status) && allowed === TX_EDIT) throw new HttpError(400, 'bad_status');
  for (const k of ['value_cents', 'amount_cents', 'probability', 'lead_id', 'recurring']) if (k in out && out[k] != null) {
    const n = Number(out[k]);
    if (!Number.isFinite(n)) throw new HttpError(400, 'bad_number', `${k} inválido`);
    out[k] = Math.round(n);
  }
  for (const k of ['due_date', 'date', 'expected_close_at']) if (k in out && out[k] && !DATE_RE.test(out[k])) throw new HttpError(400, 'bad_date', `${k} deve ser AAAA-MM-DD`);
  return out;
}

/** CRUD feito pelo agente (as confirmações de exclusão e valores são pedidas no agente, antes de chamar). */
const assistantCrud: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const acao = str(b.acao, 10), ent = str(b.entidade, 20);
  const id = b.id != null ? Number(b.id) : null;
  const dados = (b.dados && typeof b.dados === 'object') ? b.dados : {};
  const table = { lead: 'leads', task: 'tasks', transaction: 'transactions' }[ent];
  if (ent === 'note') {
    if (acao !== 'create' || !dados.lead_id) throw new HttpError(400, 'bad_request', 'Nota precisa de lead_id.');
    await addActivity(env.DB, Number(dados.lead_id), 'note', `${str(dados.content, 4000)}\n— pelo assistente`);
    return { ok: true };
  }
  if (!table) throw new HttpError(400, 'bad_entity');
  const allowed = ent === 'lead' ? LEAD_EDIT : ent === 'task' ? TASK_EDIT : TX_EDIT;
  if (acao === 'delete') {
    if (!id) throw new HttpError(400, 'missing_id');
    const r = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return { ok: true, deleted: r.meta.changes || 0 };
  }
  if (acao === 'update') {
    if (!id) throw new HttpError(400, 'missing_id');
    const f = pickFields(dados, allowed);
    if (ent === 'task' && dados.done !== undefined) f.done_at = dados.done ? now() : null;
    const keys = Object.keys(f);
    if (!keys.length) throw new HttpError(400, 'nothing_to_update');
    if (ent === 'lead') { f.updated_at = now(); keys.push('updated_at'); if (f.stage === 'won' || f.stage === 'lost') { f.closed_at = now(); keys.push('closed_at'); } }
    await env.DB.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => f[k]), id).run();
    if (ent === 'lead') await addActivity(env.DB, id, 'update', `Atualizado pelo assistente: ${keys.filter((k) => k !== 'updated_at' && k !== 'closed_at').join(', ')}`);
    return { ok: true, row: await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first() };
  }
  if (acao === 'create') {
    const f = pickFields(dados, allowed);
    if (ent === 'lead') { f.source = 'manual'; f.stage ||= 'new'; }
    if (ent === 'task' && !f.title) throw new HttpError(400, 'missing_title');
    if (ent === 'transaction') { if (!f.date) f.date = today(); if (f.amount_cents == null || !f.kind) throw new HttpError(400, 'missing_amount'); f.category ||= 'Outros'; }
    const keys = Object.keys(f);
    const r = await env.DB.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`).bind(...keys.map((k) => f[k])).first();
    if (ent === 'lead' && r) await addActivity(env.DB, (r as any).id, 'created', 'Criado pelo assistente');
    return { ok: true, row: r };
  }
  throw new HttpError(400, 'bad_action');
};

/* Fila da aba "Assistente" */
const askAssistant: Handler = async ({ req, env, user }) => {
  const b = await readBody(req);
  const question = str(b.question, 2000);
  if (!question) throw new HttpError(400, 'empty');
  const history = Array.isArray(b.history) ? b.history.slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 1500) })) : [];
  await env.DB.prepare(`UPDATE assistant_jobs SET status = 'error', answer = 'O agente no PC não respondeu a tempo (PC desligado ou sem internet).', updated_at = ?
                        WHERE status = 'pending' AND created_at < ?`).bind(now(), new Date(Date.now() - 4 * 60_000).toISOString()).run();
  const r = await env.DB.prepare('INSERT INTO assistant_jobs (user_id, question, history) VALUES (?, ?, ?) RETURNING id').bind(user.id, question, JSON.stringify(history)).first<{ id: number }>();
  return { id: r!.id };
};

const getAssistantJob: Handler = async ({ env, user, params }) => {
  const r = await env.DB.prepare('SELECT id, status, answer, created_at, updated_at FROM assistant_jobs WHERE id = ? AND user_id = ?').bind(intId(params[0]), user.id).first();
  if (!r) throw new HttpError(404, 'not_found');
  return r;
};

const assistantStatus: Handler = async ({ env }) => {
  const [seen, publicSeen] = await Promise.all([
    getSetting(env.DB, 'assistant_seen'), getSetting(env.DB, 'public_chat_seen'),
  ]);
  return { publicOnline: !!publicSeen && Date.now() - Date.parse(publicSeen) < 30_000, publicSeen, online: !!seen && Date.now() - Date.parse(seen) < 45_000, seen };
};

const bridgeNext: Handler = async ({ env }) => {
  await env.DB.prepare(
    "INSERT INTO settings(key,value) VALUES('assistant_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value<?",
  ).bind(now(), new Date(Date.now() - 15_000).toISOString()).run();
  await env.DB.prepare(`UPDATE assistant_jobs SET status='error', answer='A solicitação expirou. Se pediu uma alteração, confira o CRM antes de repetir.', updated_at=?
    WHERE status IN ('working','pending') AND updated_at<?`).bind(now(), new Date(Date.now() - 5 * 60_000).toISOString()).run();
  const job = await env.DB.prepare(`UPDATE assistant_jobs SET status = 'working', updated_at = ?
     WHERE id = (SELECT id FROM assistant_jobs WHERE status = 'pending' ORDER BY id LIMIT 1) RETURNING id, user_id, question, history`).bind(now()).first();
  if (!job) return { job: null };
  const u = await env.DB.prepare("SELECT name, role FROM users WHERE id = ? AND status='active'").bind((job as any).user_id).first<{ name: string; role: string }>();
  return { job: { ...job, user_name: u?.name || '', operator_role: u?.role || '' } };
};

const bridgeAnswer: Handler = async ({ req, env, params }) => {
  const b = await readBody(req);
  await env.DB.prepare(`UPDATE assistant_jobs SET status = ?, answer = ?, updated_at = ? WHERE id = ?`)
    .bind(b.status === 'error' ? 'error' : 'done', str(b.answer, 12000), now(), intId(params[0])).run();
  return { ok: true };
};


/* ====================================================================== */
/* Atividade geral: tudo o que acontece (e-mails, respostas, leads, acessos ao site)  */
/* ====================================================================== */
/* ====================================================================== */
/* Agenda: chamadas marcadas pelo site                                    */
/* ====================================================================== */
const listBookings: Handler = async ({ env, url }) => {
  const scope = url.searchParams.get('scope') === 'past' ? 'past' : 'upcoming';
  const cut = new Date(Date.now() - 30 * 60e3).toISOString();
  const sql = scope === 'past'
    ? `SELECT b.*, l.name lead_name, l.stage lead_stage FROM bookings b LEFT JOIN leads l ON l.id = b.lead_id WHERE b.start_at < ? OR b.status <> 'confirmed' ORDER BY b.start_at DESC LIMIT 100`
    : `SELECT b.*, l.name lead_name, l.stage lead_stage FROM bookings b LEFT JOIN leads l ON l.id = b.lead_id WHERE b.start_at >= ? AND b.status = 'confirmed' ORDER BY b.start_at LIMIT 200`;
  const [rows, stats] = await Promise.all([
    env.DB.prepare(sql).bind(cut).all<any>().then((r) => r.results || []),
    env.DB.prepare(`SELECT
        SUM(CASE WHEN status='confirmed' AND start_at >= ? THEN 1 ELSE 0 END) upcoming,
        SUM(CASE WHEN status='confirmed' AND start_at >= ? AND start_at < ? THEN 1 ELSE 0 END) week,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) last30,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done,
        SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show
      FROM bookings`).bind(cut, cut, new Date(Date.now() + 7 * 864e5).toISOString(), new Date(Date.now() - 30 * 864e5).toISOString()).first<any>(),
  ]);
  return { scope, rows, stats: stats || {} };
};

const updateBooking: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const b = await readBody(req);
  const status = str(b.status, 20);
  if (!['cancelled', 'done', 'no_show', 'confirmed'].includes(status)) throw new HttpError(400, 'validation', 'Estado inválido.');
  const bk = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<any>();
  if (!bk) throw new HttpError(404, 'not_found');
  if (status === 'confirmed' && bk.status === 'cancelled') {
    const clash = await env.DB.prepare(`SELECT 1 FROM bookings WHERE status='confirmed' AND start_at = ? AND id <> ?`).bind(bk.start_at, id).first();
    if (clash) throw new HttpError(409, 'taken', 'Esse horário já foi ocupado por outra marcação.');
  }
  await env.DB.prepare(`UPDATE bookings SET status = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END WHERE id = ?`).bind(status, status, now(), id).run();
  const when = brtOf(bk.start_at);
  const label = { cancelled: 'cancelada', done: 'feita', no_show: 'pessoa não apareceu', confirmed: 'reativada' }[status];
  if (bk.task_id && (status === 'cancelled' || status === 'done' || status === 'no_show')) {
    await env.DB.prepare(`UPDATE tasks SET done_at = COALESCE(done_at, ?) WHERE id = ?`).bind(now(), bk.task_id).run();
  }
  if (bk.lead_id) {
    await addActivity(env.DB, bk.lead_id, 'meeting', `Chamada de ${when.date.split('-').reverse().join('/')} às ${when.time} (Brasília): ${label}`, user.id);
    await syncNextAction(env.DB, bk.lead_id);
  }
  return { ok: true };
};

const getBookingRules: Handler = async ({ env }) => {
  const rules = await loadRules(env.DB);
  const free = await freeSlots(env.DB, rules).catch(() => []);
  return { rules, defaults: DEFAULT_RULES, freeCount: free.length, nextFree: free[0] || null };
};

const putBookingRules: Handler = async ({ req, env }) => {
  const rules = normalizeRules(await readBody(req));
  if (rules.minutes > 0 && rules.days.length === 0) throw new HttpError(400, 'validation', 'Escolha pelo menos um dia da semana.');
  await setSetting(env.DB, 'booking', JSON.stringify(rules));
  return { ok: true, rules };
};

/* ====================================================================== */
/* Instagram (@pipehero.studio): números diários pela API oficial          */
/* ====================================================================== */
// A credencial fica no servidor. Escritas de uma sincronização só valem para a conexão vigente.
const IG_CHANGED = 'A conexão mudou durante a atualização. Tente novamente.';

function instagramSetting(db: D1Database, key: string, value: string, token?: string) {
  if (token === undefined) {
    return db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value);
  }
  return db.prepare(`INSERT INTO settings (key,value) SELECT ?,? WHERE (SELECT value FROM settings WHERE key='ig_token')=?
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key, value, token);
}

async function syncInstagram(env: AppEnv, selected?: { token: string; profile: InstagramProfile }) {
  let token = selected?.token ?? await getSetting(env.DB, 'ig_token');
  if (!token) return { ok: false, reason: 'not_connected' };
  try {
    if (!selected && instagramSource(token) === 'instagram') {
      const at = await getSetting(env.DB, 'ig_token_at');
      if (!at || Date.now() - Date.parse(at) > 40 * 864e5) {
        const refreshed = await refreshInstagramToken(token).catch(() => null);
        if (refreshed) {
          const [, credential] = await env.DB.batch([
            instagramSetting(env.DB, 'ig_token_at', now(), token),
            instagramSetting(env.DB, 'ig_token', refreshed, token),
          ]);
          if (!credential.meta.changes) return { ok: false, reason: IG_CHANGED };
          token = refreshed;
        }
      }
    }
    const me = selected?.profile ?? await readInstagramProfile(token);
    const d = new Date(); d.setUTCHours(0, 0, 0, 0);
    const today = d.toISOString().slice(0, 10);
    const until = Math.floor(d.getTime() / 1000), since = until - 86400;
    const yday = new Date(since * 1000).toISOString().slice(0, 10);
    const { vals, error } = await readInstagramInsights(token, since, until);
    const fetchedAt = now();
    const [profile] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO ig_daily (day, followers, media, fetched_at) SELECT ?,?,?,?
        WHERE (SELECT value FROM settings WHERE key='ig_token')=?
        ON CONFLICT(day) DO UPDATE SET followers = COALESCE(excluded.followers, ig_daily.followers),
        media = COALESCE(excluded.media, ig_daily.media), fetched_at = excluded.fetched_at`)
        .bind(today, me.followers_count ?? null, me.media_count ?? null, fetchedAt, token),
      env.DB.prepare(`INSERT INTO ig_daily (day, reach, profile_views, website_clicks, follower_count, accounts_engaged, fetched_at)
        SELECT ?,?,?,?,?,?,? WHERE (SELECT value FROM settings WHERE key='ig_token')=?
        ON CONFLICT(day) DO UPDATE SET reach = COALESCE(excluded.reach, ig_daily.reach),
        profile_views = COALESCE(excluded.profile_views, ig_daily.profile_views), website_clicks = COALESCE(excluded.website_clicks, ig_daily.website_clicks),
        follower_count = COALESCE(excluded.follower_count, ig_daily.follower_count),
        accounts_engaged = COALESCE(excluded.accounts_engaged, ig_daily.accounts_engaged), fetched_at = excluded.fetched_at`)
        .bind(yday, vals.reach, vals.profile_views, vals.website_clicks, vals.follower_count, vals.accounts_engaged, fetchedAt, token),
      instagramSetting(env.DB, 'ig_user', me.username, token),
      instagramSetting(env.DB, 'ig_error', error, token),
    ]);
    if (!profile.meta.changes) return { ok: false, reason: IG_CHANGED };
    return error ? { ok: false, reason: error } : { ok: true, username: me.username, followers: me.followers_count };
  } catch (e) {
    const reason = instagramErrorMessage(e);
    await instagramSetting(env.DB, 'ig_error', reason, token).run().catch(() => {});
    return { ok: false, reason };
  }
}

const getInstagram: Handler = async ({ env, url }) => {
  const since = rangeStart(url.searchParams.get('range'));
  const from = since.slice(0, 10);
  const [token, user, err, rows, last, siteVisits] = await Promise.all([
    getSetting(env.DB, 'ig_token'), getSetting(env.DB, 'ig_user'), getSetting(env.DB, 'ig_error'),
    env.DB.prepare('SELECT * FROM ig_daily WHERE day >= ? ORDER BY day').bind(from).all<any>().then((r) => r.results || []).catch(() => []),
    env.DB.prepare('SELECT * FROM ig_daily WHERE followers IS NOT NULL ORDER BY day DESC LIMIT 1').first<any>().catch(() => null),
    instagramSiteVisits(env.DB, since),
  ]);
  return { connected: !!token, source: token ? instagramSource(token) : null, username: user || null, error: err || null, rows, last, from, siteVisits };
};

const connectInstagram: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!/^(EAA|IG)[A-Za-z0-9]{50,}$/.test(token)) {
    throw new HttpError(400, 'validation', 'Cole o token completo gerado no painel da Meta (EAA… ou IG…).');
  }
  let profile: InstagramProfile;
  try { profile = await readInstagramProfile(token); }
  catch (e) { throw new HttpError(400, 'ig_invalid', instagramErrorMessage(e)); }
  await env.DB.batch([
    instagramSetting(env.DB, 'ig_token', token),
    instagramSetting(env.DB, 'ig_token_at', now()),
    instagramSetting(env.DB, 'ig_user', profile.username),
    instagramSetting(env.DB, 'ig_error', ''),
  ]);
  const sync = await syncInstagram(env, { token, profile });
  return { ok: true, username: profile.username, sync };
};

const disconnectInstagram: Handler = async ({ env }) => {
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ('ig_token','ig_token_at','ig_error')`).run();
  return { ok: true };
};

const syncInstagramNow: Handler = async ({ env }) => syncInstagram(env);

/* Tráfego do site pipeherostudio.digital: visitas por dia e por canal, países, páginas, horários e dispositivos. */
const REF = `IFNULL(json_extract(meta,'$.ref'),'')`;

async function instagramSiteVisits(db: D1Database, since: string) {
  const row = await db.prepare(`SELECT COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? AND ${REF} LIKE '%instagram%'`)
    .bind(since).first<{ n: number }>();
  return row?.n ?? 0;
}

const CHANNEL = `CASE WHEN ${REF} = '' THEN 'direct'
  WHEN ${REF} LIKE '%google.%' OR ${REF} LIKE '%bing.%' OR ${REF} LIKE '%duckduckgo%' OR ${REF} LIKE '%yahoo.%' OR ${REF} LIKE '%ecosia%' OR ${REF} LIKE '%brave%' THEN 'search'
  WHEN ${REF} LIKE '%instagram%' OR ${REF} LIKE '%facebook%' OR ${REF} LIKE '%fb.%' OR ${REF} LIKE '%linkedin%' OR ${REF} LIKE '%lnkd.in%' OR ${REF} LIKE '%t.co' OR ${REF} LIKE '%twitter%' OR ${REF} LIKE '%x.com'
    OR ${REF} LIKE '%whatsapp%' OR ${REF} LIKE '%wa.me%' OR ${REF} LIKE '%reddit%' OR ${REF} LIKE '%pinterest%' OR ${REF} LIKE '%youtube%' OR ${REF} LIKE '%tiktok%' OR ${REF} LIKE '%quora%' OR ${REF} LIKE '%medium.com%' THEN 'social'
  ELSE 'other' END`;

const trafficStats: Handler = async ({ env, url }) => {
  const range = url.searchParams.get('range') || '30';
  const from = rangeStart(range);
  const prev = range === 'all' ? null : prevRange(from);
  const q = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...(b.length ? b : [from])).all<any>().then((r) => r.results || []);
  const PV = `FROM events WHERE type='page_view' AND created_at>=?`;
  const [daily, countries, pages, refs, devices, hours, langs, channels, other, igVisits, campaigns, prevTotal] = await Promise.all([
    q(`SELECT substr(created_at,1,10) d, ${CHANNEL} ch, COUNT(*) n ${PV} GROUP BY d, ch ORDER BY d`),
    q(`SELECT COALESCE(json_extract(meta,'$.country'),'?') c, COUNT(*) n ${PV} GROUP BY c ORDER BY n DESC LIMIT 15`),
    q(`SELECT ref page, COUNT(*) n ${PV} GROUP BY ref ORDER BY n DESC LIMIT 12`),
    q(`SELECT ${REF} r, ${CHANNEL} ch, COUNT(*) n ${PV} AND ${REF} <> '' GROUP BY r ORDER BY n DESC LIMIT 12`),
    q(`SELECT COALESCE(json_extract(meta,'$.device'),'?') dv, COUNT(*) n ${PV} GROUP BY dv ORDER BY n DESC`),
    q(`SELECT CAST(strftime('%H', created_at, '-3 hours') AS INTEGER) h, COUNT(*) n ${PV} GROUP BY h ORDER BY h`),
    q(`SELECT COALESCE(NULLIF(json_extract(meta,'$.lang'),''),'?') l, COUNT(*) n ${PV} GROUP BY l ORDER BY n DESC LIMIT 6`),
    q(`SELECT ${CHANNEL} ch, COUNT(*) n ${PV} GROUP BY ch`),
    q(`SELECT type, COUNT(*) n FROM events WHERE created_at>=? AND type IN ('form_submit','email_click','chat_message') GROUP BY type`),
    instagramSiteVisits(env.DB, from),
    q(CAMPAIGN_STATS, from, from),
    prev ? env.DB.prepare(`SELECT COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? AND created_at<?`).bind(prev.from, prev.to).first<{ n: number }>() : Promise.resolve(null),
  ]);
  const total = channels.reduce((a: number, r: any) => a + r.n, 0);
  return { from, range, total, prevTotal: prev ? prevTotal?.n || 0 : null, daily, countries, pages, refs, devices, hours, langs, channels,
    campaigns, other: Object.fromEntries(other.map((r: any) => [r.type, r.n])), igVisits };
};

const activityFeed: Handler = async ({ env, url }) => {
  const from = rangeStart(url.searchParams.get('range'));
  const q = (sql: string) => env.DB.prepare(sql).bind(from).all<any>().then((r) => r.results || []);
  const [pvDaily, pvPages, pvRefs, pvCountries, pvDevices, totals, timeline, emailsDaily] = await Promise.all([
    q(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? GROUP BY d ORDER BY d`),
    q(`SELECT ref page, COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? GROUP BY ref ORDER BY n DESC LIMIT 12`),
    q(`SELECT COALESCE(NULLIF(json_extract(meta,'$.ref'),''),'(direto)') r, COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? GROUP BY r ORDER BY n DESC LIMIT 10`),
    q(`SELECT COALESCE(json_extract(meta,'$.country'),'?') c, COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? GROUP BY c ORDER BY n DESC LIMIT 10`),
    q(`SELECT COALESCE(json_extract(meta,'$.device'),'?') dv, COUNT(*) n FROM events WHERE type='page_view' AND created_at>=? GROUP BY dv ORDER BY n DESC`),
    q(`SELECT type, source, COUNT(*) n FROM events WHERE created_at>=? AND type<>'page_view' GROUP BY type, source`),
    q(`SELECT e.id, e.created_at, e.type, e.source, e.ref, e.lead_id, e.meta, l.name lead_name, l.business
       FROM events e LEFT JOIN leads l ON l.id = e.lead_id
       WHERE e.created_at>=? AND e.type NOT IN ('page_view','demo_started','chat_message','login') ORDER BY e.created_at DESC LIMIT 300`),
    q(`SELECT substr(created_at,1,10) d, source, COUNT(*) n FROM events WHERE type='email_sent' AND created_at>=? GROUP BY d, source ORDER BY d`),
  ]);
  return { from, pvDaily, pvPages, pvRefs, pvCountries, pvDevices, totals, timeline, emailsDaily };
};


/* ====================================================================== */
/* Prospecção: todos os negócios encontrados pelo prospector              */
/* ====================================================================== */
// Lista separada do pipeline (não mistura milhares de contactos frios com os leads do CRM).
// O prospector no PC envia tudo (POST /api/bridge/prospects) e lê de volta as marcações manuais de "não contatar".

const PROSPECT_STATUS = ['encontrado', 'qualificado', 'contatado', 'respondeu', 'interessado', 'descartado', 'nao_contactar', 'devolvido'];
/** Saídas que nunca podem ser revertidas no painel (pedido da pessoa, devolução, denúncia). */
const DNC_LOCKED = ['unsubscribe', 'not_interested', 'spam_complaint', 'bounce'];
const P_FIELDS = ['name', 'category', 'city', 'state', 'country', 'email', 'phone', 'website', 'source', 'product', 'score', 'status', 'stage_raw',
  'reason', 'emails_sent', 'last_email_at', 'last_subject', 'clicked', 'replied_at', 'reply_class', 'crm_lead_id'];

const bridgeProspects: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const items = Array.isArray(b.items) ? b.items.slice(0, 250) : [];
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const ext = Number(it.ext_id);
    if (!Number.isInteger(ext) || ext <= 0) continue;
    const v = P_FIELDS.map((k) => (it[k] === undefined || it[k] === '' ? null : typeof it[k] === 'string' ? String(it[k]).slice(0, 500) : it[k]));
    const dnc = it.do_not_contact ? 1 : 0;
    stmts.push(env.DB.prepare(
      `INSERT INTO prospects (ext_id, ${P_FIELDS.join(', ')}, do_not_contact, dnc_reason, dnc_source, dnc_at, updated_at)
       VALUES (?, ${P_FIELDS.map(() => '?').join(', ')}, ?, ?, ?, CASE WHEN ? = 1 THEN ? END, ?)
       ON CONFLICT(ext_id) DO UPDATE SET ${P_FIELDS.filter((k) => k !== 'status').map((k) => `${k} = excluded.${k}`).join(', ')},
         status = CASE WHEN MAX(prospects.do_not_contact, excluded.do_not_contact) = 1 AND excluded.status <> 'devolvido' THEN 'nao_contactar' ELSE excluded.status END,
         do_not_contact = MAX(prospects.do_not_contact, excluded.do_not_contact),
         dnc_reason = CASE WHEN excluded.do_not_contact = 1 AND prospects.do_not_contact = 0 THEN excluded.dnc_reason ELSE prospects.dnc_reason END,
         dnc_source = CASE WHEN excluded.do_not_contact = 1 AND (prospects.do_not_contact = 0 OR prospects.dnc_source LIKE 'manual%') AND excluded.dnc_source IS NOT NULL
                           AND excluded.dnc_source NOT LIKE 'manual%' THEN excluded.dnc_source ELSE prospects.dnc_source END,
         dnc_at = CASE WHEN excluded.do_not_contact = 1 AND prospects.do_not_contact = 0 THEN excluded.dnc_at ELSE prospects.dnc_at END,
         updated_at = excluded.updated_at`,
    ).bind(ext, ...v, dnc, dnc ? str(it.dnc_reason, 300) || null : null, dnc ? str(it.dnc_source, 40) || null : null, dnc, now(), now()));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { ok: true, saved: stmts.length };
};

const PROSPECTOR_MAIL_KEY = 'prospector_mail_snapshot_v1';
const MAIL_DAYS = 365;
const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const utcStamp = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && Number.isFinite(Date.parse(v));

const publicChatNext: Handler = async ({ env }) => {
  const t = Date.now();
  await env.DB.prepare(
    "INSERT INTO settings(key,value) VALUES ('public_chat_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    + ' WHERE settings.value<?',
  ).bind(now(), new Date(t - 15000).toISOString()).run();
  await env.DB.prepare('DELETE FROM public_chat_jobs WHERE expires<?').bind(t).run();
  const job = await env.DB.prepare(
    "UPDATE public_chat_jobs SET state='running' WHERE id=(SELECT id FROM public_chat_jobs "
    + "WHERE state='queued' AND expires>? ORDER BY expires LIMIT 1) RETURNING id,expires,payload",
  ).bind(t).first<{ id: string; expires: number; payload: string }>();
  return { job };
};

const publicChatResult: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  const id = str(b.id, 36);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, 'bad_job');
  const answer = str(b.answer, 1800).replace(/\[\[PHS:[A-Z_]+\]\]/g, '').trim();
  const result = await env.DB.prepare(
    "UPDATE public_chat_jobs SET state=?,answer=?,payload='' WHERE id=? AND state='running' AND expires>?",
  ).bind(answer ? 'done' : 'failed', answer || null, id, Date.now()).run();
  return { ok: true, accepted: result.meta.changes > 0 };
};


const PROSPECTOR_REVIEW_KEY = 'prospector_review_snapshot_v1';

function reviewWebsite(value: unknown) {
  try {
    const url = new URL(str(value, 260));
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* invalid link */ }
  return '';
}

const bridgeProspectorReview: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  if (!utcStamp(b.capturedAt) || Date.parse(b.capturedAt) > Date.now() + 5 * 60_000
      || !Array.isArray(b.rows) || b.rows.length > 60) {
    throw new HttpError(400, 'invalid_review_queue');
  }
  const seen = new Set<number>();
  const rows = b.rows.map((r: Record<string, unknown> | null) => {
    if (!r || !isCount(r.id) || r.id < 1 || seen.has(r.id) || !['P2','P3'].includes(String(r.product))
        || !isCount(r.score) || r.score < 8 || r.score > 10) throw new HttpError(400, 'invalid_review_row');
    const email = str(r.email, 180);
    const website = reviewWebsite(r.website);
    const evidence = str(r.evidence, 400);
    const draft = str(r.draft, 900);
    if (!EMAIL_RE.test(email) || !website || !evidence || !draft) throw new HttpError(400, 'incomplete_review_row');
    seen.add(r.id);
    return { id: r.id, company: str(r.company, 140), city: str(r.city, 120), product: r.product,
      score: r.score, email, website, evidence,
      evidenceCode: ['mobile', 'form', 'ava'].includes(String(r.evidenceCode)) ? r.evidenceCode : 'review',
      subject: str(r.subject, 100), draft, updatedAt: str(r.updatedAt, 26) };
  });
  const value = JSON.stringify({ capturedAt: b.capturedAt, rows });
  const result = await env.DB.prepare(
    'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value '
    + "WHERE json_extract(settings.value,'$.capturedAt') <= ?",
  ).bind(PROSPECTOR_REVIEW_KEY, value, b.capturedAt).run();
  return { ok: true, updated: result.meta.changes > 0 };
};

const prospectorReview: Handler = async ({ env }) => {
  const raw = await getSetting(env.DB, PROSPECTOR_REVIEW_KEY);
  return json({ snapshot: raw ? JSON.parse(raw) : null }, 200, { 'Cache-Control': 'no-store' });
};


const bridgeProspectorMail: Handler = async ({ req, env }) => {
  const b = await readBody(req);
  if (!utcStamp(b.capturedAt) || Date.parse(b.capturedAt) > Date.now() + 5 * 60_000
      || !isCount(b.total) || (b.lastSent !== null && (!utcStamp(b.lastSent) || b.lastSent > b.capturedAt))
      || !Array.isArray(b.daily) || b.daily.length > MAIL_DAYS) {
    throw new HttpError(400, 'invalid_snapshot');
  }
  const brt = Date.parse(b.capturedAt) - 3 * 3_600_000;
  const today = new Date(brt).toISOString().slice(0, 10);
  const oldest = new Date(brt - (MAIL_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  let sum = 0;
  const daily = b.daily.map((row: { day?: unknown; first?: unknown; followup?: unknown; other?: unknown } | null) => {
    if (!row || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
        || row.day < oldest || row.day > today || seen.has(row.day)
        || !isCount(row.first) || !isCount(row.followup) || !isCount(row.other)) {
      throw new HttpError(400, 'invalid_snapshot_day');
    }
    seen.add(row.day);
    sum += row.first + row.followup + row.other;
    return { day: row.day, first: row.first, followup: row.followup, other: row.other };
  });
  if (sum > b.total || (b.total === 0) !== (b.lastSent === null)) throw new HttpError(400, 'inconsistent_snapshot');
  const value = JSON.stringify({ capturedAt: b.capturedAt, total: b.total, lastSent: b.lastSent, daily });
  const result = await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) '
    + 'ON CONFLICT(key) DO UPDATE SET value=excluded.value '
    + "WHERE json_extract(settings.value, '$.capturedAt') <= ?").bind(PROSPECTOR_MAIL_KEY, value, b.capturedAt).run();
  return json({ ok: true, updated: result.meta.changes > 0 }, 200, { 'Cache-Control': 'no-store' });
};

const prospectorMail: Handler = async ({ env }) => {
  const raw = await getSetting(env.DB, PROSPECTOR_MAIL_KEY);
  return json({ snapshot: raw ? JSON.parse(raw) : null }, 200, { 'Cache-Control': 'no-store' });
};


const listProspects: Handler = async ({ env, url }) => {
  const sp = url.searchParams;
  const where: string[] = [];
  const args: unknown[] = [];
  const status = sp.get('status') || '';
  if (status === 'dnc') where.push('do_not_contact = 1');
  else if (PROSPECT_STATUS.includes(status)) { where.push('status = ?'); args.push(status); }
  if (sp.get('email') === '1') where.push(`IFNULL(email,'') <> ''`);
  if (sp.get('clicked') === '1') where.push('clicked = 1');
  const q = str(sp.get('q'), 100);
  if (q) { where.push('(name LIKE ? OR email LIKE ? OR city LIKE ? OR category LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sorts: Record<string, string> = { recent: 'updated_at DESC', email: 'last_email_at DESC NULLS LAST', score: 'score DESC NULLS LAST', name: 'name COLLATE NOCASE' };
  const order = sorts[sp.get('sort') || 'recent'] || sorts.recent;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const [rows, total, counts, dnc, extra] = await Promise.all([
    env.DB.prepare(`SELECT * FROM prospects ${w} ORDER BY ${order} LIMIT 50 OFFSET ?`).bind(...args, (page - 1) * 50).all(),
    env.DB.prepare(`SELECT COUNT(*) n FROM prospects ${w}`).bind(...args).first<{ n: number }>(),
    env.DB.prepare(`SELECT status, COUNT(*) n FROM prospects GROUP BY status`).all<{ status: string; n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) n FROM prospects WHERE do_not_contact = 1`).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN IFNULL(email,'')<>'' THEN 1 ELSE 0 END) com_email, SUM(emails_sent) emails, SUM(clicked) cliques FROM prospects`).first(),
  ]);
  return { rows: rows.results || [], total: total?.n || 0, page, counts: Object.fromEntries((counts.results || []).map((r) => [r.status, r.n])), dnc: dnc?.n || 0, extra };
};

const updateProspect: Handler = async ({ req, env, params, user }) => {
  const id = intId(params[0]);
  const b = await readBody(req);
  const p = await env.DB.prepare('SELECT * FROM prospects WHERE id = ?').bind(id).first<any>();
  if (!p) throw new HttpError(404, 'not_found');
  if (b.notes !== undefined) await env.DB.prepare('UPDATE prospects SET notes = ? WHERE id = ?').bind(str(b.notes, 2000) || null, id).run();
  if (b.do_not_contact !== undefined) {
    if (b.do_not_contact) {
      await env.DB.prepare(`UPDATE prospects SET do_not_contact = 1, dnc_source = 'manual', dnc_reason = ?, dnc_at = ?, status = 'nao_contactar', updated_at = ? WHERE id = ?`)
        .bind(str(b.reason, 300) || `marcado por ${user.name}`, now(), now(), id).run();
    } else {
      if (p.do_not_contact && DNC_LOCKED.includes(p.dnc_source)) throw new HttpError(409, 'locked', 'Esta pessoa pediu para sair (ou o e-mail não existe). Não pode voltar a ser contactada.');
      await env.DB.prepare(`UPDATE prospects SET do_not_contact = 0, dnc_source = 'manual_off', dnc_reason = NULL, dnc_at = ?, updated_at = ? WHERE id = ?`).bind(now(), now(), id).run();
    }
  }
  return { ok: true, row: await env.DB.prepare('SELECT * FROM prospects WHERE id = ?').bind(id).first() };
};

/** Passa um contacto da prospecção para o CRM (pipeline), sem duplicar. */
const prospectToCrm: Handler = async ({ env, params }) => {
  const id = intId(params[0]);
  const p = await env.DB.prepare('SELECT * FROM prospects WHERE id = ?').bind(id).first<any>();
  if (!p) throw new HttpError(404, 'not_found');
  if (p.crm_lead_id) return { ok: true, lead_id: p.crm_lead_id };
  let lead = p.email ? await env.DB.prepare(`SELECT id FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1`).bind(p.email).first<{ id: number }>() : null;
  if (!lead) {
    lead = await env.DB.prepare(`INSERT INTO leads (source, stage, name, email, phone, business, business_type, country, location, summary)
      VALUES ('agent', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(p.emails_sent ? 'contacted' : 'new', p.name, p.email, p.phone, p.name, p.category, p.country,
      p.city, `Vindo da prospecção (${p.product || '—'}). ${p.reason || ''}`.trim()).first<{ id: number }>();
    await addActivity(env.DB, lead!.id, 'created', 'Criado a partir da lista de prospecção');
  }
  await env.DB.prepare('UPDATE prospects SET crm_lead_id = ? WHERE id = ?').bind(lead!.id, id).run();
  return { ok: true, lead_id: lead!.id };
};

const exportProspects: Handler = async ({ env }) => {
  const r = await env.DB.prepare(`SELECT name, category, city, state, country, email, phone, website, product, score, status, emails_sent, last_email_at,
    clicked, replied_at, reply_class, do_not_contact, dnc_reason, dnc_source FROM prospects ORDER BY id`).all<any>();
  const cols = ['name', 'category', 'city', 'state', 'country', 'email', 'phone', 'website', 'product', 'score', 'status', 'emails_sent', 'last_email_at',
    'clicked', 'replied_at', 'reply_class', 'do_not_contact', 'dnc_reason', 'dnc_source'];
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + cols.join(',') + '\n' + (r.results || []).map((row) => cols.map((c) => cell(row[c])).join(',')).join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="prospeccao.csv"', ...SECURITY_HEADERS } });
};

/* ====================================================================== */
/* Router                                                                 */
/* ====================================================================== */

const routes: [string, RegExp, Handler, Access][] = [
  ['POST', /^\/api\/auth\/login$/, login, 'public'],
  ['POST', /^\/api\/auth\/logout$/, logout, 'public'],
  ['POST', /^\/api\/auth\/signup$/, signup, 'public'],
  ['GET', /^\/api\/me$/, me, 'user'],
  ['GET', /^\/api\/team$/, team, 'user'],
  ['PATCH', /^\/api\/me$/, updateMe, 'user'],
  ['POST', /^\/api\/me\/password$/, changePassword, 'user'],
  ['GET', /^\/api\/stats$/, stats, 'user'],
  ['GET', /^\/api\/detailing$/, async ({ env }) => detailingStats(env.DB), 'user'],
  ['GET', /^\/api\/leads$/, listLeads, 'user'],
  ['POST', /^\/api\/leads$/, createLead, 'user'],
  ['POST', /^\/api\/leads\/bulk$/, bulkLeads, 'user'],
  ['POST', /^\/api\/leads\/import$/, importLeads, 'user'],
  ['GET', /^\/api\/tags$/, listTags, 'user'],
  ['GET', /^\/api\/tasks$/, listTasks, 'user'],
  ['POST', /^\/api\/tasks$/, createTask, 'user'],
  ['PATCH', /^\/api\/tasks\/(\d+)$/, updateTask, 'user'],
  ['DELETE', /^\/api\/tasks\/(\d+)$/, deleteTask, 'user'],
  ['GET', /^\/api\/templates$/, listTemplates, 'user'],
  ['POST', /^\/api\/templates$/, createTemplate, 'user'],
  ['PATCH', /^\/api\/templates\/(\d+)$/, updateTemplate, 'user'],
  ['DELETE', /^\/api\/templates\/(\d+)$/, deleteTemplate, 'user'],
  ['GET', /^\/api\/reports$/, reports, 'user'],
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
  ['GET', /^\/api\/activity$/, activityFeed, 'user'],
  ['GET', /^\/api\/traffic$/, trafficStats, 'user'],
  ['GET', /^\/api\/bookings$/, listBookings, 'user'],
  ['PATCH', /^\/api\/bookings\/(\d+)$/, updateBooking, 'user'],
  ['GET', /^\/api\/booking-rules$/, getBookingRules, 'user'],
  ['PATCH', /^\/api\/booking-rules$/, putBookingRules, 'admin'],
  ['GET', /^\/api\/instagram$/, getInstagram, 'user'],
  ['POST', /^\/api\/instagram\/sync$/, syncInstagramNow, 'user'],
  ['POST', /^\/api\/instagram\/token$/, connectInstagram, 'admin'],
  ['DELETE', /^\/api\/instagram$/, disconnectInstagram, 'admin'],
  ['GET', /^\/api\/prospects$/, listProspects, 'user'],
  ['GET', /^\/api\/prospector-mail$/, prospectorMail, 'user'],
  ['GET', /^\/api\/prospector-review$/, prospectorReview, 'user'],
  ['POST', /^\/api\/bridge\/prospector-review$/, bridgeProspectorReview, 'assistant'],
  ['POST', /^\/api\/bridge\/prospector-mail$/, bridgeProspectorMail, 'assistant'],
  ['POST', /^\/api\/bridge\/public-chat\/next$/, publicChatNext, 'assistant'],
  ['POST', /^\/api\/bridge\/public-chat\/result$/, publicChatResult, 'assistant'],
  ['PATCH', /^\/api\/prospects\/(\d+)$/, updateProspect, 'user'],
  ['POST', /^\/api\/prospects\/(\d+)\/to-crm$/, prospectToCrm, 'user'],
  ['GET', /^\/api\/export\/prospects\.csv$/, exportProspects, 'user'],
  ['POST', /^\/api\/bridge\/prospects$/, bridgeProspects, 'assistant'],
  ['GET', /^\/api\/bridge\/ping$/, async () => ({ ok: true, service: 'Pipe Hero Studio CRM (assistente)' }), 'assistant'],
  ['POST', /^\/api\/bridge\/lead$/, ingestLead, 'assistant'],
  ['POST', /^\/api\/bridge\/event$/, ingestEvent, 'assistant'],
  ['POST', /^\/api\/assistant$/, askAssistant, 'user'],
  ['GET', /^\/api\/assistant\/status$/, assistantStatus, 'user'],
  ['GET', /^\/api\/assistant\/(\d+)$/, getAssistantJob, 'user'],
  ['GET', /^\/api\/bridge\/next$/, bridgeNext, 'assistant'],
  ['POST', /^\/api\/bridge\/answer\/(\d+)$/, bridgeAnswer, 'assistant'],
  ['POST', /^\/api\/bridge\/query$/, assistantQuery, 'assistant'],
  ['POST', /^\/api\/bridge\/crud$/, assistantCrud, 'assistant'],
];

async function handleApi(req: Request, env: AppEnv, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  let methodMatched = false;
  for (const [method, re, handler, access] of routes) {
    const m = path.match(re);
    if (!m) continue;
    methodMatched = true;
    if (method !== req.method) continue;

    if (access === 'assistant') {
      await checkAssistant(req, env);
      const out = await handler({ req, env, url, user: null as unknown as User, params: m.slice(1), ctx });
      return out instanceof Response ? out : json(out);
    }
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
        await env.DB.prepare('DELETE FROM public_chat_jobs WHERE expires<?').bind(Date.now()).run().catch(() => {});
        await sendDigest(env, { force: false });
        await syncInstagram(env).catch(() => null);
      })(),
    );
  },
} satisfies ExportedHandler<AppEnv>;

