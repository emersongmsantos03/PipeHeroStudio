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
export const SERVICES = { website: 'Site', site: 'Site', chat: 'Chat IA', crm: 'CRM', ai_agents: 'Agentes IA', agents: 'Agentes IA', clinic_assistant: 'Clínicas', clinics: 'Clínicas', other: 'Outro', unsure: 'Ainda não sabe' };
export const EMAIL_SOURCE = { ava: 'Ava', site: 'Formulário do site', agent: 'Agente externo', system: 'Painel (avisos)', admin: 'Painel' };
export const CURRENCIES = ['EUR', 'USD', 'BRL', 'GBP'];

export const srcTag = (s) => `<span class="src src-${esc(s)}"><i></i>${esc(SOURCE[s] || s)}</span>`;
export const qualTag = (q) => (q ? `<span class="badge ${esc(q)}"><span class="dot"></span>${esc(QUAL[q] || q)}</span>` : '');
export const stageTag = (s) => `<span class="badge ${s === 'won' ? 'won' : s === 'lost' ? 'lost' : ''}">${esc(STAGE[s] || s)}</span>`;
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
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
export const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#10182B" stroke="#2a3550"/><path d="M14 32 35 16" stroke="#EEF1F4" stroke-width="2.6" stroke-linecap="round"/><circle cx="14" cy="32" r="3.6" fill="#EEF1F4"/><circle cx="24.5" cy="24" r="3.4" fill="#EEF1F4"/><circle cx="35" cy="16" r="4.4" fill="#FFC83D"/></svg>`;

/* ---------- Avisos ---------- */
export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
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
