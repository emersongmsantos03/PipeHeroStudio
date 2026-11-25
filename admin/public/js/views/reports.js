import { mountProspectorMail } from './prospector-mail.js';
// Relatórios: taxa de ganho, tempo para fechar, tempo até ao 1.º contacto, previsão ponderada, motivos de perda,
// desempenho por origem, por serviço e por pessoa da equipa.
import { api, esc, num, pct, money, moneyMulti, columns, monthLabel, icon, avatar, emptyState, SOURCES, SOURCE_COLOR, SERVICES, safeParse, ACT } from '../lib.js';
import { getRange, setRange, rangeName } from './dashboard.js';

const R_RANGES = [['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['all', 'Tudo']];
const days = (d) => (d == null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toLocaleString('pt-PT', { maximumFractionDigits: d < 10 ? 1 : 0 })} dias`);

export async function render(ctx) {
  let range = getRange();
  if (!R_RANGES.some(([k]) => k === range)) range = '90';
  ctx.setTitle('Relatórios', `Como estão as vendas ${rangeName(range)}`);
  ctx.setActions(`<div class="seg" role="group" aria-label="Período">${R_RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>`)
    .querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); ctx.refresh(); }));
  const r = await api(`/reports?range=${range}`);
  if (ctx.stale()) return;

  // Taxa de ganho por origem
  const bySrc = {};
  for (const x of r.closedBySource) { bySrc[x.source] ||= { won: 0, lost: 0 }; bySrc[x.source][x.stage] += x.n; }
  const won = Object.values(bySrc).reduce((a, x) => a + x.won, 0);
  const lost = Object.values(bySrc).reduce((a, x) => a + x.lost, 0);
  const winRate = won + lost ? won / (won + lost) : null;

  // Ticket médio
  const wonVal = Object.fromEntries(r.wonValue.map((x) => [x.currency, x.total]));
  const ticket = Object.fromEntries(r.wonValue.filter((x) => x.n).map((x) => [x.currency, Math.round(x.total / x.n)]));

  // Previsão ponderada por mês de fecho
  const weighted = {};
  const forecastByMonth = {};
  let noDate = 0;
  for (const l of r.open) {
    if (!l.value_cents) continue;
    const p = l.probability ?? r.stageProb[l.stage] ?? 0;
    const w = Math.round((l.value_cents * p) / 100);
    weighted[l.currency] = (weighted[l.currency] || 0) + w;
    if (l.currency !== 'EUR') continue;
    if (!l.expected_close_at) { noDate += w; continue; }
    const m = l.expected_close_at.slice(0, 7);
    forecastByMonth[m] = (forecastByMonth[m] || 0) + w;
  }
  const fMonths = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); fMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const overdueForecast = Object.entries(forecastByMonth).filter(([m]) => m < fMonths[0]).reduce((a, [, v]) => a + v, 0);

  // Motivos de perda
  const reasons = {};
  for (const lr of r.lostReasons) { const k = (lr || 'Sem motivo').split(':')[0].trim(); reasons[k] = (reasons[k] || 0) + 1; }
  const reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);

  // Serviços
  const svc = {};
  for (const row of r.services) for (const s of safeParse(row.services, [])) { const k = SERVICES[s] || s; svc[k] ||= { total: 0, won: 0 }; svc[k].total++; if (row.stage === 'won') svc[k].won++; }
  const svcRows = Object.entries(svc).sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  // Equipa
  const people = {};
  const P = (id, name) => (people[id ?? 'none'] ||= { name: name || (id ? 'Utilizador removido' : 'Sem responsável'), open: 0, won: 0, lost: 0, wonVal: {}, openVal: {}, acts: 0, byType: {} });
  for (const x of r.byOwner) {
    const p = P(x.owner_id, x.owner_name);
    if (x.stage === 'won') { p.won += x.n; p.wonVal[x.currency] = (p.wonVal[x.currency] || 0) + x.total; }
    else if (x.stage === 'lost') p.lost += x.n;
    else { p.open += x.n; p.openVal[x.currency] = (p.openVal[x.currency] || 0) + x.total; }
  }
  for (const x of r.activitiesByUser) { if (!x.user_id) continue; const p = P(x.user_id, x.user_name); p.acts += x.n; p.byType[x.type] = (p.byType[x.type] || 0) + x.n; }
  const team = Object.entries(people).sort((a, b) => (a[0] === 'none') - (b[0] === 'none') || b[1].won - a[1].won || b[1].open - a[1].open);

  const maxR = Math.max(1, ...reasonRows.map((x) => x[1]));
  const maxS = Math.max(1, ...svcRows.map((x) => x[1].total));

  ctx.page.innerHTML = `
    <div data-prospector-mail></div>
    <section class="tiles">
      <div class="tile tc-green"><span class="label"><span class="ti">${icon('target')}</span>Taxa de ganho</span><span class="value">${winRate == null ? '—' : pct(winRate)}</span><span class="foot">${num(won)} ganhos · ${num(lost)} perdidos</span></div>
      <div class="tile tc-blue"><span class="label"><span class="ti">${icon('euro')}</span>Vendido</span><span class="value sm">${moneyMulti(wonVal)}</span><span class="foot">Ticket médio: ${moneyMulti(ticket, '—')}</span></div>
      <div class="tile tc-amber"><span class="label"><span class="ti">${icon('clock')}</span>Tempo até fechar</span><span class="value sm">${days(r.timeToClose.d)}</span><span class="foot">Média dos negócios ganhos</span></div>
      <div class="tile tc-ink"><span class="label"><span class="ti">${icon('zap')}</span>Tempo de resposta</span><span class="value sm">${days(r.firstResponse.d)}</span><span class="foot">${num(r.firstResponse.n)} de ${num(r.created)} leads contactados · até ao primeiro contacto</span></div>
      <div class="tile tc-green"><span class="label"><span class="ti">${icon('layers')}</span>Previsão ponderada</span><span class="value sm">${moneyMulti(weighted)}</span><span class="foot">${num(r.open.length)} negócios em aberto</span></div>
    </section>

    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Vendas ganhas por mês</h2><span class="muted">últimos 12 meses, em EUR</span></div><div class="chart" data-chart="won"></div></section>
      <section class="card"><div class="card-h"><h2>Previsão de fecho</h2><span class="muted">valor ponderado por mês previsto (EUR)</span></div><div class="chart" data-chart="forecast"></div>
        ${noDate || overdueForecast ? `<p class="faint" style="font-size:12.5px;margin:8px 0 0">${noDate ? `${money(noDate, 'EUR')} sem data de fecho prevista. ` : ''}${overdueForecast ? `<span class="overdue">${money(overdueForecast, 'EUR')} com fecho previsto já passado.</span>` : ''} Marque a data em cada lead para a previsão ficar certa.</p>` : ''}</section>
    </div>

    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Taxa de ganho por origem</h2><span class="muted">negócios fechados no período</span></div>
        ${won + lost ? `<div class="hbars">${SOURCES.map(([k, l]) => { const x = bySrc[k] || { won: 0, lost: 0 }; const t = x.won + x.lost; return `<div class="hbar" style="grid-template-columns:120px 1fr 110px"><span>${esc(l)}</span><span class="track"><span class="fill" style="width:${t ? (x.won / t) * 100 : 0}%;background:${SOURCE_COLOR[k]}"></span></span><span class="v">${t ? `<strong style="color:var(--ink)">${pct(x.won / t)}</strong> · ${x.won}/${t}` : '—'}</span></div>`; }).join('')}</div>` : emptyState('target', 'Ainda sem negócios fechados neste período.')}
      </section>
      <section class="card"><div class="card-h"><h2>Porque perdemos</h2><span class="muted">${num(lost)} negócio${lost === 1 ? '' : 's'} perdido${lost === 1 ? '' : 's'}</span></div>
        ${reasonRows.length ? `<div class="hbars">${reasonRows.map(([k, n]) => `<div class="hbar" style="grid-template-columns:minmax(0,170px) 1fr auto"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k)}">${esc(k)}</span><span class="track"><span class="fill" style="width:${(n / maxR) * 100}%;background:var(--s2)"></span></span><span class="v">${n} · ${pct(n / lost)}</span></div>`).join('')}</div>` : emptyState('check', 'Nenhum negócio perdido neste período.')}
      </section>
    </div>

    <div class="cols rev">
      <section class="card"><div class="card-h"><h2>Serviços mais pedidos</h2><span class="muted">leads do período</span></div>
        ${svcRows.length ? `<div class="hbars">${svcRows.map(([k, x]) => `<div class="hbar" style="grid-template-columns:minmax(0,110px) 1fr auto"><span>${esc(k)}</span><span class="track"><span class="fill" style="width:${(x.total / maxS) * 100}%"></span></span><span class="v">${x.total}${x.won ? ` · <span style="color:var(--ok)">${x.won} ganho${x.won > 1 ? 's' : ''}</span>` : ''}</span></div>`).join('')}</div>` : emptyState('layers', 'Sem dados de serviços no período.')}
      </section>
      <section class="card flush"><div class="card-h"><h2>Equipa</h2><span class="muted">negócios fechados e atividade no período; em aberto agora</span></div>
        ${team.length ? `<div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>Pessoa</th><th class="num">Em aberto</th><th class="num">Ganhos</th><th class="num">Perdidos</th><th class="num">Taxa</th><th class="num">Vendido</th><th class="num">Atividades</th></tr></thead><tbody>${team.map(([id, p]) => {
          const t = p.won + p.lost;
          const tip = Object.entries(p.byType).map(([k, n]) => `${(ACT[k] || [, k])[1]}: ${n}`).join(' · ');
          return `<tr><td><span class="who-line">${id === 'none' ? avatar(null, 'sm') : avatar(p.name, 'sm')}${esc(p.name)}</span></td><td class="num">${num(p.open)}${Object.keys(p.openVal).length ? `<div class="sub">${moneyMulti(p.openVal, '')}</div>` : ''}</td><td class="num">${num(p.won)}</td><td class="num">${num(p.lost)}</td><td class="num">${t ? pct(p.won / t) : '—'}</td><td class="num"><strong>${moneyMulti(p.wonVal, '—')}</strong></td><td class="num" title="${esc(tip)}">${id === 'none' ? '—' : num(p.acts)}</td></tr>`;
        }).join('')}</tbody></table></div>` : `<div style="padding:0 20px 20px">${emptyState('users', 'Sem dados ainda.')}</div>`}
      </section>
    </div>`;
  mountProspectorMail(ctx);

  // Vendas por mês (EUR)
  const months = [];
  const [y0, m0] = r.monthsFrom.split('-').map(Number);
  for (let i = 0; i < 12; i++) { const d = new Date(y0, m0 - 1 + i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const wdata = Object.fromEntries(months.map((m) => [m, {}]));
  for (const x of r.wonMonthly) if (x.currency === 'EUR' && wdata[x.m]) wdata[x.m].v = x.total;
  columns(ctx.page.querySelector('[data-chart="won"]'), {
    title: 'Vendas ganhas por mês', labels: months, data: wdata, series: [{ key: 'v', label: 'Vendido', color: 'var(--s3)' }],
    format: (v) => money(v, 'EUR'), axisFmt: (v) => money(v, 'EUR'), labelFmt: (l) => monthLabel(l), height: 200,
  });
  const fdata = Object.fromEntries(fMonths.map((m) => [m, { v: forecastByMonth[m] || 0 }]));
  columns(ctx.page.querySelector('[data-chart="forecast"]'), {
    title: 'Previsão de fecho por mês', labels: fMonths, data: fdata, series: [{ key: 'v', label: 'Previsto (ponderado)', color: 'var(--s1)' }],
    format: (v) => money(v, 'EUR'), axisFmt: (v) => money(v, 'EUR'), labelFmt: (l) => monthLabel(l), height: 200,
  });
}
