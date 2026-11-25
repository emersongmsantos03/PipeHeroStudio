import { api, copy, esc, num } from '../lib.js';

const offers = {
  P2: { label: 'Site para estética', path: '/en/', anchor: 'plans', campaign: 'detailing-website' },
  P3: { label: 'Ava para estética', path: '/en/demo/', anchor: 'ava', campaign: 'detailing-ava' },
};
const signals = {
  ava: { label: 'Site próprio com formulário de orçamento', next: 'Mostre a Ava coletando dados e fotos no chat.' },
  mobile: { label: 'Configuração móvel ausente na página analisada', next: 'Mostre como um cliente pediria orçamento pelo celular.' },
  form: { label: 'Formulário identificado', next: 'Mostre como o pedido pode virar uma tarefa de retorno.' },
  review: { label: 'Conferência manual', next: 'Confirme o sinal no site antes de usar o rascunho.' },
};
const brt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const state = { filter: '' };

function demoUrl(offer, channel) {
  const url = new URL(offer.path, 'https://pipeherostudio.digital');
  url.hash = offer.anchor;
  if (channel) {
    url.searchParams.set('utm_source', channel === 'email' ? 'prospector' : 'pipehero');
    url.searchParams.set('utm_medium', channel);
    url.searchParams.set('utm_campaign', offer.campaign);
  }
  return url.href;
}

export async function mountReviewQueue(ctx) {
  const root = ctx.page.querySelector('[data-prospector-review]');
  root.innerHTML = '<section class="card"><div class="card-h"><h2>Oportunidades para revisar</h2></div><p class="muted" role="status">Carregando a fila…</p></section>';
  let snapshot;
  try {
    ({ snapshot } = await api('/prospector-review'));
  } catch {
    if (!ctx.stale() && root.isConnected) root.querySelector('[role="status"]').textContent = 'Fila indisponível. Atualize a página para tentar novamente.';
    return;
  }
  if (ctx.stale() || !root.isConnected) return;
  if (!snapshot) {
    root.querySelector('[role="status"]').textContent = 'Aguardando a primeira seleção do Prospector.';
    return;
  }

  const filters = [['', 'Todas'], ...Object.entries(offers).map(([key, offer]) => [key, offer.label])];
  root.innerHTML = `<section class="card">
    <div class="card-h"><h2>Oportunidades para revisar</h2><span class="badge">${num(snapshot.rows.length)}</span></div>
    <p class="muted">Os contatos desta fila vêm do site da empresa. Revise o rascunho antes de enviar. Última seleção em ${brt.format(new Date(snapshot.capturedAt))}. <a href="#/traffic">Ver resultados das campanhas</a></p>
    <details>
      <summary>Demonstrações para compartilhar</summary>
      <p class="muted">Use o link de e-mail ao responder a quem pediu detalhes. Use o link orgânico em posts e perfis.</p>
      ${Object.entries(offers).map(([product, offer]) => `<p><a href="${demoUrl(offer)}" target="_blank" rel="noopener noreferrer">${offer.label}</a>
        <button type="button" class="btn sm" data-demo-copy="${product}" data-demo-channel="email">Copiar link de e-mail</button>
        <button type="button" class="btn sm" data-demo-copy="${product}" data-demo-channel="organic">Copiar link orgânico</button></p>`).join('')}
    </details>
    <div class="toolbar"><div class="seg" role="group" aria-label="Oferta da oportunidade">
      ${filters.map(([key, label]) => `<button type="button" data-review-filter="${key}" aria-pressed="false">${label}</button>`).join('')}
    </div></div>
    <div class="table-wrap" data-review-rows></div>
  </section>`;
  const panel = root.querySelector('[data-review-rows]');
  const buttons = [...root.querySelectorAll('[data-review-filter]')];

  function draw() {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.reviewFilter === state.filter));
    const rows = snapshot.rows.filter((r) => !state.filter || r.product === state.filter);
    panel.innerHTML = rows.length ? `<table class="t">
      <thead><tr><th>Empresa</th><th>Oferta</th><th>Evidência do site</th><th>Rascunho</th></tr></thead>
      <tbody>${rows.map((r) => {
        const offer = offers[r.product];
        const signal = signals[r.evidenceCode] || signals.review;
        return `<tr>
          <td><strong>${esc(r.company || 'Empresa')}</strong><br><span class="muted">${esc(r.city)}</span><br>
            <a href="${esc(r.website)}" target="_blank" rel="noopener noreferrer">Conferir site</a></td>
          <td>${offer.label}<br><span class="badge">Nota ${num(r.score)}</span><br>
            <a href="${demoUrl(offer)}" target="_blank" rel="noopener noreferrer">Ver demonstração</a></td>
          <td><strong>${signal.label}</strong><br>${esc(r.evidence)}<br><span class="muted">${signal.next}</span></td>
          <td><details><summary>Ver rascunho</summary>
            <p><strong>Para</strong> ${esc(r.email)}<br><strong>Assunto</strong> ${esc(r.subject)}</p>
            <p style="white-space:pre-wrap">${esc(r.draft)}</p>
            <button type="button" class="btn sm" data-review-copy="${r.id}">Copiar rascunho</button>
          </details></td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '<p class="muted">Nenhuma oportunidade passou nos critérios desta oferta.</p>';
  }

  for (const button of buttons) button.addEventListener('click', () => { state.filter = button.dataset.reviewFilter; draw(); });
  root.addEventListener('click', (event) => {
    const demo = event.target.closest('[data-demo-copy]');
    if (demo) {
      void copy(demoUrl(offers[demo.dataset.demoCopy], demo.dataset.demoChannel));
      return;
    }
    const id = event.target.closest('[data-review-copy]')?.dataset.reviewCopy;
    if (!id) return;
    const row = snapshot.rows.find((r) => String(r.id) === id);
    if (row) void copy('Subject: ' + row.subject + '\n\n' + row.draft);
  });
  draw();
}
