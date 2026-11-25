import { api, esc, icon, num, stageTag } from '../lib.js';

const cards = [
  ['visits', 'Visitas à demo', 'globe'],
  ['starts', 'Conversas iniciadas', 'bot'],
  ['photos', 'Fotos analisadas', 'target'],
  ['quotes', 'Orçamentos de teste', 'list'],
  ['owner_replies', 'Respostas no painel-demo', 'board'],
  ['requests', 'Pedidos comerciais no CRM', 'users'],
];

export async function render(ctx) {
  ctx.setTitle('Estética automotiva', 'Acompanhe a demo da Ava, os pedidos comerciais e a lista de prospecção.');
  const { metrics, leads, regions, today } = await api('/detailing');
  if (ctx.stale()) return;
  ctx.page.innerHTML = `
    <section class="ig-hero">
      <div class="ig-identity"><span class="ig-avatar">${icon('bot')}</span><div>
        <h2>Northline Detailing</h2><p>Demo em inglês · Métricas dos últimos 30 dias</p>
      </div></div>
      <a class="btn ig-profile-link" href="https://pipeherostudio.digital/en/demo/" target="_blank" rel="noopener">Abrir demo ${icon('ext')}</a>
    </section>
    <section class="card ig-traffic-link">
      <div><h2>Funil por campanha</h2><p class="muted">Acompanhe os envios aceitos, os testes da Ava e os pedidos que viraram reuniões ou vendas.</p></div>
      <a class="btn" href="#/traffic">Ver campanhas ${icon('right')}</a>
    </section>
    <div class="tiles">${cards.map(([key,label,glyph]) => `<article class="tile ig-metric">
      <span class="ig-symbol">${icon(glyph)}</span><h3 class="label">${label}</h3><strong class="value">${num(metrics[key])}</strong>
    </article>`).join('')}</div>
    <section class="card" style="margin-top:16px;padding:18px">
      <h2>Atendimento da Ava</h2>
      <p>${num(today)} chamadas hoje (UTC) · ${num(metrics.customer_replies)} respostas a visitantes · ${num(metrics.errors)} falhas nos últimos 30 dias</p>
    </section>
    <section class="card" style="margin-top:16px;padding:18px">
      <h2>Pedidos comerciais recentes</h2>
      ${leads.length ? `<ul>${leads.map((lead) => `<li><a href="#/leads/${Number(lead.id)}">${esc(lead.business || 'Estúdio')}</a> · ${esc(lead.country || '—')} ${stageTag(lead.stage)}</li>`).join('')}</ul>` : '<p class="muted">Quando chegar um pedido comercial pelo formulário, ele aparece aqui.</p>'}
    </section>
    <section class="card" style="margin-top:16px;padding:18px">
      <h2>Prospecção por país</h2>
      ${regions.length ? `<ul>${regions.map((row) => `<li><strong>${esc(row.country || 'Sem país')}</strong> · ${num(row.prospects)} negócios · ${num(row.scored)} com nota 6 ou mais e sem bloqueio de contato</li>`).join('')}</ul>` : '<p class="muted">Os negócios de estética automotiva aparecem aqui depois da sincronização do Prospector.</p>'}
      <a class="btn" href="#/prospects">Abrir prospecção</a>
    </section>`;
}
