/**
 * Worker da Pipe Hero Studio.
 * - /api/contact: recebe o formulário e envia-o por e-mail (Cloudflare Email Service).
 * - tudo o resto: ficheiros estáticos do Astro (dist/).
 */

interface Env {
  ASSETS: Fetcher;
  EMAIL: SendEmail;
  /** Opcional: endereço que recebe os pedidos (definido no painel). */
  CONTACT_TO?: string;
}

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
  const text = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nMensagem:\n${data.mensagem}\n`;
  const html = `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="color:#4a556b">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`)
    .join('')}</table><p style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${esc(data.mensagem)}</p>`;

  try {
    await env.EMAIL.send({
      to: env.CONTACT_TO || DEFAULT_TO,
      from: FROM,
      replyTo: data.email,
      subject: `Novo pedido (${data.servico}): ${data.negocio}`.replace(/[\r\n]+/g, ' ').slice(0, 150),
      text,
      html,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('contact: send failed', err.code, err.message);
    return fail(502, 'send_failed');
  }
  return done();
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') return handleContact(request, env);
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
