import { api, columns, dayLabel, icon, num } from '../lib.js';

const periods = [7, 30, 90];
const series = [
  { key: 'first', label: 'Primeiro contato', color: 'var(--s1)' },
  { key: 'followup', label: 'Acompanhamento', color: 'var(--s2)' },
  { key: 'other', label: 'Outros envios', color: 'var(--s3)' },
];
const dateBrt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const brtDay = (date) => new Date(date - 3 * 3600_000).toISOString().slice(0, 10);
const messageCount = (row) => row.first + row.followup + row.other;

function interval(snapshot, days) {
  const end = Date.parse(brtDay(Date.parse(snapshot.capturedAt)));
  const map = new Map(snapshot.daily.map((row) => [row.day, row]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - i - 1) * 86_400_000).toISOString().slice(0, 10);
    return map.get(day) || { day, first: 0, followup: 0, other: 0 };
  });
}

function csv(rows) {
  const lines = [
    'data_brasilia,primeiro_contato,acompanhamento,outros,total',
    ...rows.map((r) => [r.day, r.first, r.followup, r.other, messageCount(r)].join(',')),
  ];
  const url = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'prospector-envios-' + rows.at(-1).day + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function mountProspectorMail(ctx) {
  const root = ctx.page.querySelector('[data-prospector-mail]');
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = '<section class="card"><div class="card-h"><h2>Envios reais do Prospector</h2></div><p class="muted" role="status">Carregando os envios…</p></section>';
  let snapshot;
  try {
    ({ snapshot } = await api('/prospector-mail'));
  } catch {
    if (ctx.stale() || !root.isConnected) return;
    root.setAttribute('aria-busy', 'false');
    root.querySelector('[role="status"]').textContent = 'Não consegui carregar os envios. Atualize a página para tentar novamente.';
    return;
  }
  if (ctx.stale() || !root.isConnected) return;
  root.setAttribute('aria-busy', 'false');
  if (!snapshot) {
    root.querySelector('[role="status"]').textContent = 'Aguardando a primeira sincronização do banco do Prospector.';
    return;
  }

  const captured = Date.parse(snapshot.capturedAt);
  const fresh = Date.now() - captured < 30 * 60_000;
  const sameDay = brtDay(captured) === brtDay(Date.now());
  const today = sameDay ? num(messageCount(interval(snapshot, 1)[0])) : '—';
  const tile = (label, value, foot) => `<div class="tile"><span class="label">${label}</span><span class="value">${value}</span><span class="foot">${foot}</span></div>`;
  root.innerHTML = `
    <section class="card">
      <div class="card-h"><h2>Envios reais do Prospector</h2>
        <span class="badge ${fresh ? 'won' : 'pending'}">${fresh ? 'Sincronizado' : 'Dados podem estar defasados'}</span>
        <button type="button" class="end btn sm" data-mail-csv>${icon('download')}<span>CSV do período</span></button>
      </div>
      <p class="muted">Leitura do servidor em ${dateBrt.format(captured)} (Brasília)${snapshot.lastSent ? ' · Último envio ' + dateBrt.format(new Date(snapshot.lastSent)) : ''}.</p>
      <div class="tiles" data-mail-tiles></div>
      <div class="toolbar" style="margin-top:14px">
        <div class="seg" role="group" aria-label="Período dos envios">
          ${periods.map((n) => `<button type="button" data-mail-days="${n}" aria-pressed="false">${n} dias</button>`).join('')}
        </div>
      </div>
      <div class="chart" data-mail-chart></div>
      <p class="faint" style="margin:8px 0 0">Contagem de mensagens registradas como enviadas pelo Prospector. Ensaios, falhas e envios incertos ficam fora. Entrega e abertura são métricas diferentes.</p>
    </section>`;
  let rows;
  const buttons = [...root.querySelectorAll('[data-mail-days]')];
  function draw(days) {
    rows = interval(snapshot, days);
    const periodTotal = rows.reduce((sum, row) => sum + messageCount(row), 0);
    const first = rows.reduce((sum, row) => sum + row.first, 0);
    const followup = rows.reduce((sum, row) => sum + row.followup, 0);
    root.querySelector('[data-mail-tiles]').innerHTML =
      tile('Hoje', today, sameDay ? 'até a última sincronização' : 'aguardando dados de hoje')
      + tile('No período', num(periodTotal), num(first) + ' primeiros contatos · ' + num(followup) + ' acompanhamentos')
      + tile('Total histórico', num(snapshot.total), 'desde o primeiro registro no servidor');
    for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.mailDays) === days));
    columns(root.querySelector('[data-mail-chart]'), {
      title: 'Envios reais por dia (Brasília)', labels: rows.map((r) => r.day),
      data: Object.fromEntries(rows.map((r) => [r.day, r])), series, mode: 'stack', labelFmt: dayLabel,
    });
  }
  for (const b of buttons) b.addEventListener('click', () => draw(Number(b.dataset.mailDays)));
  root.querySelector('[data-mail-csv]').addEventListener('click', () => csv(rows));
  draw(30);
}
