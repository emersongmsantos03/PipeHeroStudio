// Visão geral: leads, Ava, e-mails, funil, follow-ups e financeiro.
import {
  api, esc, num, pct, money, moneyMulti, buckets, columns, dayLabel, monthLabel, ago, date, todayStr, icon,
  SOURCES, SOURCE_COLOR, STAGES, QUAL, srcTag, qualTag, stageTag, EMAIL_SOURCE,
} from '../lib.js';

export const RANGES = [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['all', 'Tudo']];
export function getRange() {
  try { return localStorage.getItem('phs-range') || '30'; } catch { return '30'; }
}
export function setRange(r) {
  try { localStorage.setItem('phs-range', r); } catch { /* sem armazenamento */ }
}
export const rangeSeg = (r) => `<div class="seg" role="group" aria-label="Período">${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === r}">${l}</button>`).join('')}</div>`;
const rangeName = (r) => (r === 'all' ? 'desde o início' : r === '365' ? 'nos últimos 12 meses' : `nos últimos ${r} dias`);

function delta(cur, prev) {
  if (!prev) return cur ? '<span class="delta up">novo</span>' : '';
  const d = (cur - prev) / prev;
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))}</span> vs período anterior`;
}
const tile = (label, value, foot = '', href = '', sm = false) =>
  `<${href ? `a href="${href}"` : 'div'} class="tile"><span class="label">${label}</span><span class="value${sm ? ' sm' : ''}">${value}</span>${foot ? `<span class="foot">${foot}</span>` : ''}</${href ? 'a' : 'div'}>`;

function profit(inc, exp) {
  const out = {};
  for (const c of new Set([...Object.keys(inc), ...Object.keys(exp)])) out[c] = (inc[c] || 0) - (exp[c] || 0);
  return out;
}

export async function render(ctx) {
  const range = getRange();
  ctx.setTitle('Visão geral', `Tudo o que entrou ${rangeName(range)}`);
  const a = ctx.setActions(`<a class="btn primary" href="#/crm">${icon('board')}<span class="lbl">Abrir CRM</span></a>`);
  void a;
  const s = await api(`/stats?range=${range}`);
  if (ctx.stale()) return;

  const L = s.leads;
  const emailParts = Object.entries(s.emails.bySource).map(([k, v]) => `${EMAIL_SOURCE[k] || k}: ${num(v)}`).join(' · ');
  const pr = profit(s.finance.income, s.finance.expense);

  ctx.page.innerHTML = `
    <div class="toolbar">${rangeSeg(range)}</div>
    ${s.pendingUsers ? `<a class="notice warn" href="#/users" style="text-decoration:none">${s.pendingUsers} cadastro${s.pendingUsers > 1 ? 's' : ''} à espera de aprovação → aprovar</a>` : ''}
    <section class="tiles" aria-label="Indicadores">
      ${tile('Novos leads', num(L.total), delta(L.total, L.previous), '#/leads')}
      ${tile('Conversas com a Ava', num(s.ava.conversations), `${num(s.ava.leads)} viraram lead · ${pct(s.ava.conversion)}`, '#/agent')}
      ${tile('E-mails enviados', num(s.emails.sent), (emailParts || 'Nenhum ainda') + (s.emails.failed ? ` · <span class="overdue">${s.emails.failed} falharam</span>` : ''), '#/agent')}
      ${tile('Formulários enviados', num(s.forms), `${num(L.bySource.form)} leads do formulário`, '#/leads?source=form')}
      ${tile('Negócios ganhos', num(L.won), `${moneyMulti(L.wonValue)} · conversão ${pct(L.conversion)}`, '#/crm')}
      ${tile('Pipeline aberto', moneyMulti(L.openValue), 'Valor dos negócios em curso', '#/crm', true)}
      ${tile('Receita recebida', moneyMulti(s.finance.income), `Despesas: ${moneyMulti(s.finance.expense)}`, '#/finance', true)}
      ${tile('Lucro', moneyMulti(pr), rangeName(range), '#/finance', true)}
      ${tile('A receber', moneyMulti(s.finance.receivable), 'Receitas pendentes', '#/finance', true)}
      ${tile('Recorrente mensal', moneyMulti(s.finance.mrr), 'Receitas recorrentes (últimos 31 dias)', '#/finance', true)}
    </section>

    <div class="cols">
      <section class="card"><div class="card-h"><h2>Leads por ${range === '365' || range === 'all' ? 'mês' : 'dia'}</h2><span class="muted">por origem</span></div><div class="chart" data-chart="leads"></div></section>
      <section class="card">
        <div class="card-h"><h2>Origem dos leads</h2></div>
        ${originBlock(L)}
        <div class="card-h" style="margin-top:18px"><h2>Qualificação</h2><span class="muted">pela Ava</span></div>
        ${qualBlock(L.byQualification)}
      </section>
    </div>

    <div class="cols">
      <section class="card"><div class="card-h"><h2>Funil de vendas</h2><span class="muted">todos os leads, por etapa</span><a class="end btn sm" href="#/crm">Ver quadro</a></div>${funnelBlock(s.funnel)}</section>
      <section class="card"><div class="card-h"><h2>Para fazer</h2><span class="muted">próximas ações até hoje</span></div>${followBlock(s.followups)}</section>
    </div>

    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Receita e despesas</h2><span class="muted">pagas, últimos 12 meses</span></div><div class="chart" data-chart="finance"></div></section>
      <section class="card"><div class="card-h"><h2>Últimos leads</h2><a class="end btn sm" href="#/leads">Ver todos</a></div>${recentBlock(s.recentLeads)}</section>
    </div>`;

  ctx.page.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); ctx.refresh(); }));

  const lb = buckets(s.from, L.daily, (r) => r.source);
  columns(ctx.page.querySelector('[data-chart="leads"]'), {
    title: 'Leads por período e origem',
    labels: lb.labels,
    data: lb.data,
    series: SOURCES.map(([k, l]) => ({ key: k, label: l, color: SOURCE_COLOR[k] })),
    labelFmt: dayLabel,
  });

  const months = [];
  const [y0, m0] = s.finance.monthsFrom.split('-').map(Number);
  for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(y0, m0 - 1 + i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const curCount = {};
  for (const r of s.finance.monthly) curCount[r.currency] = (curCount[r.currency] || 0) + 1;
  const cur = curCount.EUR || !Object.keys(curCount).length ? 'EUR' : Object.entries(curCount).sort((a, b) => b[1] - a[1])[0][0];
  const fdata = Object.fromEntries(months.map((m) => [m, {}]));
  for (const r of s.finance.monthly) if (r.currency === cur && fdata[r.m]) fdata[r.m][r.kind] = r.total;
  const fEl = ctx.page.querySelector('[data-chart="finance"]');
  columns(fEl, {
    title: 'Receita e despesas por mês',
    labels: months,
    data: fdata,
    mode: 'group',
    series: [{ key: 'income', label: 'Receita', color: 'var(--s1)' }, { key: 'expense', label: 'Despesas', color: 'var(--s2)' }],
    format: (v) => money(v, cur),
    axisFmt: (v) => money(v, cur).replace(/,00/, ''),
    labelFmt: (l) => monthLabel(l),
  });
  if (Object.keys(curCount).length > 1) fEl.insertAdjacentHTML('afterend', `<p class="faint" style="font-size:12px;margin:6px 0 0">Gráfico em ${cur}. Valores noutras moedas estão no Financeiro.</p>`);
}

function originBlock(L) {
  const total = L.total || 0;
  if (!total) return `<p class="muted" style="margin:0">Ainda não entraram leads neste período.</p>`;
  return `<div class="segbar" role="img" aria-label="Distribuição por origem">${SOURCES.filter(([k]) => L.bySource[k]).map(([k]) => `<span style="flex:${L.bySource[k]};background:${SOURCE_COLOR[k]}"></span>`).join('')}</div>
    <div class="list">${SOURCES.map(([k, l]) => `<a class="list-item" href="#/leads?source=${k}" style="padding:7px 0"><span class="li-main">${srcTag(k)}</span><span class="li-end" style="font-size:13px;color:var(--ink)"><strong>${num(L.bySource[k] || 0)}</strong></span><span class="faint" style="width:48px;text-align:right;font-size:12px">${pct((L.bySource[k] || 0) / total)}</span></a>`).join('')}</div>`;
}

function qualBlock(q) {
  const rows = [['hot', q.hot || 0], ['warm', q.warm || 0], ['cold', q.cold || 0], ['none', q.none || 0]];
  const total = rows.reduce((a, r) => a + r[1], 0);
  if (!total) return `<p class="muted" style="margin:0">Sem leads no período.</p>`;
  return `<div class="row" style="gap:8px">${rows.filter((r) => r[1]).map(([k, n]) => (k === 'none' ? `<span class="badge">Sem qualificação · ${n}</span>` : `<span class="badge ${k}"><span class="dot"></span>${QUAL[k]} · ${n}</span>`)).join('')}</div>`;
}

function funnelBlock(funnel) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return `<div class="hbars">${funnel
    .map((f) => {
      const color = f.stage === 'won' ? 'var(--s3)' : f.stage === 'lost' ? 'var(--line-strong)' : 'var(--s1)';
      const val = moneyMulti(f.value, '');
      return `<a class="hbar" href="#/crm" style="text-decoration:none"><span>${esc(STAGES.find((s) => s[0] === f.stage)[1])}</span><span class="track"><span class="fill" style="width:${(f.count / max) * 100}%;background:${color}"></span></span><span class="v"><strong style="color:var(--ink)">${num(f.count)}</strong>${val ? ` · ${val}` : ''}</span></a>`;
    })
    .join('')}</div>`;
}

function followBlock(rows) {
  if (!rows.length) return `<div class="empty"><b>Nada pendente.</b>Marque a “próxima ação” num lead para ele aparecer aqui.</div>`;
  const t = todayStr();
  return `<div class="list">${rows
    .map((r) => `<a class="list-item" href="#/leads/${r.id}"><span class="li-main"><span class="li-title">${esc(r.name || r.business || 'Lead #' + r.id)}</span><span class="li-sub">${esc(r.next_step || r.business || '')}</span></span><span class="li-end"><span class="${r.next_action_at < t ? 'overdue' : ''}">${r.next_action_at < t ? 'Atrasado · ' : 'Hoje · '}${date(r.next_action_at)}</span>${stageTag(r.stage)}</span></a>`)
    .join('')}</div>`;
}

function recentBlock(rows) {
  if (!rows.length) return `<div class="empty"><b>Ainda sem leads.</b>Quando alguém preencher o formulário ou falar com a Ava, aparece aqui.</div>`;
  return `<div class="list">${rows
    .map((r) => `<a class="list-item" href="#/leads/${r.id}"><span class="li-main"><span class="li-title">${esc(r.name || r.email || 'Sem nome')}${r.business ? ` <span class="muted" style="font-weight:400">· ${esc(r.business)}</span>` : ''}</span><span class="li-sub">${esc(r.summary || r.needs || '')}</span></span><span class="li-end">${ago(r.created_at)}${srcTag(r.source)}${qualTag(r.qualification)}</span></a>`)
    .join('')}</div>`;
}
