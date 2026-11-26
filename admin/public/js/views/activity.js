// Atividade geral: e-mails (site, Ava, prospector), respostas, leads, formulários e acessos ao site, numa só página.
import { api, esc, num, dateTime, buckets, columns, dayLabel, safeParse, EMAIL_SOURCE, icon } from '../lib.js';
import { getRange, setRange, rangeSeg } from './dashboard.js';

const TYPE = {
  email_sent: ['mail', 'E-mail enviado'], email_failed: ['alert', 'E-mail falhou'], email_replied: ['chat', 'Resposta recebida'],
  email_opened: ['mail', 'E-mail aberto'], email_click: ['ext', 'Clique no link do e-mail'], lead_created: ['spark', 'Lead criado'], form_submit: ['note', 'Formulário do site'],
  whatsapp_sent: ['whatsapp', 'WhatsApp enviado'], meeting_booked: ['calendar', 'Reunião marcada'], call: ['phone', 'Chamada'],
  note: ['note', 'Nota'], signup: ['user', 'Pedido de acesso'], message: ['chat', 'Mensagem'],
};
const SRC = { ...EMAIL_SOURCE, agent: 'Prospector / agentes', site: 'Site', ava: 'Ava', system: 'Painel', admin: 'Painel' };
const SERIES = [
  { key: 'agent', label: 'Prospector / agentes', color: 'var(--s1)' },
  { key: 'ava', label: 'Ava', color: 'var(--s2)' },
  { key: 'site', label: 'Site', color: 'var(--s3)' },
  { key: 'system', label: 'Painel', color: 'var(--s4)' },
];

function hbars(rows, labelKey, fmt = (v) => esc(v)) {
  if (!rows.length) return '<p class="muted" style="margin:0">Sem dados no período.</p>';
  const max = Math.max(...rows.map((r) => r.n));
  return `<div class="hbars">${rows.map((r) => `<div class="hbar" style="grid-template-columns:minmax(0,1.4fr) 1fr auto"><span class="mono" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r[labelKey] || '')}">${fmt(r[labelKey] || '—')}</span><span class="track"><span class="fill" style="width:${(r.n / max) * 100}%"></span></span><span class="v">${num(r.n)}</span></div>`).join('')}</div>`;
}

export async function render(ctx) {
  const range = getRange();
  ctx.setTitle('Atividade', 'Tudo o que está a acontecer: e-mails, respostas, leads e acessos ao site');
  const a = await api(`/activity?range=${range}`);
  if (ctx.stale()) return;
  const tot = (type, src) => a.totals.filter((t) => t.type === type && (!src || t.source === src)).reduce((s, t) => s + t.n, 0);
  const pv = a.pvDaily.reduce((s, d) => s + d.n, 0);

  ctx.page.innerHTML = `
    <div class="toolbar">${rangeSeg(range)}</div>
    <section class="tiles">
      <div class="tile"><span class="label">Visitas ao site</span><span class="value">${num(pv)}</span><span class="foot">páginas vistas, sem robôs</span></div>
      <div class="tile"><span class="label">E-mails enviados</span><span class="value">${num(tot('email_sent'))}</span><span class="foot">${num(tot('email_sent', 'agent'))} do prospector/agentes</span></div>
      <div class="tile"><span class="label">Respostas recebidas</span><span class="value">${num(tot('email_replied'))}</span><span class="foot">${tot('email_sent') ? ((tot('email_replied') / Math.max(1, tot('email_sent', 'agent'))) * 100).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '% dos envios do prospector' : '—'}</span></div>
      <div class="tile"><span class="label">Leads e formulários</span><span class="value">${num(tot('lead_created') + tot('form_submit'))}</span><span class="foot">${num(tot('form_submit'))} pelo formulário</span></div>
      <div class="tile"><span class="label">Cliques nos e-mails</span><span class="value">${num(tot('email_click'))}</span><span class="foot">no link da assinatura</span></div>
      <div class="tile"><span class="label">Falhas de envio</span><span class="value">${num(tot('email_failed'))}</span><span class="foot">${tot('email_failed') ? '<span class="overdue">ver na linha do tempo</span>' : 'nenhuma'}</span></div>
    </section>
    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Visitas ao site</h2><span class="muted">por dia</span></div><div class="chart" data-chart="pv"></div></section>
      <section class="card"><div class="card-h"><h2>E-mails enviados</h2><span class="muted">por origem</span></div><div class="chart" data-chart="em"></div></section>
    </div>
    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Páginas mais vistas</h2></div>${hbars(a.pvPages, 'page')}</section>
      <section class="card"><div class="card-h"><h2>De onde vêm</h2></div>${hbars(a.pvRefs, 'r', origemNome)}
        <div class="card-h" style="margin-top:18px"><h2>Países</h2></div>${hbars(a.pvCountries, 'c', paisNome)}
        <div class="card-h" style="margin-top:18px"><h2>Dispositivos</h2></div>${hbars(a.pvDevices, 'dv', (v) => esc(v === 'mobile' ? 'Celular' : v === 'desktop' ? 'Computador' : v))}</section>
    </div>
    <section class="card">
      <div class="card-h"><h2>Linha do tempo</h2><span class="muted">últimos 300 acontecimentos</span>
        <div class="end"><select class="input" data-f aria-label="Filtrar" style="min-width:200px"><option value="">Tudo</option>${Object.entries(TYPE).map(([k, v]) => `<option value="${k}">${v[1]}</option>`).join('')}</select></div></div>
      <div class="list" data-tl></div>
    </section>`;

  ctx.page.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); ctx.refresh(); }));
  const pb = buckets(a.from, a.pvDaily, () => 'v');
  columns(ctx.page.querySelector('[data-chart="pv"]'), { title: 'Visitas', labels: pb.labels, data: pb.data, series: [{ key: 'v', label: 'Visitas', color: 'var(--s1)' }], labelFmt: dayLabel });
  const eb = buckets(a.from, a.emailsDaily, (r) => r.source);
  const used = SERIES.filter((s) => a.emailsDaily.some((r) => r.source === s.key));
  columns(ctx.page.querySelector('[data-chart="em"]'), { title: 'E-mails', labels: eb.labels, data: eb.data, series: used.length ? used : SERIES.slice(0, 1), labelFmt: dayLabel });

  const tl = ctx.page.querySelector('[data-tl]');
  const draw = (f) => {
    const rows = a.timeline.filter((e) => !f || e.type === f);
    tl.innerHTML = rows.length ? rows.map((e) => {
      const m = safeParse(e.meta, {});
      const [ic, label] = TYPE[e.type] || ['spark', e.type];
      const detail = [m.subject && `"${m.subject}"`, m.summary, m.error].filter(Boolean).join(' · ');
      const who = e.lead_id ? `<a href="#/leads/${e.lead_id}">${esc(e.lead_name || e.business || 'Lead #' + e.lead_id)}</a>` : esc(e.ref || '');
      return `<div class="list-item"><span class="li-main"><span class="li-title"><span class="type-ico">${icon(ic)}</span> ${esc(label)} <span class="muted" style="font-weight:400">· ${esc(SRC[e.source] || e.source || '')}${m.agent ? ' (' + esc(m.agent) + ')' : ''}</span></span><span class="li-sub">${who}${detail ? ' — ' + esc(detail).slice(0, 220) : ''}</span></span><span class="li-end nowrap">${dateTime(e.created_at)}</span></div>`;
    }).join('') : '<div class="empty"><b>Nada no período.</b>Os e-mails do prospector, respostas, formulários e leads aparecem aqui.</div>';
  };
  draw('');
  ctx.page.querySelector('[data-f]').addEventListener('change', (e) => draw(e.target.value));
}

let _dn = null;
/** "BR" -> "🇧🇷 Brasil" */
function paisNome(c) {
  if (!c || c === '?' || c.length !== 2) return esc(c === '?' ? 'Desconhecido' : c || 'Desconhecido');
  try { _dn ||= new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { /* sem suporte */ }
  const cc = c.toUpperCase();
  // Códigos especiais da Cloudflare (T1 = rede Tor, XX = desconhecido) não são países: Intl.DisplayNames daria erro.
  if (cc === 'T1') return 'Rede Tor';
  if (!/^[A-Z]{2}$/.test(cc) || cc === 'XX') return 'Desconhecido';
  let nome = cc;
  try { nome = (_dn && _dn.of(cc)) || cc; } catch { /* código não reconhecido */ }
  const flag = String.fromCodePoint(...[...c.toUpperCase()].map((x) => 0x1f1a5 + x.charCodeAt(0)));
  return `${flag} ${esc(nome)}`;
}
/** origem da visita: domínio de onde a pessoa veio, com nome amigável */
function origemNome(r) {
  if (!r || r === '(direto)') return 'Direto (digitou o endereço, favoritos ou app)';
  const m = [[/google\./, 'Google'], [/bing\./, 'Bing'], [/duckduckgo/, 'DuckDuckGo'], [/(^|\.)instagram\.com|l\.instagram/, 'Instagram'], [/facebook\.com|fb\.com|l\.facebook/, 'Facebook'],
    [/linkedin|lnkd\.in/, 'LinkedIn'], [/t\.co$|twitter|x\.com/, 'X / Twitter'], [/whatsapp|wa\.me/, 'WhatsApp'], [/zoho|mail\.|outlook|gmail/, 'E-mail'], [/reddit/, 'Reddit'], [/upwork/, 'Upwork'], [/chatgpt|openai|perplexity|claude/, 'IA (ChatGPT, Perplexity…)']];
  const hit = m.find(([re]) => re.test(r));
  return esc(hit ? `${hit[1]} · ${r}` : r);
}
