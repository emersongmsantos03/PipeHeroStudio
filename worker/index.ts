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

interface Env extends ChatEnv {
  ASSETS: Fetcher;
  EMAIL: SendEmail;
  /** Opcional: endereço que recebe os pedidos (definido no painel). */
  CONTACT_TO?: string;
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
  if (!data.nome || !data.negocio || !data.pais || !data.mensagem || !emailOk || !phoneOk || !SERVICES.includes(data.servico) || data.privacidade !== 'sim') {
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') return handleContact(request, env);
    if (url.pathname === '/api/chat') return handleChat(request, env, ctx);
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
