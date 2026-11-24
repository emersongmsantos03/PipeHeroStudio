// Tráfego do site pipeherostudio.digital: quantas visitas, de onde vieram, de que países, que páginas e a que horas.
// Sem cookies nem IP: o site regista só a página, a origem (domínio), o país, o idioma e se é celular ou computador.
import { api, esc, num, buckets, columns, dayLabel, icon, showTip, hideTip } from '../lib.js';
import { getRange, setRange, rangeSeg } from './dashboard.js';

// ordem fixa dos canais = ordem fixa das cores (nunca muda com o filtro)
const CANAIS = [
  { key: 'search', label: 'Busca (Google, Bing…)', curto: 'Busca', color: 'var(--s1)' },
  { key: 'social', label: 'Redes sociais e WhatsApp', curto: 'Redes sociais', color: 'var(--s2)' },
  { key: 'direct', label: 'Direto (link, favoritos, digitou)', curto: 'Direto', color: 'var(--s3)' },
  { key: 'other', label: 'Outros sites, e-mail e IA', curto: 'Outros sites', color: 'var(--s4)' },
];
const DISP = { mobile: 'Celular', desktop: 'Computador' };
const LINGUA = { pt: 'Português', en: 'Inglês', es: 'Espanhol' };

let _dn = null;
function pais(c) {
  if (!c || c === '?' || c.length !== 2) return 'Desconhecido';
  try { _dn ||= new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { /* sem suporte */ }
  const flag = String.fromCodePoint(...[...c.toUpperCase()].map((x) => 0x1f1a5 + x.charCodeAt(0)));
  return `${flag} ${(_dn && _dn.of(c.toUpperCase())) || c}`;
}
const ORIGENS = [[/google\./, 'Google'], [/bing\./, 'Bing'], [/duckduckgo/, 'DuckDuckGo'], [/instagram/, 'Instagram'], [/facebook|fb\./, 'Facebook'],
  [/linkedin|lnkd\.in/, 'LinkedIn'], [/(^|\.)t\.co$|twitter|x\.com$/, 'X / Twitter'], [/whatsapp|wa\.me/, 'WhatsApp'], [/reddit/, 'Reddit'], [/pinterest/, 'Pinterest'],
  [/youtube/, 'YouTube'], [/quora/, 'Quora'], [/medium\.com/, 'Medium'], [/zoho|mail\.|outlook|gmail/, 'E-mail'], [/upwork/, 'Upwork'], [/chatgpt|openai/, 'ChatGPT'],
  [/perplexity/, 'Perplexity'], [/claude\.ai/, 'Claude']];
const origem = (r) => { const h = ORIGENS.find(([re]) => re.test(r)); return h ? h[1] : r; };
const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);

/** Lista com barras horizontais (uma cor só: aqui a barra mostra quantidade, não categoria). */
function barras(rows, label, total) {
  if (!rows.length) return '<p class="muted" style="margin:0">Sem visitas no período.</p>';
  const max = Math.max(...rows.map((r) => r.n));
  return `<div class="tr-bars">${rows.map((r) => `<div class="tr-bar"><span class="tr-l" title="${esc(label(r))}">${esc(label(r))}</span>
    <span class="tr-track"><span class="tr-fill" style="width:${Math.max(2, (r.n / max) * 100)}%"></span></span>
    <span class="tr-v">${num(r.n)}<small>${pct(r.n, total)}%</small></span></div>`).join('')}</div>`;
}

/** Barra 100% segmentada com legenda e números (identidade nunca só pela cor). */
function divisao(itens, total) {
  const vis = itens.filter((i) => i.n > 0);
  if (!total) return '<p class="muted" style="margin:0">Sem visitas no período.</p>';
  return `<div class="tr-split" role="img" aria-label="${esc(vis.map((i) => `${i.label}: ${pct(i.n, total)}%`).join(', '))}">${vis.map((i) =>
    `<span style="flex:${i.n};background:${i.color}" data-tip="${esc(`<b>${esc(i.label)}</b><div class="row"><span>Visitas</span><strong>${num(i.n)} (${pct(i.n, total)}%)</strong></div>`)}"></span>`).join('')}</div>
    <div class="tr-keys">${itens.map((i) => `<div class="tr-key"><i style="background:${i.color}"></i><span>${esc(i.label)}</span><b>${pct(i.n, total)}%</b><small>${num(i.n)}</small></div>`).join('')}</div>`;
}

export async function render(ctx) {
  const range = getRange();
  ctx.setTitle('Tráfego do site', 'Visitas em pipeherostudio.digital: de onde vêm, de que países e o que veem');
  ctx.setActions(`<a class="btn" href="https://pipeherostudio.digital" target="_blank" rel="noopener">${icon('ext')}<span class="lbl">Abrir o site</span></a>`);
  const t = await api(`/traffic?range=${range}`);
  if (ctx.stale()) return;

  const total = t.total || 0;
  const dias = range === 'all' ? Math.max(1, new Set(t.daily.map((d) => d.d)).size) : Number(range);
  const ch = Object.fromEntries(CANAIS.map((c) => [c.key, 0]));
  for (const r of t.channels) ch[r.ch] = (ch[r.ch] || 0) + r.n;
  const cel = (t.devices.find((d) => d.dv === 'mobile') || {}).n || 0;
  const paises = t.countries.filter((c) => c.c && c.c !== '?');
  const delta = t.prevTotal == null ? '' : t.prevTotal === 0
    ? (total ? '<span class="delta up">novo</span> ' : '')
    : (() => { const v = Math.round(((total - t.prevTotal) / t.prevTotal) * 100); return `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%</span> `; })();
  const melhorCanal = CANAIS.slice().sort((a, b) => ch[b.key] - ch[a.key])[0];
  const pico = t.hours.slice().sort((a, b) => b.n - a.n)[0];

  ctx.page.innerHTML = `
    <div class="toolbar">${rangeSeg(range)}</div>
    <section class="tiles">
      <div class="tile"><span class="label">Visitas</span><span class="value">${num(total)}</span><span class="foot">${delta}${t.prevTotal == null ? 'desde o início' : `vs. ${num(t.prevTotal)} no período anterior`}</span></div>
      <div class="tile"><span class="label">Média por dia</span><span class="value">${num(Math.round((total / dias) * 10) / 10)}</span><span class="foot">${pico && pico.n ? `pico às ${pico.h}h (Brasília)` : 'páginas vistas por dia'}</span></div>
      <div class="tile"><span class="label">Principal origem</span><span class="value sm">${total ? esc(melhorCanal.curto) : '—'}</span><span class="foot">${total ? `${pct(ch[melhorCanal.key], total)}% das visitas` : 'sem visitas ainda'}</span></div>
      <div class="tile"><span class="label">Países</span><span class="value">${num(paises.length)}</span><span class="foot">${paises[0] ? `mais visitas: ${esc(pais(paises[0].c))}` : '—'}</span></div>
      <div class="tile"><span class="label">Pelo celular</span><span class="value">${pct(cel, total)}%</span><span class="foot">${num(t.other.form_submit || 0)} formulário${t.other.form_submit === 1 ? '' : 's'} · ${num(t.other.email_click || 0)} clique${t.other.email_click === 1 ? '' : 's'} de e-mail</span></div>
    </section>

    <section class="card"><div class="card-h"><h2>Visitas por dia</h2><span class="muted">por origem</span></div><div class="chart" data-chart="dias"></div></section>

    <div class="tr-grid">
      <section class="card"><div class="card-h"><h2>De onde vêm as visitas</h2></div>
        ${divisao(CANAIS.map((c) => ({ ...c, n: ch[c.key] })), total)}
        <div class="card-h" style="margin:18px 0 10px"><h2>Sites que mandaram visitas</h2></div>
        ${barras(t.refs, (r) => (origem(r.r) === r.r ? r.r : `${origem(r.r)} · ${r.r}`), total)}
      </section>
      <section class="card"><div class="card-h"><h2>Países</h2><span class="muted">top 15</span></div>${barras(t.countries, (r) => pais(r.c), total)}</section>
    </div>

    <div class="tr-grid">
      <section class="card"><div class="card-h"><h2>Horário das visitas</h2><span class="muted">hora de Brasília</span></div><div class="chart" data-chart="horas"></div></section>
      <section class="card"><div class="card-h"><h2>Celular ou computador</h2></div>
        ${divisao([{ key: 'mobile', label: 'Celular', color: 'var(--s1)', n: cel }, { key: 'desktop', label: 'Computador', color: 'var(--s2)', n: (t.devices.find((d) => d.dv === 'desktop') || {}).n || 0 }], total)}
        <div class="card-h" style="margin:18px 0 10px"><h2>Idioma do site</h2></div>
        ${barras(t.langs, (r) => LINGUA[r.l] || (r.l === '?' ? 'Desconhecido' : r.l), total)}
      </section>
    </div>

    <section class="card"><div class="card-h"><h2>Páginas mais vistas</h2></div>${barras(t.pages, (r) => r.page || '/', total)}</section>
    <p class="faint" style="margin:0;font-size:12.5px">Contamos páginas vistas por pessoas (robôs ficam de fora). Por privacidade não guardamos IP nem cookies: só o país, a origem, o idioma e o tipo de aparelho.</p>`;

  const P = ctx.page;
  P.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); ctx.refresh(); }));
  const pb = buckets(t.from, t.daily, (r) => r.ch);
  columns(P.querySelector('[data-chart="dias"]'), { title: 'Visitas por dia', labels: pb.labels, data: pb.data, series: CANAIS.map(({ key, label, color }) => ({ key, label, color })), labelFmt: dayLabel });
  const horas = Array.from({ length: 24 }, (_, h) => String(h));
  const hd = Object.fromEntries(horas.map((h) => [h, { v: 0 }]));
  for (const r of t.hours) if (hd[String(r.h)]) hd[String(r.h)].v = r.n;
  columns(P.querySelector('[data-chart="horas"]'), { title: 'Visitas por hora', labels: horas, data: hd, height: 180, series: [{ key: 'v', label: 'Visitas', color: 'var(--s1)' }], labelFmt: (h, short) => (short ? `${h}h` : `${h}h–${Number(h) + 1}h`) });
  P.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => showTip(e, el.dataset.tip));
    el.addEventListener('mouseleave', hideTip);
  });
}
