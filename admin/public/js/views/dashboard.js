// Visão geral: indicadores, agenda do dia, leads por origem, funil, financeiro e atividade recente.
import {
  api, esc, num, pct, money, moneyMulti, buckets, columns, dayLabel, monthLabel, ago, icon, withToday, greeting,
  SOURCES, SOURCE_COLOR, STAGES, QUAL, srcTag, qualTag, ACT, avatar, emptyState, dueLabel, dueClass, TASK_TYPE, getPref, setPref,
} from '../lib.js';
import { completeTask } from './tasks.js';

export const RANGES = [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['all', 'Tudo']];
export const getRange = () => getPref('phs-range', '30');
export const setRange = (r) => setPref('phs-range', r);
export const rangeSeg = (r) => `<div class="seg" role="group" aria-label="Período">${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === r}">${l}</button>`).join('')}</div>`;
export const rangeName = (r) => (r === 'all' ? 'desde o início' : r === '365' ? 'nos últimos 12 meses' : `nos últimos ${r} dias`);

function delta(cur, prev) {
  if (!prev) return cur ? '<span class="delta up">novo</span>' : '';
  const d = (cur - prev) / prev;
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '↑' : '↓'} ${pct(Math.abs(d))}</span> vs período anterior`;
}
const tile = ({ label, value, foot = '', href = '', sm = false, ico, tone = '' }) =>
  `<${href ? `a href="${href}"` : 'div'} class="tile ${tone}"><span class="label">${ico ? `<span class="ti">${icon(ico)}</span>` : ''}${label}</span><span class="value${sm ? ' sm' : ''}">${value}</span>${foot ? `<span class="foot">${foot}</span>` : ''}</${href ? 'a' : 'div'}>`;

function profit(inc, exp) {
  const out = {};
  for (const c of new Set([...Object.keys(inc), ...Object.keys(exp)])) out[c] = (inc[c] || 0) - (exp[c] || 0);
  return out;
}

export async function render(ctx) {
  const range = getRange();
  const u = ctx.state.user;
  const today = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  ctx.setTitle(`${greeting()}, ${u.name.split(' ')[0]}`, `<span class="greet-date">${esc(today)}</span> · resumo ${rangeName(range)}`);
  ctx.setActions(rangeSeg(range)).querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); ctx.refresh(); }));
  const s = await api(withToday(`/stats?range=${range}`));
  if (ctx.stale()) return;

  const L = s.leads;
  const pr = profit(s.finance.income, s.finance.expense);
  const negative = Object.values(pr).some((v) => v < 0);

  ctx.page.innerHTML = `
    ${s.pendingUsers ? `<a class="notice warn" href="#/users">${icon('users')}<span>${s.pendingUsers} cadastro${s.pendingUsers > 1 ? 's' : ''} à espera de aprovação → aprovar</span></a>` : ''}
    <section class="tiles" aria-label="Indicadores">
      ${tile({ label: 'Novos leads', value: num(L.total), foot: delta(L.total, L.previous), href: '#/leads', ico: 'users', tone: 'tc-blue' })}
      ${tile({ label: 'Conversas com a Ava', value: num(s.ava.conversations), foot: `${num(s.ava.leads)} viraram lead · ${pct(s.ava.conversion)}`, href: '#/agent', ico: 'bot', tone: 'tc-amber' })}
      ${tile({ label: 'Negócios ganhos', value: num(L.won), foot: `${moneyMulti(L.wonValue)}${L.winRate != null ? ` · taxa de ganho ${pct(L.winRate)}` : ''}`, href: '#/reports', ico: 'target', tone: 'tc-green' })}
      ${tile({ label: 'Pipeline ponderado', value: moneyMulti(L.weightedValue), foot: `Total em aberto: ${moneyMulti(L.openValue)}`, href: '#/crm', sm: true, ico: 'layers', tone: 'tc-ink' })}
      ${tile({ label: 'Receita recebida', value: moneyMulti(s.finance.income), foot: `Despesas: ${moneyMulti(s.finance.expense)}`, href: '#/finance', sm: true, ico: 'trend', tone: 'tc-green' })}
      ${tile({ label: 'Lucro', value: moneyMulti(pr), foot: negative ? '<span class="overdue">Negativo no período</span>' : rangeName(range), href: '#/finance', sm: true, ico: 'euro', tone: negative ? 'tc-red' : 'tc-green' })}
      ${tile({ label: 'A receber', value: moneyMulti(s.finance.receivable), foot: 'Receitas pendentes', href: '#/finance', sm: true, ico: 'clock', tone: 'tc-amber' })}
      ${tile({ label: 'E-mails enviados', value: num(s.emails.sent), foot: s.emails.failed ? `<span class="overdue">${s.emails.failed} falharam</span>` : `${num(s.forms)} formulários recebidos`, href: '#/agent', ico: 'mail', tone: s.emails.failed ? 'tc-red' : 'tc-blue' })}
    </section>

    <div class="cols">
      <section class="card"><div class="card-h"><h2>Leads por ${range === '365' || range === 'all' ? 'mês' : 'dia'}</h2><span class="muted">por origem</span><a class="end btn xs" href="#/leads">Ver leads</a></div><div class="chart" data-chart="leads"></div></section>
      <section class="card" style="align-self:start">
        <div class="card-h"><span class="ico">${icon('tasks')}</span><h2>A sua agenda</h2>${s.tasks.overdue ? `<span class="badge hot">${s.tasks.overdue} atrasada${s.tasks.overdue > 1 ? 's' : ''}</span>` : ''}<a class="end btn xs" href="#/tasks">Ver tudo</a></div>
        <div data-agenda>${agendaBlock(s.tasks.due)}</div>
        ${L.newCount ? `<a class="notice info" href="#/tasks" style="margin-top:12px">${icon('inbox')}<span><strong>${L.newCount}</strong> lead${L.newCount > 1 ? 's' : ''} na etapa “Novo” à espera de primeiro contacto</span></a>` : ''}
      </section>
    </div>

    <div class="cols">
      <section class="card"><div class="card-h"><h2>Funil de vendas</h2><span class="muted">todos os leads, por etapa</span><a class="end btn xs" href="#/crm">Abrir pipeline</a></div>${funnelBlock(s.funnel)}</section>
      <section class="card">
        <div class="card-h"><h2>Origem dos leads</h2></div>
        ${originBlock(L)}
        <div class="card-h" style="margin-top:14px"><h2>Qualificação</h2></div>
        ${qualBlock(L.byQualification)}
      </section>
    </div>

    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Receita e despesas</h2><span class="muted">pagas, últimos 12 meses</span></div><div class="chart" data-chart="finance"></div></section>
      <section class="card"><div class="card-h"><h2>Atividade recente</h2><span class="muted">toda a equipa</span></div>${activityBlock(s.activity.slice(0, 6))}</section>
    </div>

    <section class="card"><div class="card-h"><h2>Últimos leads</h2><a class="end btn xs" href="#/leads">Ver todos</a></div>${recentBlock(s.recentLeads)}</section>`;

  // Concluir tarefas diretamente da agenda.
  ctx.page.querySelector('[data-agenda]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tick]');
    if (!b) return;
    const t = s.tasks.due.find((x) => x.id === Number(b.dataset.tick));
    b.closest('.task').classList.add('done');
    try { await completeTask(t, () => { ctx.refreshCounts(); ctx.refresh(); }); } catch (err) { b.closest('.task').classList.remove('done'); }
  });

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

function agendaBlock(rows) {
  if (!rows.length) return emptyState('check', 'Nada para hoje.', 'Sem tarefas atrasadas ou marcadas para hoje.');
  return `<div class="tasks">${rows.map((t) => {
    const ty = TASK_TYPE[t.type] || TASK_TYPE.todo;
    return `<div class="task"><button type="button" class="tick" data-tick="${t.id}" aria-label="Concluir">${icon('check')}</button>
      <div class="t-main"><span class="t-title">${esc(t.title)}</span><span class="t-meta"><span class="type-ico">${icon(ty.icon)}</span><span class="${dueClass(t.due_date)}">${esc(dueLabel(t.due_date, t.due_time))}</span>${t.lead_id ? `<a href="#/leads/${t.lead_id}">${esc(t.lead_name || t.lead_business || 'Lead')}</a>` : ''}</span></div></div>`;
  }).join('')}</div>`;
}

function originBlock(L) {
  const total = L.total || 0;
  if (!total) return `<p class="muted" style="margin:0">Ainda não entraram leads neste período.</p>`;
  return `<div class="segbar" role="img" aria-label="Distribuição por origem">${SOURCES.filter(([k]) => L.bySource[k]).map(([k]) => `<span style="flex:${L.bySource[k]};background:${SOURCE_COLOR[k]}"></span>`).join('')}</div>
    <div class="list">${SOURCES.map(([k]) => `<a class="list-item" href="#/leads?source=${k}&view=all" style="padding:7px 0"><span class="li-main">${srcTag(k)}</span><strong class="tnum" style="font-size:13px">${num(L.bySource[k] || 0)}</strong><span class="faint tnum" style="width:48px;text-align:right;font-size:12px">${pct((L.bySource[k] || 0) / total)}</span></a>`).join('')}</div>`;
}

function qualBlock(q) {
  const rows = [['hot', q.hot || 0], ['warm', q.warm || 0], ['cold', q.cold || 0], ['none', q.none || 0]];
  const total = rows.reduce((a, r) => a + r[1], 0);
  if (!total) return `<p class="muted" style="margin:0">Sem leads no período.</p>`;
  return `<div class="row" style="gap:6px">${rows.filter((r) => r[1]).map(([k, n]) => (k === 'none' ? `<span class="badge">Sem qualificação · ${n}</span>` : `<a href="#/leads?qualification=${k}&view=all" style="text-decoration:none"><span class="badge ${k}"><span class="dot"></span>${QUAL[k]} · ${n}</span></a>`)).join('')}</div>`;
}

function funnelBlock(funnel) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return `<div class="funnel">${funnel
    .map((f) => {
      const val = moneyMulti(f.value, '');
      return `<a href="#/leads?stage=${f.stage}&view=all" class="st-${f.stage}"><span>${esc(STAGES.find((s) => s[0] === f.stage)[1])}</span><span class="bar"><span style="width:${(f.count / max) * 100}%"></span>${f.count ? `<b>${num(f.count)}</b>` : ''}</span><span class="v">${val || '—'}</span></a>`;
    })
    .join('')}</div>`;
}

function activityBlock(rows) {
  if (!rows.length) return emptyState('chat', 'Sem atividade ainda.');
  return `<div class="timeline">${rows.map((a) => {
    const [ic, lab] = ACT[a.type] || ACT.system;
    return `<div class="tl"><span class="tl-ico k-${a.type}">${icon(ic)}</span><div class="tl-body"><div class="tl-meta"><strong>${lab}</strong><a href="#/leads/${a.lead_id}" style="color:inherit">${esc(a.lead_name || a.lead_business || 'Lead #' + a.lead_id)}</a><span>· ${ago(a.created_at)}${a.user_name ? ' · ' + esc(a.user_name.split(' ')[0]) : ''}</span></div><p class="faint" style="font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(a.content || '')}</p></div></div>`;
  }).join('')}</div>`;
}

function recentBlock(rows) {
  if (!rows.length) return emptyState('users', 'Ainda sem leads.', 'Quando alguém preencher o formulário ou falar com a Ava, aparece aqui.');
  return `<div class="list">${rows
    .map((r) => `<a class="list-item" href="#/leads/${r.id}">${avatar(r.name || r.email || '?', 'sm')}<span class="li-main"><span class="li-title">${esc(r.name || r.email || 'Sem nome')}${r.business ? ` <span class="muted" style="font-weight:400">· ${esc(r.business)}</span>` : ''}</span><span class="li-sub">${esc(r.summary || r.needs || '')}</span></span><span class="li-end">${ago(r.created_at)}<span class="row" style="gap:6px">${srcTag(r.source)}${qualTag(r.qualification)}</span></span></a>`)
    .join('')}</div>`;
}
