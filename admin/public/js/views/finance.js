// Financeiro: receitas, despesas, a receber, recorrente, categorias e gráfico mensal.
import {
  api, esc, icon, num, money, moneyMulti, date, todayStr, toCents, fromCents, modal, toast, fail, formData, confirmBox, columns, monthLabel,
  CURRENCIES,
} from '../lib.js';

const DEFAULT_CATS = {
  income: ['Projeto', 'Site', 'Manutenção', 'CRM', 'Agentes IA', 'Consultoria', 'Outros'],
  expense: ['Ferramentas e software', 'Domínios e alojamento', 'IA (OpenAI etc.)', 'Publicidade', 'Impostos', 'Contabilidade', 'Equipamento', 'Outros'],
};
const PERIODS = [['month', 'Este mês'], ['last', 'Mês passado'], ['year', 'Este ano'], ['12m', '12 meses'], ['all', 'Tudo']];

function periodRange(p) {
  const d = new Date();
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  if (p === 'month') return [`${ym(d.getFullYear(), d.getMonth())}-01`, '9999-12-31'];
  if (p === 'last') {
    const s = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const e = new Date(d.getFullYear(), d.getMonth(), 0);
    return [`${ym(s.getFullYear(), s.getMonth())}-01`, `${ym(e.getFullYear(), e.getMonth())}-${String(e.getDate()).padStart(2, '0')}`];
  }
  if (p === 'year') return [`${d.getFullYear()}-01-01`, '9999-12-31'];
  if (p === '12m') { const s = new Date(d.getFullYear(), d.getMonth() - 11, 1); return [`${ym(s.getFullYear(), s.getMonth())}-01`, '9999-12-31']; }
  return ['0000-01-01', '9999-12-31'];
}

let leadCache = null;
async function leadOptions() {
  if (!leadCache) leadCache = (await api('/leads?limit=2000')).leads;
  return leadCache;
}

/** Modal de receita/despesa. initial: { id?, kind, date, description, category, amount_cents, currency, status, recurring, lead_id } */
export async function txModal(initial = {}, onDone, categories = []) {
  const kind0 = initial.kind || 'income';
  const leads = await leadOptions().catch(() => []);
  const cats = (k) => [...new Set([...DEFAULT_CATS[k], ...categories])];
  modal({
    title: initial.id ? 'Editar lançamento' : kind0 === 'income' ? 'Nova receita' : 'Nova despesa',
    submit: initial.id ? 'Guardar' : 'Adicionar',
    body: `
      <div class="seg" role="group" aria-label="Tipo"><button type="button" data-kind="income" aria-pressed="${kind0 === 'income'}">Receita</button><button type="button" data-kind="expense" aria-pressed="${kind0 === 'expense'}">Despesa</button></div>
      <input type="hidden" name="kind" value="${kind0}">
      <div class="grid2">
        <label class="field"><span>Valor</span><input class="input" name="amount" inputmode="decimal" required placeholder="0,00" value="${esc(fromCents(initial.amount_cents))}"></label>
        <label class="field"><span>Moeda</span><select class="input" name="currency">${CURRENCIES.map((c) => `<option${c === (initial.currency || 'EUR') ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field"><span>Data</span><input class="input" type="date" name="date" required value="${esc(initial.date || todayStr())}"></label>
        <label class="field"><span>Estado</span><select class="input" name="status"><option value="paid"${initial.status !== 'pending' ? ' selected' : ''}>Pago / recebido</option><option value="pending"${initial.status === 'pending' ? ' selected' : ''}>Pendente</option></select></label>
      </div>
      <label class="field"><span>Descrição</span><input class="input" name="description" maxlength="400" value="${esc(initial.description || '')}" placeholder="Ex.: Site da Clínica Sorriso"></label>
      <label class="field"><span>Categoria</span><input class="input" name="category" list="tx-cats" maxlength="60" value="${esc(initial.category || (kind0 === 'income' ? 'Projeto' : ''))}" placeholder="Escolha ou escreva"><datalist id="tx-cats">${cats(kind0).map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Cliente / lead <span class="faint">(opcional)</span></span><select class="input" name="lead_id"><option value="">—</option>${leads.map((l) => `<option value="${l.id}"${Number(initial.lead_id) === l.id ? ' selected' : ''}>${esc(l.name || l.email || 'Lead #' + l.id)}${l.business ? ' — ' + esc(l.business) : ''}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="recurring"${initial.recurring ? ' checked' : ''}> Recorrente (todos os meses)</label>`,
    onOpen: (form) => {
      form.querySelectorAll('[data-kind]').forEach((b) =>
        b.addEventListener('click', () => {
          form.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          form.kind.value = b.dataset.kind;
          form.querySelector('#tx-cats').innerHTML = cats(b.dataset.kind).map((c) => `<option value="${esc(c)}">`).join('');
          form.closest('dialog').querySelector('.modal-h h2').textContent = initial.id ? 'Editar lançamento' : b.dataset.kind === 'income' ? 'Nova receita' : 'Nova despesa';
        }),
      );
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const cents = toCents(d.amount);
      if (!(cents > 0)) throw new Error('Escreva um valor maior que zero.');
      const body = { kind: d.kind, date: d.date, description: d.description, category: d.category || 'Outros', amount_cents: cents, currency: d.currency, status: d.status, recurring: !!d.recurring, lead_id: d.lead_id || null };
      if (initial.id) await api(`/transactions/${initial.id}`, { method: 'PATCH', body });
      else await api('/transactions', { method: 'POST', body });
      toast(initial.id ? 'Lançamento atualizado' : body.kind === 'income' ? 'Receita adicionada' : 'Despesa adicionada');
      onDone?.();
    },
  });
}

function sums(list, filter) {
  const o = {};
  for (const t of list) if (filter(t)) o[t.currency] = (o[t.currency] || 0) + t.amount_cents;
  return o;
}

export async function render(ctx) {
  ctx.setTitle('Financeiro', 'Receitas, despesas e o que falta receber');
  const actions = ctx.setActions(`<a class="btn" href="/api/export/transactions.csv" download>${icon('download')}<span class="lbl">CSV</span></a><button class="btn" data-add="expense">${icon('plus')}<span class="lbl">Despesa</span></button><button class="btn primary" data-add="income">${icon('plus')}<span class="lbl">Receita</span></button>`);
  leadCache = null;
  const { transactions: all, categories } = await api('/transactions');
  if (ctx.stale()) return;
  actions.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => txModal({ kind: b.dataset.add }, ctx.refresh, categories)));

  let period = (() => { try { return localStorage.getItem('phs-fin') || 'month'; } catch { return 'month'; } })();
  const f = { kind: '', status: '', q: '' };

  ctx.page.innerHTML = `
    <div class="toolbar"><div class="seg" role="group" aria-label="Período">${PERIODS.map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div></div>
    <section class="tiles" data-tiles></section>
    <div class="cols">
      <section class="card"><div class="card-h"><h2>Por mês</h2><span class="muted">pago, últimos 12 meses</span></div><div class="chart" data-chart></div></section>
      <section class="card"><div class="card-h"><h2>Para onde vai o dinheiro</h2><span class="muted">despesas no período</span></div><div data-cats></div>
        <div class="card-h" style="margin-top:18px"><h2>De onde vem</h2><span class="muted">receitas no período</span></div><div data-cats-in></div></section>
    </div>
    <section class="card">
      <div class="card-h"><h2>Lançamentos</h2>
        <div class="end toolbar">
          <input class="input" type="search" placeholder="Procurar…" data-f="q" aria-label="Procurar" style="min-width:160px">
          <select class="input" data-f="kind" aria-label="Tipo"><option value="">Receitas e despesas</option><option value="income">Só receitas</option><option value="expense">Só despesas</option></select>
          <select class="input" data-f="status" aria-label="Estado"><option value="">Qualquer estado</option><option value="paid">Pagos</option><option value="pending">Pendentes</option></select>
        </div>
      </div>
      <div class="table-wrap" data-table></div>
    </section>`;

  // Gráfico mensal (independente do período)
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const curCount = {};
  for (const t of all) curCount[t.currency] = (curCount[t.currency] || 0) + 1;
  const cur = curCount.EUR || !all.length ? 'EUR' : Object.entries(curCount).sort((a, b) => b[1] - a[1])[0][0];
  const mdata = Object.fromEntries(months.map((m) => [m, {}]));
  for (const t of all) {
    const m = t.date.slice(0, 7);
    if (t.status === 'paid' && t.currency === cur && mdata[m]) mdata[m][t.kind] = (mdata[m][t.kind] || 0) + t.amount_cents;
  }
  for (const m of months) if (mdata[m].income || mdata[m].expense) mdata[m].profit = (mdata[m].income || 0) - (mdata[m].expense || 0);
  columns(ctx.page.querySelector('[data-chart]'), {
    title: 'Receita e despesas por mês',
    labels: months,
    data: mdata,
    mode: 'group',
    series: [{ key: 'income', label: 'Receita', color: 'var(--s1)' }, { key: 'expense', label: 'Despesas', color: 'var(--s2)' }],
    format: (v) => money(v, cur),
    axisFmt: (v) => money(v, cur),
    labelFmt: (l) => monthLabel(l),
  });

  const tilesEl = ctx.page.querySelector('[data-tiles]');
  const tableEl = ctx.page.querySelector('[data-table]');

  const draw = () => {
    const [from, to] = periodRange(period);
    const inP = all.filter((t) => t.date >= from && t.date <= to);
    const income = sums(inP, (t) => t.kind === 'income' && t.status === 'paid');
    const expense = sums(inP, (t) => t.kind === 'expense' && t.status === 'paid');
    const profit = {};
    for (const c of new Set([...Object.keys(income), ...Object.keys(expense)])) profit[c] = (income[c] || 0) - (expense[c] || 0);
    const receivable = sums(all, (t) => t.kind === 'income' && t.status === 'pending');
    const payable = sums(all, (t) => t.kind === 'expense' && t.status === 'pending');
    const since = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
    const mrr = sums(all, (t) => t.kind === 'income' && t.recurring && t.date >= since);
    const nIncome = inP.filter((t) => t.kind === 'income' && t.status === 'paid').length;
    const ticket = {};
    for (const [c, v] of Object.entries(income)) ticket[c] = Math.round(v / Math.max(1, inP.filter((t) => t.kind === 'income' && t.status === 'paid' && t.currency === c).length));
    tilesEl.innerHTML = [
      ['Receita recebida', moneyMulti(income), `${num(nIncome)} recebimento${nIncome === 1 ? '' : 's'}`],
      ['Despesas pagas', moneyMulti(expense), ''],
      ['Lucro', moneyMulti(profit), Object.values(profit).some((v) => v < 0) ? '<span class="overdue">Negativo no período</span>' : ''],
      ['A receber', moneyMulti(receivable), 'Todas as receitas pendentes'],
      ['A pagar', moneyMulti(payable), 'Todas as despesas pendentes'],
      ['Recorrente mensal', moneyMulti(mrr), 'Receitas marcadas como recorrentes'],
      ['Ticket médio', moneyMulti(ticket), 'Por recebimento no período'],
    ].map(([l, v, f2]) => `<div class="tile"><span class="label">${l}</span><span class="value sm">${v}</span>${f2 ? `<span class="foot">${f2}</span>` : ''}</div>`).join('');

    catBars(ctx.page.querySelector('[data-cats]'), inP.filter((t) => t.kind === 'expense' && t.status === 'paid'), 'var(--s2)', 'Sem despesas pagas no período.');
    catBars(ctx.page.querySelector('[data-cats-in]'), inP.filter((t) => t.kind === 'income' && t.status === 'paid'), 'var(--s1)', 'Sem receitas recebidas no período.');

    const q = f.q.toLowerCase();
    const rows = inP.filter((t) => (!f.kind || t.kind === f.kind) && (!f.status || t.status === f.status) && (!q || [t.description, t.category, t.lead_name, t.lead_business].some((v) => (v || '').toLowerCase().includes(q))));
    tableEl.innerHTML = rows.length
      ? `<table class="t"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Cliente</th><th>Estado</th><th class="num">Valor</th><th></th></tr></thead><tbody>${rows
          .map((t) => `<tr>
            <td class="nowrap">${date(t.date)}</td>
            <td class="strong">${esc(t.description || '—')}${t.recurring ? ' <span class="badge" title="Recorrente">↻ mensal</span>' : ''}</td>
            <td class="muted">${esc(t.category)}</td>
            <td>${t.lead_id ? `<a href="#/leads/${t.lead_id}">${esc(t.lead_name || t.lead_business || 'Lead')}</a>` : '<span class="faint">—</span>'}</td>
            <td>${t.status === 'paid' ? `<span class="badge won">${t.kind === 'income' ? 'Recebido' : 'Pago'}</span>` : `<button class="btn sm" data-pay="${t.id}" title="Marcar como ${t.kind === 'income' ? 'recebido' : 'pago'}">${t.kind === 'income' ? 'A receber' : 'A pagar'} · ${icon('check')}</button>`}</td>
            <td class="num" style="color:${t.kind === 'expense' ? 'var(--danger)' : 'inherit'}">${t.kind === 'expense' ? '−' : '+'}${money(t.amount_cents, t.currency, { exact: true })}</td>
            <td class="nowrap right">${t.recurring ? `<button class="btn ghost sm" data-repeat="${t.id}" title="Lançar no próximo mês">↻</button>` : ''}<button class="btn ghost sm" data-edit="${t.id}" aria-label="Editar">${icon('edit')}</button><button class="btn ghost sm" data-del="${t.id}" aria-label="Apagar">${icon('trash')}</button></td>
          </tr>`)
          .join('')}</tbody></table>`
      : `<div class="empty"><b>Sem lançamentos neste período.</b>Adicione receitas e despesas com os botões no topo. Ao marcar um lead como “Ganho”, o valor pode entrar aqui sozinho.</div>`;
  };
  draw();

  ctx.page.querySelectorAll('[data-period]').forEach((b) =>
    b.addEventListener('click', () => {
      period = b.dataset.period;
      try { localStorage.setItem('phs-fin', period); } catch { /* */ }
      ctx.page.querySelectorAll('[data-period]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    }),
  );
  ctx.page.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => { f[el.dataset.f] = el.value; draw(); }));
  tableEl.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = Number(b.dataset.pay || b.dataset.edit || b.dataset.del || b.dataset.repeat);
    const t = all.find((x) => x.id === id);
    if (!t) return;
    try {
      if (b.dataset.pay) { await api(`/transactions/${id}`, { method: 'PATCH', body: { status: 'paid' } }); toast(t.kind === 'income' ? 'Marcado como recebido' : 'Marcado como pago'); ctx.refresh(); }
      else if (b.dataset.edit) txModal(t, ctx.refresh, categories);
      else if (b.dataset.repeat) {
        const d = new Date(t.date + 'T12:00:00'); d.setMonth(d.getMonth() + 1);
        txModal({ ...t, id: undefined, date: d.toISOString().slice(0, 10), status: 'pending' }, ctx.refresh, categories);
      } else if (b.dataset.del) {
        if (!(await confirmBox('Apagar lançamento', `Apagar “${esc(t.description || t.category)}” (${money(t.amount_cents, t.currency)})?`, 'Apagar'))) return;
        await api(`/transactions/${id}`, { method: 'DELETE' }); toast('Apagado'); ctx.refresh();
      }
    } catch (err) { fail(err); }
  });
}

function catBars(el, list, color, emptyMsg) {
  const by = {};
  const cur = list.some((t) => t.currency === 'EUR') ? 'EUR' : list[0]?.currency || 'EUR';
  for (const t of list) if (t.currency === cur) by[t.category] = (by[t.category] || 0) + t.amount_cents;
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!rows.length) { el.innerHTML = `<p class="muted" style="margin:0">${emptyMsg}</p>`; return; }
  const max = rows[0][1];
  el.innerHTML = `<div class="hbars">${rows.map(([c, v]) => `<div class="hbar"><span class="clip" title="${esc(c)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c)}</span><span class="track"><span class="fill" style="width:${(v / max) * 100}%;background:${color}"></span></span><span class="v">${money(v, cur)}</span></div>`).join('')}</div>`;
}
