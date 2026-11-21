// Ava (assistente do site) e agentes externos: conversas, conversão, e-mails enviados e registo de envios.
import { api, esc, num, pct, dateTime, ago, buckets, columns, dayLabel, safeParse, qualTag, stageTag, EMAIL_SOURCE, icon } from '../lib.js';
import { getRange, setRange, rangeSeg } from './dashboard.js';

const EMAIL_SERIES = [
  { key: 'ava', label: 'Ava', color: 'var(--s1)' },
  { key: 'agent', label: 'Agente externo', color: 'var(--s2)' },
  { key: 'site', label: 'Formulário do site', color: 'var(--s3)' },
  { key: 'system', label: 'Painel (avisos)', color: 'var(--s4)' },
];
const AGENT_EVENTS = { email_sent: 'E-mails enviados', email_failed: 'E-mails falhados', email_opened: 'E-mails abertos', email_replied: 'E-mails respondidos', whatsapp_sent: 'WhatsApp enviados', call: 'Chamadas', meeting_booked: 'Reuniões marcadas', message: 'Mensagens', note: 'Notas', lead_created: 'Leads criados' };

export async function render(ctx) {
  const range = getRange();
  ctx.setTitle('Ava e agentes', 'Conversas, leads e e-mails enviados pelos seus agentes');
  if (ctx.state.user.role === 'admin') ctx.setActions(`<a class="btn" href="#/integrations">${icon('plug')}<span class="lbl">Ligar um agente</span></a>`);
  const a = await api(`/agent?range=${range}`);
  if (ctx.stale()) return;

  const em = {};
  for (const r of a.emailsBySource) { em[r.source] ||= { sent: 0, failed: 0 }; em[r.source][r.type === 'email_sent' ? 'sent' : 'failed'] += r.n; }
  const sentTotal = Object.values(em).reduce((s, x) => s + x.sent, 0);
  const failedTotal = Object.values(em).reduce((s, x) => s + x.failed, 0);
  const T = a.totals;

  ctx.page.innerHTML = `
    <div class="toolbar">${rangeSeg(range)}</div>
    <section class="tiles">
      <div class="tile"><span class="label">Conversas com a Ava</span><span class="value">${num(T.conversations)}</span><span class="foot">${num(T.messages)} mensagens · ${T.avgMessages.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} por conversa</span></div>
      <div class="tile"><span class="label">Leads gerados pela Ava</span><span class="value">${num(T.leads)}</span><span class="foot">Conversão: <strong>${pct(T.conversion)}</strong> das conversas</span></div>
      <div class="tile"><span class="label">E-mails enviados pela Ava</span><span class="value">${num(em.ava?.sent || 0)}</span><span class="foot">Resumos de leads para si</span></div>
      <div class="tile"><span class="label">E-mails do agente externo</span><span class="value">${num(em.agent?.sent || 0)}</span><span class="foot">Registados pela API</span></div>
      <div class="tile"><span class="label">Total de e-mails enviados</span><span class="value">${num(sentTotal)}</span><span class="foot">${failedTotal ? `<span class="overdue">${num(failedTotal)} falharam</span>` : 'Nenhuma falha'}</span></div>
    </section>

    <div class="cols even">
      <section class="card"><div class="card-h"><h2>Conversas da Ava</h2><span class="muted">por ${range === '365' || range === 'all' ? 'mês' : 'dia'}</span></div><div class="chart" data-chart="conv"></div></section>
      <section class="card"><div class="card-h"><h2>E-mails enviados</h2><span class="muted">por origem</span></div><div class="chart" data-chart="emails"></div></section>
    </div>

    <div class="cols">
      <section class="card"><div class="card-h"><h2>Leads da Ava</h2><span class="muted">no período</span><a class="end btn sm" href="#/leads?source=chat">Ver todos</a></div>
        ${a.chatLeads.length ? `<div class="list">${a.chatLeads.map((l) => `<a class="list-item" href="#/leads/${l.id}"><span class="li-main"><span class="li-title">${esc(l.name || 'Sem nome')}${l.business ? ` <span class="muted" style="font-weight:400">· ${esc(l.business)}</span>` : ''}</span><span class="li-sub">${esc(l.summary || '')}</span></span><span class="li-end">${ago(l.created_at)}${qualTag(l.qualification)}${stageTag(l.stage)}</span></a>`).join('')}</div>` : '<div class="empty"><b>Ainda sem leads da Ava neste período.</b>Quando um visitante aceitar enviar o resumo, o lead entra aqui e no CRM.</div>'}
      </section>
      <section class="card">
        <div class="card-h"><h2>Onde falam com a Ava</h2></div>
        ${a.pages.length ? `<div class="hbars">${(() => { const max = Math.max(...a.pages.map((p) => p.conversations)); return a.pages.map((p) => `<div class="hbar" style="grid-template-columns:minmax(0,1.4fr) 1fr auto"><span class="mono" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.page || '')}">${esc(p.page || '(desconhecida)')}</span><span class="track"><span class="fill" style="width:${(p.conversations / max) * 100}%"></span></span><span class="v">${num(p.conversations)}</span></div>`).join(''); })()}</div>` : '<p class="muted" style="margin:0">Sem conversas no período.</p>'}
        <div class="card-h" style="margin-top:18px"><h2>Agente externo</h2><span class="muted">eventos pela API</span></div>
        ${a.agentEvents.length ? `<div class="list">${a.agentEvents.map((e) => `<div class="list-item" style="padding:6px 0"><span class="li-main">${esc(AGENT_EVENTS[e.type] || e.type)}</span><strong>${num(e.n)}</strong></div>`).join('')}</div>` : `<p class="muted" style="margin:0">Nenhum agente externo enviou dados ainda.${ctx.state.user.role === 'admin' ? ' <a href="#/integrations">Ver como ligar</a>.' : ''}</p>`}
      </section>
    </div>

    <section class="card">
      <div class="card-h"><h2>Registo de e-mails</h2><span class="muted">últimos 200 envios</span>
        <div class="end"><select class="input" data-src aria-label="Origem" style="min-width:180px"><option value="">Todas as origens</option>${EMAIL_SERIES.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}</select></div></div>
      <div class="table-wrap" data-log></div>
    </section>`;

  ctx.page.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); ctx.refresh(); }));

  const cb = buckets(a.from, a.daily.map((d) => ({ d: d.d, n: d.conversations })), () => 'c');
  columns(ctx.page.querySelector('[data-chart="conv"]'), { title: 'Conversas da Ava', labels: cb.labels, data: cb.data, series: [{ key: 'c', label: 'Conversas', color: 'var(--s1)' }], labelFmt: dayLabel });
  const eb = buckets(a.from, a.emailsDaily, (r) => r.source);
  const usedSeries = EMAIL_SERIES.filter((s) => a.emailsDaily.some((r) => r.source === s.key));
  columns(ctx.page.querySelector('[data-chart="emails"]'), { title: 'E-mails enviados', labels: eb.labels, data: eb.data, series: usedSeries.length ? usedSeries : EMAIL_SERIES.slice(0, 1), labelFmt: dayLabel });

  const logEl = ctx.page.querySelector('[data-log]');
  const drawLog = (src) => {
    const rows = a.recentEmails.filter((e) => !src || e.source === src);
    logEl.innerHTML = rows.length
      ? `<table class="t"><thead><tr><th>Quando</th><th>Origem</th><th>Para</th><th>Assunto</th><th>Lead</th><th>Estado</th></tr></thead><tbody>${rows
          .map((e) => {
            const m = safeParse(e.meta, {});
            return `<tr><td class="nowrap">${dateTime(e.created_at)}</td><td>${esc(EMAIL_SOURCE[e.source] || e.source)}${m.agent ? `<br><span class="faint">${esc(m.agent)}</span>` : ''}</td><td class="clip">${esc(e.ref || '—')}</td><td class="clip" title="${esc(m.subject || '')}">${esc(m.subject || '—')}</td><td>${e.lead_id ? `<a href="#/leads/${e.lead_id}">${esc(e.lead_name || 'Lead #' + e.lead_id)}</a>` : '<span class="faint">—</span>'}</td><td>${e.type === 'email_sent' ? '<span class="badge won">Enviado</span>' : `<span class="badge hot" title="${esc(m.error || '')}">Falhou</span>${m.error ? `<br><span class="faint" style="font-size:12px">${esc(m.error).slice(0, 120)}</span>` : ''}`}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : '<div class="empty"><b>Sem e-mails registados.</b>Os envios da Ava, do formulário e do agente externo aparecem aqui.</div>';
  };
  drawLog('');
  ctx.page.querySelector('[data-src]').addEventListener('change', (e) => drawLog(e.target.value));
}
