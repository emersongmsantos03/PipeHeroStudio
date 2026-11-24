/**
 * Worker da Pipe Hero Studio.
 * - /api/contact: recebe o formulário, grava o lead no CRM (D1) e avisa por e-mail (Cloudflare Email Service).
 * - /api/chat: assistente de IA (worker/chat.ts).
 * - tudo o resto: ficheiros estáticos do Astro (dist/).
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleChat, type ChatEnv } from './chat';
import { notifyWhatsApp } from './notify';
import { ADMIN_URL, logEvent, saveLead, sendMail, sendViaResend, type Mail } from '../shared/crm';
import { brt, freeSlots, loadRules } from '../shared/booking';

interface Env extends ChatEnv {
  ASSETS: Fetcher;
  EMAIL: SendEmail;
  /** Opcional: endereço que recebe os pedidos (definido no painel). */
  CONTACT_TO?: string;
  BOOK_RL?: RateLimit;
}

const SERVICE_MAP: Record<string, string> = { site: 'website', chat: 'chat', crm: 'crm', agents: 'ai_agents', clinics: 'clinic_assistant', unsure: 'other' };

const DEFAULT_TO = 'emerson@pipeherostudio.digital';
const FROM = { email: 'site@pipeherostudio.digital', name: 'Site Pipe Hero Studio' };
const SERVICES = ['site', 'chat', 'crm', 'agents', 'clinics', 'unsure'];
const LANGS = ['pt', 'en', 'es'];
const THANKS: Record<string, string> = { pt: '/pt/contacto/?enviado=1', en: '/en/contact/?sent=1', es: '/es/contacto/?enviado=1' };

const MAX = { short: 200, message: 4000 };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleContact(request: Request, env: Env): Promise<Response> {
  const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
  const fail = (status: number, error: string) =>
    wantsJson ? json({ ok: false, error }, status) : new Response(error, { status });

  if (request.method !== 'POST') return fail(405, 'method_not_allowed');

  // Só aceita pedidos vindos do próprio site.
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return fail(403, 'forbidden_origin');

  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) {
    return fail(415, 'unsupported_type');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'bad_body');
  }
  const get = (k: string, max = MAX.short) => String(form.get(k) ?? '').trim().slice(0, max);

  const lang = LANGS.includes(get('idioma')) ? get('idioma') : 'pt';
  const done = () => (wantsJson ? json({ ok: true }) : Response.redirect(new URL(THANKS[lang], request.url).href, 303));

  // Honeypot: robôs preenchem este campo. Fingimos sucesso e não enviamos nada.
  if (get('bot-field')) return done();

  const data = {
    nome: get('nome'),
    negocio: get('negocio'),
    pais: get('pais'),
    email: get('email'),
    telefone: get('telefone', 40),
    servico: get('servico'),
    mensagem: get('mensagem', MAX.message),
    privacidade: get('privacidade'),
    tipo: get('tipo', 40),
    pagina: get('pagina', 40),
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email);
  const phoneOk = !data.telefone || data.telefone.replace(/\D/g, '').length >= 9;
  if (!SERVICES.includes(data.servico)) data.servico = 'unsure';
  if (!data.pais) data.pais = String((request as Request & { cf?: { country?: string } }).cf?.country || '');
  if (!data.nome || !data.negocio || !emailOk || !phoneOk) {
    return fail(400, 'validation');
  }

  // 1) Guarda no CRM primeiro: mesmo que o e-mail falhe, o lead não se perde.
  const country = String((request as Request & { cf?: { country?: string } }).cf?.country || '');
  let leadId: number | null = null;
  try {
    const saved = await saveLead(
      env.DB,
      {
        name: data.nome,
        business: data.negocio,
        business_type: data.tipo,
        country: data.pais,
        email: data.email,
        phone: data.telefone,
        language: lang,
        services: [SERVICE_MAP[data.servico] || data.servico],
        needs: data.mensagem,
        page: data.pagina,
        ip_country: country,
      },
      { source: 'form', note: `Pedido pelo formulário do site (${data.servico}):\n${data.mensagem}` },
    );
    leadId = saved.id;
  } catch (e) {
    console.error('contact: CRM save failed', (e as Error).message);
  }
  await logEvent(env.DB, 'form_submit', 'site', { leadId, meta: { servico: data.servico, pagina: data.pagina, lang } });

  const link = leadId ? `${ADMIN_URL}/#/leads/${leadId}` : ADMIN_URL;
  const rows: [string, string][] = [
    ['Nome', data.nome],
    ['Negócio', data.negocio],
    ['País', data.pais],
    ['E-mail', data.email],
    ['Telefone', data.telefone || '—'],
    ['Serviço', data.servico],
    ['Tipo de negócio', data.tipo || '—'],
    ['Idioma', lang],
    ['Página', data.pagina || '—'],
  ];
  const text = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nMensagem:\n${data.mensagem}\n\nAbrir no CRM: ${link}\n`;
  const html = `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="color:#4a556b">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`)
    .join('')}</table><p style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${esc(data.mensagem)}</p>` +
    `<p style="font-family:system-ui,sans-serif;font-size:14px"><a href="${link}" style="display:inline-block;background:#ffc83d;color:#10182b;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Abrir no CRM</a></p>`;

  const whatsapp = notifyWhatsApp(
    env,
    `Novo pedido do site (${data.servico})\n${data.nome} — ${data.negocio} (${data.pais})\n${data.email}${data.telefone ? ' · ' + data.telefone : ''}\n\n${data.mensagem}\n\n${link}`,
  );
  const emailed = await sendMail(
    env,
    {
      to: env.CONTACT_TO || DEFAULT_TO,
      from: FROM,
      replyTo: data.email,
      subject: `Novo pedido (${data.servico}): ${data.negocio}`,
      text,
      html,
    },
    { source: 'site', leadId, kind: 'lead_form' },
  );
  const whatsapped = await whatsapp;
  if (whatsapped) await logEvent(env.DB, 'whatsapp_sent', 'site', { leadId });
  // O lead ficou no CRM: só falha se nem isso nem os avisos funcionaram.
  if (!whatsapped && !emailed && !leadId) return fail(502, 'send_failed');
  return done();
}

/**
 * Ligação interna para o painel (admin.pipeherostudio.digital) enviar e-mails pelo Resend,
 * usando a chave guardada neste Worker. Só acessível por service binding (RPC), nunca pela internet.
 */
export class Mailer extends WorkerEntrypoint<Env> {
  async send(mail: Mail): Promise<{ ok: boolean; error?: string }> {
    if (!this.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY em falta no Worker do site' };
    if (!mail?.to || mail.from?.email !== 'site@pipeherostudio.digital') return { ok: false, error: 'remetente não permitido' };
    return sendViaResend(this.env.RESEND_API_KEY, mail);
  }
}

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|scrapy|facebookexternalhit|embedly/i;

/** Contador de visitas: sem cookies, sem IP; só página, origem (domínio), idioma, país e tipo de aparelho. */
/* ====================================================================== */
/* Agendamento de chamadas de 15 minutos                                   */
/* ====================================================================== */
const BOOK_TXT: Record<string, { subject: string; hi: string; body: string; link: string; noLink: string; change: string; gcal: string; bye: string }> = {
  en: { subject: 'Confirmed: 15-min call with Pipe Hero Studio, {when}', hi: 'Hi {name},', body: 'Your free 15-minute call is booked for {when} ({tz}).',
    link: 'Join here: {link}', noLink: "We'll send you the video call link by email before the call.", change: 'Need another time? Just reply to this email.',
    gcal: 'Add to Google Calendar', bye: 'Talk soon,\nEmerson · Pipe Hero Studio' },
  pt: { subject: 'Confirmado: chamada de 15 min com a Pipe Hero Studio, {when}', hi: 'Olá {name},', body: 'A sua chamada grátis de 15 minutos está marcada para {when} ({tz}).',
    link: 'Entre aqui: {link}', noLink: 'Enviamos o link da videochamada por e-mail antes da chamada.', change: 'Precisa de outro horário? Basta responder a este e-mail.',
    gcal: 'Adicionar ao Google Calendar', bye: 'Até já,\nEmerson · Pipe Hero Studio' },
  es: { subject: 'Confirmado: llamada de 15 min con Pipe Hero Studio, {when}', hi: 'Hola {name},', body: 'Tu llamada gratis de 15 minutos está reservada para el {when} ({tz}).',
    link: 'Entra aquí: {link}', noLink: 'Te enviaremos el enlace de la videollamada por email antes de la llamada.', change: '¿Necesitas otra hora? Responde a este email.',
    gcal: 'Añadir a Google Calendar', bye: 'Hasta pronto,\nEmerson · Pipe Hero Studio' },
};
const LOC: Record<string, string> = { en: 'en-US', pt: 'pt-PT', es: 'es-ES' };
const fillT = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
function validTz(tz: string) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }
function whenIn(iso: string, tz: string, lang: string) {
  return new Intl.DateTimeFormat(LOC[lang] || 'en-US', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
const gcalDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

async function handleSlots(request: Request, env: Env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const rules = await loadRules(env.DB);
  const slots = await freeSlots(env.DB, rules);
  return json({ ok: true, minutes: rules.minutes, slots });
}

async function handleBook(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ ok: false, error: 'forbidden_origin' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'x';
  if (env.BOOK_RL && !(await env.BOOK_RL.limit({ key: ip })).success) return json({ ok: false, error: 'rate_limited' }, 429);
  let b: Record<string, unknown> = {};
  try { b = JSON.parse((await request.text()).slice(0, 8000) || '{}'); } catch { return json({ ok: false, error: 'bad_body' }, 400); }
  if (b.website) return json({ ok: true }); // robô
  const s = (k: string, n = MAX.short) => String(b[k] ?? '').trim().slice(0, n);
  const data = { start: s('start', 40), name: s('name'), email: s('email').toLowerCase(), business: s('business'), phone: s('phone', 40), notes: s('notes', 2000),
    tz: s('timezone', 60), lang: LANGS.includes(s('lang', 5)) ? s('lang', 5) : 'en' };
  if (!validTz(data.tz)) data.tz = 'America/Sao_Paulo';
  if (!data.name || !data.business || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return json({ ok: false, error: 'validation' }, 400);
  const rules = await loadRules(env.DB);
  const free = await freeSlots(env.DB, rules);
  if (!free.includes(data.start)) return json({ ok: false, error: 'taken' }, 409);

  let bookingId: number;
  try {
    const row = await env.DB.prepare(`INSERT INTO bookings (start_at, minutes, name, email, business, phone, timezone, notes, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(data.start, rules.minutes, data.name, data.email, data.business, data.phone || null, data.tz, data.notes || null, data.lang).first<{ id: number }>();
    bookingId = row!.id;
  } catch {
    return json({ ok: false, error: 'taken' }, 409); // índice único: alguém marcou no mesmo segundo
  }

  const local = brt(data.start);
  const country = String((request as Request & { cf?: { country?: string } }).cf?.country || '');
  let leadId: number | null = null;
  try {
    const saved = await saveLead(env.DB, { name: data.name, business: data.business, email: data.email, phone: data.phone || null, country, language: data.lang,
      needs: data.notes || null, next_step: `Chamada de 15 min em ${local.date.split('-').reverse().join('/')} às ${local.time} (Brasília)` } as any,
      { source: 'form', note: `Marcou uma chamada de ${rules.minutes} min pelo site: ${local.date.split('-').reverse().join('/')} às ${local.time} (Brasília) · fuso da pessoa: ${data.tz}` });
    leadId = saved.id;
    await env.DB.prepare(`UPDATE leads SET stage = 'meeting', updated_at = ? WHERE id = ? AND stage IN ('new','contacted')`).bind(new Date().toISOString(), leadId).run();
    const admin = await env.DB.prepare(`SELECT id FROM users WHERE status = 'active' AND role = 'admin' ORDER BY id LIMIT 1`).first<{ id: number }>();
    const task = await env.DB.prepare(`INSERT INTO tasks (title, type, due_date, due_time, lead_id, assignee_id, notes) VALUES (?, 'meeting', ?, ?, ?, ?, ?) RETURNING id`)
      .bind(`Chamada de ${rules.minutes} min: ${data.name} (${data.business})`, local.date, local.time, leadId, admin?.id ?? null,
        [data.notes, data.phone && `Telefone: ${data.phone}`, `E-mail: ${data.email}`, rules.meetingLink && `Link: ${rules.meetingLink}`].filter(Boolean).join('\n')).first<{ id: number }>();
    await env.DB.prepare(`UPDATE leads SET next_action_at = (SELECT MIN(due_date) FROM tasks WHERE lead_id = ? AND done_at IS NULL) WHERE id = ?`).bind(leadId, leadId).run();
    await env.DB.prepare('UPDATE bookings SET lead_id = ?, task_id = ? WHERE id = ?').bind(leadId, task?.id ?? null, bookingId).run();
    await logEvent(env.DB, 'meeting_booked', 'site', { ref: data.email, leadId, meta: { start: data.start, tz: data.tz } });
  } catch (e) {
    console.error('book: crm failed', (e as Error).message);
  }

  // e-mail de confirmação para a pessoa (na língua e no fuso dela) e aviso para o Emerson
  const T = BOOK_TXT[data.lang];
  const when = whenIn(data.start, data.tz, data.lang);
  const startMs = Date.parse(data.start);
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Pipe Hero Studio · 15-min call')}&dates=${gcalDate(startMs)}/${gcalDate(startMs + rules.minutes * 60e3)}&details=${encodeURIComponent(rules.meetingLink || 'Pipe Hero Studio')}${rules.meetingLink ? `&location=${encodeURIComponent(rules.meetingLink)}` : ''}`;
  const lines = [fillT(T.hi, { name: data.name }), '', fillT(T.body, { when, tz: data.tz.replace(/_/g, ' ') }), rules.meetingLink ? fillT(T.link, { link: rules.meetingLink }) : T.noLink, '', T.change, '', T.bye];
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#10182b"><p>${esc(fillT(T.hi, { name: data.name }))}</p>
    <p><strong>${esc(fillT(T.body, { when, tz: data.tz.replace(/_/g, ' ') }))}</strong></p>
    <p>${rules.meetingLink ? `<a href="${esc(rules.meetingLink)}">${esc(fillT(T.link, { link: rules.meetingLink }))}</a>` : esc(T.noLink)}</p>
    <p><a href="${esc(gcal)}" style="display:inline-block;background:#ffc83d;color:#10182b;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${esc(T.gcal)}</a></p>
    <p>${esc(T.change)}</p><p style="white-space:pre-line">${esc(T.bye)}</p></div>`;
  await sendMail(env, { to: data.email, from: { email: 'site@pipeherostudio.digital', name: 'Emerson · Pipe Hero Studio' }, replyTo: env.CONTACT_TO || DEFAULT_TO,
    subject: fillT(T.subject, { when }), text: lines.join('\n'), html }, { source: 'site', leadId, kind: 'booking_confirm' }).catch(() => false);
  const link = leadId ? `${ADMIN_URL}/#/leads/${leadId}` : `${ADMIN_URL}/#/agenda`;
  const aviso = `Nova chamada marcada: ${local.date.split('-').reverse().join('/')} às ${local.time} (Brasília)\n${data.name} — ${data.business}\n${data.email}${data.phone ? ' · ' + data.phone : ''}\nFuso da pessoa: ${data.tz} (${when})${data.notes ? '\n\n' + data.notes : ''}\n\n${link}`;
  await sendMail(env, { to: env.CONTACT_TO || DEFAULT_TO, from: FROM, replyTo: data.email, subject: `Chamada marcada: ${data.name} (${data.business}) · ${local.date.split('-').reverse().join('/')} ${local.time}`,
    text: aviso }, { source: 'site', leadId, kind: 'booking_notify' }).catch(() => false);
  await notifyWhatsApp(env, aviso).catch(() => false);
  return json({ ok: true, id: bookingId, start: data.start, minutes: rules.minutes, meetingLink: rules.meetingLink || null, gcal });
}

async function handlePageView(request: Request, env: Env) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const ua = request.headers.get('User-Agent') || '';
  const origin = request.headers.get('Origin') || '';
  if (BOT_UA.test(ua) || (origin && !/pipeherostudio\.digital$/.test(new URL(origin).host))) return new Response(null, { status: 204 });
  let b: Record<string, unknown> = {};
  try { b = JSON.parse((await request.text()).slice(0, 2000) || '{}'); } catch { /* ignora */ }
  const path = String(b.p || '/').slice(0, 200);
  let ref = '';
  try { const h = new URL(String(b.r || '')).host; ref = h.endsWith('pipeherostudio.digital') ? '' : h; } catch { /* sem origem */ }
  // link com ?utm_source=instagram (bio, posts, e-mails) vale mais que o referrer, que os apps costumam esconder
  const utm = String(b.u || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (utm) ref = utm;
  const country = (request as unknown as { cf?: { country?: string } }).cf?.country || null;
  await logEvent(env.DB, 'page_view', 'site', { ref: path, meta: { ref, lang: String(b.l || '').slice(0, 5), country, device: /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop' } });
  return new Response(null, { status: 204 });
}

/** Link rastreado dos e-mails do prospector: regista o clique (ligado ao lead) e leva para a página de websites. */
async function handleClick(request: Request, env: Env, token: string) {
  const ua = request.headers.get('User-Agent') || '';
  if (!BOT_UA.test(ua) && /^[A-Za-z0-9_-]{4,40}$/.test(token)) {
    try {
      const sent = await env.DB.prepare(`SELECT lead_id, ref FROM events WHERE type = 'email_sent' AND json_extract(meta, '$.token') = ? LIMIT 1`).bind(token).first<{ lead_id: number | null; ref: string | null }>();
      const dup = await env.DB.prepare(`SELECT 1 FROM events WHERE type = 'email_click' AND ref = ? AND created_at > ? LIMIT 1`).bind(token, new Date(Date.now() - 60_000).toISOString()).first();
      if (!dup) await logEvent(env.DB, 'email_click', 'agent', { ref: token, leadId: sent?.lead_id ?? null, meta: { to: sent?.ref || null, country: (request as unknown as { cf?: { country?: string } }).cf?.country || null } });
    } catch { /* o redirecionamento nunca falha */ }
  }
  return Response.redirect('https://pipeherostudio.digital/en/websites/', 302);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/pv') return handlePageView(request, env);
    const clique = url.pathname.match(/^\/r\/([^/]+)\/?$/);
    if (clique) return handleClick(request, env, clique[1]);
    if (url.pathname === '/api/contact') return handleContact(request, env);
    if (url.pathname === '/api/slots') return handleSlots(request, env);
    if (url.pathname === '/api/book') return handleBook(request, env);
    if (url.pathname === '/api/chat') return handleChat(request, env, ctx);
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
