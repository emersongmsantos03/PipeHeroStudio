// Prospecção: todos os negócios que o prospector encontrou, com o estado de cada um, e-mails enviados e "não contatar".
import { api, esc, num, date, dateTime, icon, toast, modal } from '../lib.js';

const STATUS = [
  ['', 'Todos'], ['qualificado', 'Na fila'], ['contatado', 'Contatados'], ['respondeu', 'Responderam'], ['interessado', 'Interessados'],
  ['encontrado', 'Em análise'], ['descartado', 'Descartados'], ['devolvido', 'E-mail inválido'], ['dnc', 'Não contatar'],
];
const LABEL = { encontrado: 'Em análise', qualificado: 'Na fila', contatado: 'Contatado', respondeu: 'Respondeu', interessado: 'Interessado',
  descartado: 'Descartado', nao_contactar: 'Não contatar', devolvido: 'E-mail inválido' };
const BADGE = { contatado: 'contacted', respondeu: 'meeting', interessado: 'won', nao_contactar: 'lost', devolvido: 'lost', descartado: '', qualificado: 'new', encontrado: '' };
const DNC_TXT = { unsubscribe: 'pediu para sair', not_interested: 'sem interesse', spam_complaint: 'denúncia de spam', bounce: 'e-mail inválido', manual: 'marcado no painel' };
const PRODUTO = { P1: 'Website novo', P2: 'Renovar website', P3: 'Automação de CRM', P4: 'Agente de IA', P5: 'Automação', P6: 'IA', P7: 'Sistema' };

const st = { status: '', q: '', page: 1, sort: 'recent', email: false, clicked: false };

export async function render(ctx) {
  ctx.setTitle('Prospecção', 'Todos os negócios encontrados pelo prospector: fila, contatos, respostas e "não contatar"');
  ctx.setActions(`<a class="btn" href="/api/export/prospects.csv">${icon('download')}<span class="lbl">Exportar CSV</span></a>`);
  const qs = new URLSearchParams({ status: st.status, q: st.q, page: st.page, sort: st.sort, email: st.email ? '1' : '', clicked: st.clicked ? '1' : '' });
  const d = await api(`/prospects?${qs}`);
  if (ctx.stale()) return;
  const c = d.counts || {};
  const e = d.extra || {};
  const pages = Math.max(1, Math.ceil(d.total / 50));

  ctx.page.innerHTML = `
    <section class="tiles">
      <div class="tile"><span class="label">Negócios encontrados</span><span class="value">${num(e.total)}</span><span class="foot">${num(e.com_email)} com e-mail</span></div>
      <div class="tile"><span class="label">Na fila para enviar</span><span class="value">${num(c.qualificado)}</span><span class="foot">${num(c.encontrado)} ainda em análise</span></div>
      <div class="tile"><span class="label">Contatados</span><span class="value">${num((c.contatado || 0) + (c.respondeu || 0) + (c.interessado || 0))}</span><span class="foot">${num(e.emails)} e-mails no total · ${num(e.cliques)} cliques</span></div>
      <div class="tile"><span class="label">Responderam</span><span class="value">${num((c.respondeu || 0) + (c.interessado || 0))}</span><span class="foot">${num(c.interessado)} interessados</span></div>
      <div class="tile"><span class="label">Não contatar</span><span class="value">${num(d.dnc)}</span><span class="foot">saíram, inválidos ou marcados</span></div>
    </section>
    <section class="card">
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <div class="seg" role="group" aria-label="Estado">${STATUS.map(([k, l]) => `<button type="button" data-st="${k}" aria-pressed="${st.status === k}">${l}</button>`).join('')}</div>
        <input class="input" data-q type="search" placeholder="Procurar nome, e-mail, cidade, tipo…" value="${esc(st.q)}" style="min-width:220px;flex:1">
        <label class="check"><input type="checkbox" data-email ${st.email ? 'checked' : ''}> só com e-mail</label>
        <label class="check"><input type="checkbox" data-clicked ${st.clicked ? 'checked' : ''}> só quem clicou</label>
        <select class="input" data-sort aria-label="Ordenar"><option value="recent">Mais recentes</option><option value="email">Último e-mail</option><option value="score">Nota</option><option value="name">Nome</option></select>
      </div>
      <div class="table-wrap">${d.rows.length ? `<table class="t"><thead><tr><th>Negócio</th><th>Local</th><th>E-mail</th><th>Produto</th><th>Estado</th><th>E-mails</th><th></th></tr></thead><tbody>${d.rows.map(row).join('')}</tbody></table>`
        : '<div class="empty"><b>Nada por aqui.</b>Os negócios aparecem quando o prospector sincroniza (a cada poucos minutos).</div>'}</div>
      <div class="toolbar" style="justify-content:space-between;margin-top:10px"><span class="muted">${num(d.total)} resultado(s) · página ${d.page} de ${pages}</span>
        <span><button class="btn sm" data-prev ${d.page <= 1 ? 'disabled' : ''}>Anterior</button> <button class="btn sm" data-next ${d.page >= pages ? 'disabled' : ''}>Seguinte</button></span></div>
    </section>`;

  const P = ctx.page;
  P.querySelector('[data-sort]').value = st.sort;
  P.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.st; st.page = 1; ctx.refresh(); }));
  let t;
  P.querySelector('[data-q]').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { st.q = ev.target.value; st.page = 1; ctx.refresh(); }, 350); });
  P.querySelector('[data-email]').addEventListener('change', (ev) => { st.email = ev.target.checked; st.page = 1; ctx.refresh(); });
  P.querySelector('[data-clicked]').addEventListener('change', (ev) => { st.clicked = ev.target.checked; st.page = 1; ctx.refresh(); });
  P.querySelector('[data-sort]').addEventListener('change', (ev) => { st.sort = ev.target.value; ctx.refresh(); });
  P.querySelector('[data-prev]').addEventListener('click', () => { st.page--; ctx.refresh(); });
  P.querySelector('[data-next]').addEventListener('click', () => { st.page++; ctx.refresh(); });

  P.querySelectorAll('[data-dnc]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.dnc;
    modal({
      title: 'Não contatar este negócio',
      body: '<label class="field"><span>Motivo (opcional)</span><input class="input" name="reason" maxlength="300" placeholder="Ex.: já é cliente, pediu por telefone…"></label><p class="muted" style="margin:6px 0 0">O prospector para de enviar e-mails para este endereço (inclusive follow-ups).</p>',
      submit: 'Marcar como não contatar', danger: true,
      onSubmit: async (f) => { await api(`/prospects/${id}`, { method: 'PATCH', body: { do_not_contact: true, reason: f.elements.reason.value } }); toast('Marcado: não contatar'); ctx.refresh(); },
    });
  }));
  P.querySelectorAll('[data-undnc]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/prospects/${b.dataset.undnc}`, { method: 'PATCH', body: { do_not_contact: false } }); toast('Pode voltar a ser contatado'); ctx.refresh(); }
    catch (err) { toast(err.message, true); }
  }));
  P.querySelectorAll('[data-crm]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api(`/prospects/${b.dataset.crm}/to-crm`, { method: 'POST', body: {} }); location.hash = `#/leads/${r.lead_id}`; }
    catch (err) { toast(err.message, true); }
  }));
}

function row(p) {
  const dnc = p.do_not_contact ? `<span class="badge lost" title="${esc(p.dnc_reason || '')}">Não contatar · ${esc(DNC_TXT[p.dnc_source] || p.dnc_source || '')}</span>` : '';
  const travado = p.do_not_contact && ['unsubscribe', 'not_interested', 'spam_complaint', 'bounce'].includes(p.dnc_source);
  const acao = p.do_not_contact
    ? (travado ? '<span class="faint" title="Pediu para sair ou e-mail inválido: não pode ser reativado">bloqueado</span>' : `<button class="btn sm" data-undnc="${p.id}">Reativar</button>`)
    : `<button class="btn sm" data-dnc="${p.id}" title="Parar de contatar">${icon('x')}<span class="lbl">Não contatar</span></button>`;
  const crm = p.crm_lead_id ? `<a class="btn sm" href="#/leads/${p.crm_lead_id}">Ver no CRM</a>` : `<button class="btn sm" data-crm="${p.id}">Enviar ao CRM</button>`;
  return `<tr>
    <td><strong>${esc(p.name || '—')}</strong><br><span class="faint">${esc(p.category || '')}${p.score != null ? ` · nota ${esc(p.score)}` : ''}</span>${p.website ? `<br><a class="faint" href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">${esc(p.website.replace(/^https?:\/\//, '').slice(0, 40))}</a>` : ''}</td>
    <td class="nowrap">${esc([p.city, p.country].filter(Boolean).join(' · ') || '—')}</td>
    <td class="clip">${p.email ? esc(p.email) : '<span class="faint">sem e-mail</span>'}${p.phone ? `<br><span class="faint">${esc(p.phone)}</span>` : ''}</td>
    <td>${esc(PRODUTO[p.product] || p.product || '—')}</td>
    <td>${dnc || `<span class="badge ${BADGE[p.status] || ''}">${esc(LABEL[p.status] || p.status || '—')}</span>`}${p.clicked ? ' <span class="badge won">clicou</span>' : ''}${p.reason && !p.do_not_contact && p.status === 'descartado' ? `<br><span class="faint" style="font-size:12px">${esc(p.reason).slice(0, 80)}</span>` : ''}</td>
    <td class="nowrap">${num(p.emails_sent || 0)}${p.last_email_at ? `<br><span class="faint" title="${esc(p.last_subject || '')}">${date(p.last_email_at)}</span>` : ''}${p.replied_at ? `<br><span class="faint">respondeu ${date(p.replied_at)}</span>` : ''}</td>
    <td class="nowrap" style="text-align:right">${acao} ${crm}</td>
  </tr>`;
}
