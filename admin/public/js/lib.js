// Utilitários do painel: API, formatação, modais, avisos, ícones e gráficos (SVG, sem dependências).

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error || 'error', data?.message || 'Algo correu mal. Tente de novo.');
  }
  return data;
}

/* ---------- Texto ---------- */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/* ---------- Números e datas ---------- */
const nf = new Intl.NumberFormat('pt-PT');
export const num = (n) => nf.format(n || 0);
export const compact = (n) => (Math.abs(n) >= 10000 ? new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : nf.format(n));
export const pct = (x) => `${(x * 100).toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%`;
export function money(cents, cur = 'EUR', opts = {}) {
  const v = (cents || 0) / 100;
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: cur, maximumFractionDigits: opts.exact || v % 1 ? 2 : 0, minimumFractionDigits: opts.exact ? 2 : 0 }).format(v);
}
/** { EUR: 10000, USD: 500 } → "100 € · 5 US$" (nunca soma moedas diferentes). */
export function moneyMulti(obj, empty = '0 €') {
  const parts = Object.entries(obj || {}).filter(([, v]) => v).sort((a, b) => (a[0] === 'EUR' ? -1 : b[0] === 'EUR' ? 1 : 0)).map(([c, v]) => money(v, c));
  return parts.length ? parts.join(' · ') : empty;
}
export const toCents = (s) => Math.round(Number(String(s).replace(/\s/g, '').replace(',', '.')) * 100);
export const fromCents = (c) => (c == null ? '' : (c / 100).toFixed(2));

const dFmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const date = (s) => (s ? dFmt.format(new Date(s.length === 10 ? s + 'T12:00:00' : s)) : '—');
export const dateTime = (s) => (s ? dtFmt.format(new Date(s)) : '—');
export function ago(s) {
  if (!s) return '—';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return date(s);
}
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (ym, long = false) => {
  const [y, m] = ym.split('-').map(Number);
  return long ? new Date(y, m - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};

/* ---------- Vocabulário do CRM ---------- */
export const STAGES = [
  ['new', 'Novo'], ['contacted', 'Em contato'], ['meeting', 'Reunião'], ['proposal', 'Proposta'], ['won', 'Ganho'], ['lost', 'Perdido'],
];
export const STAGE = Object.fromEntries(STAGES);
export const SOURCES = [['form', 'Formulário'], ['chat', 'Ava (chat)'], ['agent', 'Agente externo'], ['manual', 'Manual']];
export const SOURCE = Object.fromEntries(SOURCES);
export const SOURCE_COLOR = { form: 'var(--s1)', chat: 'var(--s2)', agent: 'var(--s3)', manual: 'var(--s4)' };
export const QUAL = { hot: 'Quente', warm: 'Morno', cold: 'Frio' };
export const SERVICES = { website: 'Site', site: 'Site', chat: 'Chat IA', crm: 'CRM', ai_agents: 'Agentes IA', agents: 'Agentes IA', clinic_assistant: 'Clínicas', clinics: 'Clínicas', realtor_crm: 'CRM para imobiliárias', study_budget: 'Kit Estudos e Orçamento', other: 'Outro', unsure: 'Ainda não sabe' };
export const EMAIL_SOURCE = { ava: 'Ava', site: 'Formulário do site', agent: 'Agente externo', system: 'Painel (avisos)', admin: 'Painel' };
export const CURRENCIES = ['EUR', 'USD', 'BRL', 'GBP'];

export const srcTag = (s) => `<span class="src src-${esc(s)}"><i></i>${esc(SOURCE[s] || s)}</span>`;
export const qualTag = (q) => (q ? `<span class="badge ${esc(q)}"><span class="dot"></span>${esc(QUAL[q] || q)}</span>` : '');
export const stageTag = (s) => `<span class="stage st-${esc(s)}">${esc(STAGE[s] || s)}</span>`;
/** Probabilidade de fecho por etapa (quando o lead não tem uma definida). */
export const STAGE_PROB = { new: 10, contacted: 20, meeting: 40, proposal: 60, won: 100, lost: 0 };
export const probOf = (l) => (l.probability ?? STAGE_PROB[l.stage] ?? 0);
export const TASK_TYPES = [['todo', 'Tarefa', 'flag'], ['call', 'Ligar', 'phone'], ['email', 'E-mail', 'mail'], ['whatsapp', 'WhatsApp', 'whatsapp'], ['meeting', 'Reunião', 'calendar']];
export const TASK_TYPE = Object.fromEntries(TASK_TYPES.map(([k, l, i]) => [k, { label: l, icon: i }]));
export const ACT = {
  created: ['spark', 'Lead criado'], note: ['note', 'Nota'], call: ['phone', 'Ligação'], email: ['mail', 'E-mail'], whatsapp: ['whatsapp', 'WhatsApp'],
  meeting: ['calendar', 'Reunião'], stage: ['flag', 'Etapa'], update: ['edit', 'Atualização'], system: ['bot', 'Sistema'], task: ['check', 'Tarefa'],
};
export const tagsOf = (s) => [...new Set(String(s || '').split(',').map((t) => t.trim()).filter(Boolean))];
export const tagChips = (s, max = 99) => { const t = tagsOf(s); return t.slice(0, max).map((x) => `<span class="tag" title="${esc(x)}">${esc(x)}</span>`).join('') + (t.length > max ? `<span class="tag">+${t.length - max}</span>` : ''); };
export const safeParse = (s, d) => { try { return s ? JSON.parse(s) ?? d : d; } catch { return d; } };
export const services = (json) => {
  try { return (JSON.parse(json || '[]') || []).map((s) => SERVICES[s] || s); } catch { return []; }
};

/* ---------- Ícones (traço, 24×24) ---------- */
const P = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.1-6.5 8-6.5s7 2.3 8 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.3 2 2.2 4.2 4.5 4.8l1.2-1.2 1.8.9c-.3 1.1-1.2 1.8-2.3 1.7C11 15.4 8.6 13 8.3 10.8c-.1-1.1.6-2 1.7-2.3l.9 1.8z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 13a8 8 0 0 0 14.5 4.5L20 16M4 4v4h4M20 20v-4h-4"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.4 6.7h.01" stroke-width="2.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12l3 3 5-6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  template: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  euro: '<path d="M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
export const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#10182B" stroke="#2a3550"/><path d="M14 32 35 16" stroke="#EEF1F4" stroke-width="2.6" stroke-linecap="round"/><circle cx="14" cy="32" r="3.6" fill="#EEF1F4"/><circle cx="24.5" cy="24" r="3.4" fill="#EEF1F4"/><circle cx="35" cy="16" r="4.4" fill="#FFC83D"/></svg>`;

/* ---------- Avisos ---------- */
export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.innerHTML = `${icon(err ? 'alert' : 'check')}<span></span>`;
  el.lastChild.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3200);
}
export const fail = (e) => toast(e?.message || 'Algo correu mal.', true);

export async function copy(text, label = 'Copiado') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast('Não foi possível copiar. Selecione e copie à mão.', true); }
}

/* ---------- Modal ---------- */
/**
 * modal({ title, body, submit, onSubmit(form, dialog) }) — onSubmit devolve uma Promise; se lançar, mostra o erro e mantém aberto.
 */
export function modal({ title, body, submit = 'Guardar', cancel = 'Cancelar', danger = false, onSubmit, onOpen, wide = false }) {
  const d = document.createElement('dialog');
  d.className = 'modal';
  if (wide) d.style.width = 'min(760px, calc(100vw - 32px))';
  d.innerHTML = `<form method="dialog" novalidate>
    <div class="modal-h"><h2>${esc(title)}</h2><button type="button" class="btn ghost sm" data-close aria-label="Fechar">${icon('x')}</button></div>
    <div class="modal-b">${body}<p class="form-error" data-err hidden></p></div>
    <div class="modal-f">${cancel ? `<button type="button" class="btn" data-close>${esc(cancel)}</button>` : ''}${submit ? `<button type="submit" class="btn ${danger ? 'dark' : 'primary'}">${esc(submit)}</button>` : ''}</div>
  </form>`;
  document.body.append(d);
  const form = d.querySelector('form');
  const close = () => { d.close(); d.remove(); };
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = form.querySelector('[type=submit]');
    const err = form.querySelector('[data-err]');
    err.hidden = true;
    btn.disabled = true;
    try {
      const keep = await onSubmit(form, d);
      if (keep !== false) close();
    } catch (ex) {
      err.textContent = ex.message || 'Algo correu mal.';
      err.hidden = false;
      btn.disabled = false;
    }
  });
  d.showModal();
  onOpen?.(form, d);
  form.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea')?.focus();
  return { close, dialog: d, form };
}
export const confirmBox = (title, text, label = 'Confirmar') =>
  new Promise((resolve) => {
    let ok = false;
    const m = modal({ title, body: `<p style="margin:0">${text}</p>`, submit: label, danger: true, onSubmit: async () => { ok = true; } });
    m.dialog.addEventListener('close', () => resolve(ok));
  });

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

/* ---------- Gráficos ---------- */
const tip = () => document.getElementById('tooltip');
export function showTip(e, html) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
export const hideTip = () => { tip().hidden = true; };

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Bucketiza séries diárias. ≤ 92 dias → dias; mais → meses. */
export function buckets(fromIso, rows, keyOf, valueOf = (r) => r.n) {
  const start = new Date(fromIso);
  const end = new Date();
  const days = Math.round((end - start) / 864e5) + 1;
  const monthly = days > 92;
  const labels = [];
  if (monthly) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    // "Tudo": começa no primeiro mês com dados.
    const first = rows.map((r) => r.d).sort()[0];
    if (first && first.slice(0, 7) > d.toISOString().slice(0, 7)) { const [y, m] = first.split('-').map(Number); d.setUTCFullYear(y, m - 1, 1); }
    while (d <= end) { labels.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  } else {
    const d = new Date(start);
    for (let i = 0; i < days; i++) { labels.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  }
  const data = Object.fromEntries(labels.map((l) => [l, {}]));
  for (const r of rows) {
    const b = monthly ? r.d.slice(0, 7) : r.d;
    if (!data[b]) continue;
    const k = keyOf(r);
    data[b][k] = (data[b][k] || 0) + valueOf(r);
  }
  return { labels, data, monthly };
}

/**
 * Colunas (empilhadas ou agrupadas) com tooltip por coluna e tabela de dados.
 * opts: { labels, data: {label: {key: n}}, series: [{key, label, color}], format, labelFmt, mode: 'stack'|'group', height }
 */
export function columns(el, opts) {
  const { labels, data, series, format = num, labelFmt = (l) => l, mode = 'stack', height = 220, axisFmt = compact } = opts;
  const draw = () => {
    const W = Math.max(el.clientWidth, 280);
    const H = height;
    const m = { t: 8, r: 4, b: 26, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const totals = labels.map((l) => series.reduce((a, s) => a + (data[l]?.[s.key] || 0), 0));
    const peaks = labels.map((l) => Math.max(0, ...series.map((s) => data[l]?.[s.key] || 0)));
    const max = niceMax(Math.max(1, ...(mode === 'stack' ? totals : peaks)));
    const band = iw / labels.length;
    const bw = Math.min(24, Math.max(2, band * (mode === 'stack' ? 0.62 : 0.8)));
    const y = (v) => m.t + ih - (v / max) * ih;
    const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
    const every = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 64)));
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(opts.title || 'Gráfico')}">`;
    svg += `<g class="grid">${ticks.slice(1).map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>`;
    svg += `<g class="axis">${ticks.map((t) => `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(axisFmt(t))}</text>`).join('')}</g>`;
    svg += `<g class="axis">${labels.map((l, i) => i % every === 0 ? `<text x="${m.l + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(labelFmt(l, true))}</text>` : '').join('')}</g>`;
    labels.forEach((l, i) => {
      const cx = m.l + band * i + band / 2;
      svg += `<g data-i="${i}">`;
      svg += `<rect class="hover-band" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`;
      if (mode === 'stack') {
        let acc = 0;
        const visible = series.filter((s) => (data[l]?.[s.key] || 0) > 0);
        visible.forEach((s, si) => {
          const v = data[l][s.key];
          const y0 = y(acc), y1 = y(acc + v);
          const top = si === visible.length - 1;
          const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0));
          const x = cx - bw / 2;
          svg += top ? roundTop(x, y1, bw, h, Math.min(4, bw / 2, h), s.color) : `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" fill="${s.color}"/>`;
          acc += v;
        });
      } else {
        const gw = bw / series.length;
        series.forEach((s, si) => {
          const v = data[l]?.[s.key] || 0;
          if (!v) return;
          const x = cx - bw / 2 + si * gw + (si ? 1 : 0);
          const h = y(0) - y(v);
          svg += roundTop(x, y(v), gw - 1, h, Math.min(4, (gw - 1) / 2, h), s.color);
        });
      }
      svg += `<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/></g>`;
    });
    svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
    el.innerHTML = svg;
    el.querySelectorAll('g[data-i]').forEach((g) => {
      const i = Number(g.dataset.i);
      const l = labels[i];
      const bandEl = g.querySelector('.hover-band');
      const hit = g.querySelector('.hit');
      hit.addEventListener('mousemove', (e) => {
        bandEl.classList.add('on');
        const rows = series.map((s) => `<div class="row"><span><i style="background:${s.color}"></i>${esc(s.label)}</span><strong>${esc(format(data[l]?.[s.key] || 0))}</strong></div>`).join('');
        const total = series.length > 1 && mode === 'stack' ? `<div class="row" style="margin-top:4px;opacity:.8"><span>Total</span><strong>${esc(format(totals[i]))}</strong></div>` : '';
        showTip(e, `<b>${esc(labelFmt(l, false))}</b>${rows}${total}`);
      });
      hit.addEventListener('mouseleave', () => { bandEl.classList.remove('on'); hideTip(); });
    });
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(el);
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
  el.insertAdjacentHTML('beforebegin', legend);
  const table = `<details class="data"><summary>Ver dados em tabela</summary><div class="table-wrap"><table class="t"><thead><tr><th>Período</th>${series.map((s) => `<th class="num">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${labels
    .filter((l) => series.some((s) => data[l]?.[s.key]))
    .map((l) => `<tr><td>${esc(labelFmt(l, false))}</td>${series.map((s) => `<td class="num">${esc(format(data[l]?.[s.key] || 0))}</td>`).join('')}</tr>`)
    .join('') || `<tr><td colspan="${series.length + 1}" class="muted">Sem dados no período.</td></tr>`}</tbody></table></div></details>`;
  el.insertAdjacentHTML('afterend', table);
}

function roundTop(x, y, w, h, r, fill) {
  if (h <= 0) return '';
  r = Math.max(0, Math.min(r, h));
  return `<path d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z" fill="${fill}"/>`;
}

export const dayLabel = (l, short) => {
  if (l.length === 7) return monthLabel(l);
  const [, m, d] = l.split('-');
  return short ? `${d}/${m}` : date(l);
};

/* ---------- Preferências locais (só conveniência; o painel funciona sem elas) ---------- */
export function getPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
export function setPref(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } }

/* ---------- Avatares ---------- */
const AV = [['#ffc83d', '#10182b'], ['#2a78d6', '#fff'], ['#12a08a', '#fff'], ['#eb6834', '#fff'], ['#7c5cd6', '#fff'], ['#d6457a', '#fff'], ['#3d4a63', '#fff'], ['#16935a', '#fff']];
export function avatar(name, size = '', title = '') {
  if (!name) return `<span class="avatar av-empty ${size}" title="${esc(title || 'Sem responsável')}">${icon('user')}</span>`;
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = AV[h % AV.length];
  return `<span class="avatar ${size}" style="--av:${bg};--av-ink:${fg}" title="${esc(title || name)}">${esc(initials(name))}</span>`;
}

/* ---------- Estados vazios e carregamento ---------- */
export const emptyState = (ico, title, text = '', action = '') =>
  `<div class="empty"><span class="e-ico">${icon(ico)}</span><b>${title}</b>${text ? `<span>${text}</span>` : ''}${action}</div>`;
export const skeleton = (kind = 'dash') =>
  kind === 'list'
    ? `<div class="sk-page"><div class="sk" style="height:36px;max-width:640px"></div><div class="sk sk-block" style="height:420px"></div></div>`
    : `<div class="sk-page"><div class="sk-tiles">${'<div class="sk"></div>'.repeat(4)}</div><div class="cols"><div class="sk sk-block"></div><div class="sk sk-block"></div></div></div>`;

/* ---------- Menu suspenso ---------- */
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.el.remove(); openMenu.anchor?.setAttribute('aria-expanded', 'false'); openMenu = null; } }
/**
 * menu(anchor, items, { align }) — items: { label, icon, onClick, danger, sel, href, kbd } | 'sep' | { header }
 */
export function menu(anchor, items, { align = 'left', up = false } = {}) {
  if (openMenu?.anchor === anchor) return closeMenu();
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => {
    if (it === 'sep') return '<hr>';
    if (it.header) return `<div class="menu-label">${esc(it.header)}</div>`;
    const cls = `${it.danger ? 'danger' : ''} ${it.sel ? 'sel' : ''}`;
    const inner = `${it.icon ? icon(it.icon) : it.html || ''}<span>${esc(it.label)}</span>${it.kbd ? `<kbd class="kbd">${esc(it.kbd)}</kbd>` : ''}`;
    return it.href ? `<a role="menuitem" class="${cls}" href="${it.href}" ${it.ext ? 'target="_blank" rel="noopener"' : ''} data-i="${i}">${inner}</a>` : `<button type="button" role="menuitem" class="${cls}" data-i="${i}">${inner}</button>`;
  }).join('');
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = align === 'right' ? r.right - w : r.left;
  let y = up || r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6;
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, y)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { el, anchor };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    it.onClick?.();
  });
  el.querySelector('[data-i]')?.focus({ preventScroll: true });
  el.addEventListener('keydown', (e) => {
    const all = [...el.querySelectorAll('[data-i]')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
  });
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu(); });
addEventListener('hashchange', closeMenu);
addEventListener('resize', closeMenu);
document.addEventListener('scroll', (e) => { if (openMenu && !openMenu.el.contains(e.target)) closeMenu(); }, true);

/* ---------- Equipa (para responsáveis) ---------- */
let teamCache = null;
export async function team(force = false) {
  if (!teamCache || force) teamCache = api('/team').then((r) => r.users).catch((e) => { teamCache = null; throw e; });
  return teamCache;
}
export const ownerOptions = (users, sel, none = 'Sem responsável') =>
  `<option value="">${esc(none)}</option>${users.map((u) => `<option value="${u.id}"${Number(sel) === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}`;

/* ---------- Datas relativas ---------- */
export const withToday = (path) => `${path}${path.includes('?') ? '&' : '?'}today=${todayStr()}`;
export function daysFromToday(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const a = new Date(y, m - 1, d);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((a - t) / 864e5);
}
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** "Hoje", "Amanhã", "Ontem", "qui, 27/11", "Atrasada 3 d". */
export function dueLabel(ymd, time) {
  const n = daysFromToday(ymd);
  if (n == null) return 'Sem data';
  const t = time ? ` · ${time}` : '';
  if (n === 0) return `Hoje${t}`;
  if (n === 1) return `Amanhã${t}`;
  if (n === -1) return `Ontem${t}`;
  if (n < 0) return `Há ${-n} dias${t}`;
  const [y, m, d] = ymd.split('-').map(Number);
  if (n < 7) return `${WD[new Date(y, m - 1, d).getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}${t}`;
  return `${date(ymd)}${t}`;
}
export const dueClass = (ymd) => { const n = daysFromToday(ymd); return n == null ? '' : n < 0 ? 'overdue' : n === 0 ? 'due-today' : ''; };
export const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
export function nextWeekday(n = 1) {
  const d = new Date(); d.setDate(d.getDate() + 7 - ((d.getDay() + 6) % 7) + (n - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite'; };

/* ---------- Modelos de mensagem ---------- */
export const TEMPLATE_VARS = [['{primeiro_nome}', 'Primeiro nome'], ['{nome}', 'Nome completo'], ['{negocio}', 'Negócio'], ['{meu_nome}', 'O seu nome']];
export function fillTemplate(text, lead = {}, user = {}) {
  const first = (lead.name || '').trim().split(/\s+/)[0] || '';
  const me = (user.name || '').trim().split(/\s+/)[0] || '';
  return String(text || '')
    .replaceAll('{primeiro_nome}', first)
    .replaceAll('{nome}', lead.name || '')
    .replaceAll('{negocio}', lead.business || 'o seu projeto')
    .replaceAll('{meu_nome}', me || 'Emerson')
    // Sem nome: "Olá !" → "Olá!", "Olá ," → "Olá,"
    .replace(/(Olá|Oi|Bom dia|Boa tarde)\s+([!,.?])/g, '$1$2');
}
export const digits = (s) => (s || '').replace(/\D/g, '');
export const waLink = (phone, text = '') => (digits(phone).length >= 8 ? `https://wa.me/${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '');
export const mailLink = (email, subject = '', body = '') => (email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '');

/* ---------- CSV ---------- */
/** Lê CSV (vírgula ou ponto e vírgula, com aspas). Devolve { headers, rows }. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const out = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) out.push(row);
  const headers = (out.shift() || []).map((h) => h.trim());
  return { headers, rows: out };
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
