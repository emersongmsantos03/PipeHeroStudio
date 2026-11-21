// Ficha do lead: dados, etapa, próxima ação, notas/contactos, conversa da Ava e pagamentos.
import {
  api, esc, icon, money, date, dateTime, ago, todayStr, addDays, toCents, fromCents, modal, toast, fail, formData, confirmBox, safeParse,
  STAGES, SOURCE, QUAL, CURRENCIES, EMAIL_SOURCE, srcTag, qualTag, services,
} from '../lib.js';
import { changeStage, SERVICE_OPTIONS } from './crm.js';
import { txModal } from './finance.js';

const ACT = {
  created: ['spark', 'Lead criado'], note: ['note', 'Nota'], call: ['phone', 'Ligação'], email: ['mail', 'E-mail'], whatsapp: ['whatsapp', 'WhatsApp'],
  meeting: ['calendar', 'Reunião'], stage: ['flag', 'Etapa'], update: ['edit', 'Atualização'], system: ['bot', 'Sistema'],
};
const FIELDS = [
  ['name', 'Nome'], ['business', 'Negócio'], ['business_type', 'Tipo de negócio'], ['email', 'E-mail'], ['phone', 'Telefone / WhatsApp'],
  ['preferred_contact', 'Contacto preferido'], ['country', 'País'], ['location', 'Local'], ['language', 'Idioma'], ['needs', 'O que precisa'],
  ['current_situation', 'Situação atual'], ['timeline', 'Prazo'], ['budget', 'Orçamento'], ['decision_maker', 'Decisor'],
  ['qualification_reason', 'Motivo da qualificação'], ['next_step', 'Próximo passo sugerido'], ['lost_reason', 'Motivo da perda'], ['tags', 'Etiquetas'],
  ['page', 'Página de origem'], ['ip_country', 'País (pelo IP)'],
];
const LONG = ['needs', 'current_situation', 'qualification_reason', 'next_step', 'summary'];

const digits = (s) => (s || '').replace(/\D/g, '');

export async function render(ctx) {
  const id = Number(ctx.params[0]);
  const data = await api(`/leads/${id}`);
  if (ctx.stale()) return;
  const { lead: l, activities, transactions, events } = data;
  const isAdmin = ctx.state.user.role === 'admin';
  ctx.setTitle(l.name || l.email || `Lead #${l.id}`, l.business || '');
  ctx.setActions(`<a class="btn ghost" href="#/crm">${icon('back')}<span class="lbl">CRM</span></a>`);

  const transcript = safeParse(l.transcript, []);
  const svc = services(l.services);
  const firstName = (l.name || '').split(' ')[0];
  const t = todayStr();
  const mail = l.email ? `mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(`Pipe Hero Studio${l.business ? ' — ' + l.business : ''}`)}&body=${encodeURIComponent(`Olá${firstName ? ' ' + firstName : ''},\n\n`)}` : '';
  const wa = digits(l.phone).length >= 8 ? `https://wa.me/${digits(l.phone)}?text=${encodeURIComponent(`Olá${firstName ? ' ' + firstName : ''}! Aqui é o Emerson, da Pipe Hero Studio.`)}` : '';
  const paid = transactions.filter((x) => x.kind === 'income' && x.status === 'paid');
  const pending = transactions.filter((x) => x.kind === 'income' && x.status === 'pending');

  ctx.page.innerHTML = `
    <section class="card">
      <div class="lead-head">
        <div class="who">
          <h2>${esc(l.name || l.email || 'Sem nome')}</h2>
          <div class="tags">${l.business ? `<span class="muted">${esc(l.business)}</span>` : ''}${srcTag(l.source)}${qualTag(l.qualification)}${svc.map((s) => `<span class="badge">${esc(s)}</span>`).join('')}<span class="faint" style="font-size:12px" title="${esc(dateTime(l.created_at))}">entrou ${ago(l.created_at)}</span></div>
        </div>
        <div class="quick">
          ${mail ? `<a class="btn" href="${mail}" data-log="email">${icon('mail')}E-mail</a>` : ''}
          ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener" data-log="whatsapp">${icon('whatsapp')}WhatsApp</a>` : ''}
          ${l.phone ? `<a class="btn" href="tel:${esc(l.phone.replace(/[^\d+]/g, ''))}" data-log="call">${icon('phone')}Ligar</a>` : ''}
          <button class="btn" data-edit>${icon('edit')}Editar</button>
        </div>
      </div>
      <div style="margin-top:16px;display:grid;gap:12px">
        <div class="stages" role="group" aria-label="Etapa">${STAGES.map(([k, lab]) => `<button type="button" class="${k}" data-stage="${k}" aria-pressed="${l.stage === k}">${lab}</button>`).join('')}</div>
        <div class="row" style="gap:16px">
          <label class="field" style="min-width:160px"><span>Próxima ação</span><input class="input" type="date" data-next value="${esc(l.next_action_at || '')}"></label>
          <label class="field" style="min-width:150px"><span>Qualificação</span><select class="input" data-qual><option value="">—</option>${Object.entries(QUAL).map(([k, v]) => `<option value="${k}"${l.qualification === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          <div class="field"><span>Valor do negócio</span><button class="btn" data-value style="justify-content:flex-start">${l.value_cents ? money(l.value_cents, l.currency) : 'Definir valor'}</button></div>
          ${l.next_action_at && l.next_action_at < t && !['won', 'lost'].includes(l.stage) ? '<span class="badge hot">Ação atrasada</span>' : ''}
        </div>
      </div>
    </section>

    <div class="cols">
      <div class="stack" style="gap:20px">
        ${l.summary || l.next_step ? `<section class="card"><div class="card-h"><h2>Resumo</h2>${l.source === 'chat' ? '<span class="muted">pela Ava</span>' : ''}</div>
          ${l.summary ? `<div class="summary">${esc(l.summary)}</div>` : ''}
          ${l.next_step ? `<p style="margin:12px 0 0"><strong>Próximo passo sugerido:</strong> ${esc(l.next_step)}</p>` : ''}</section>` : ''}

        <section class="card"><div class="card-h"><h2>Detalhes</h2><button class="end btn sm" data-edit>${icon('edit')}Editar</button></div>
          <dl class="kv">${FIELDS.filter(([k]) => l[k]).map(([k, lab]) => `<dt>${lab}</dt><dd>${k === 'email' ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : k === 'language' ? esc({ pt: 'Português', en: 'Inglês', es: 'Espanhol' }[l[k]] || l[k]) : esc(l[k])}</dd>`).join('')}
          <dt>Origem</dt><dd>${esc(SOURCE[l.source] || l.source)}</dd>
          <dt>Atualizado</dt><dd>${dateTime(l.updated_at)}</dd></dl>
        </section>

        <section class="card"><div class="card-h"><h2>Pagamentos</h2><span class="muted">${paid.length ? `recebido: ${paid.map((x) => money(x.amount_cents, x.currency)).join(' + ')}` : ''}${pending.length ? ` · a receber: ${pending.map((x) => money(x.amount_cents, x.currency)).join(' + ')}` : ''}</span><button class="end btn sm" data-tx>${icon('plus')}Registar</button></div>
          ${transactions.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Descrição</th><th>Estado</th><th class="num">Valor</th></tr></thead><tbody>${transactions.map((x) => `<tr><td>${date(x.date)}</td><td>${esc(x.description || x.category)}</td><td>${x.status === 'paid' ? '<span class="badge won">Recebido</span>' : '<span class="badge pending">A receber</span>'}</td><td class="num">${x.kind === 'expense' ? '−' : ''}${money(x.amount_cents, x.currency)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">Nenhum pagamento registado.</p>'}
        </section>

        ${transcript.length ? `<section class="card"><div class="card-h"><h2>Conversa com a Ava</h2><span class="muted">${transcript.length} mensagens</span></div>
          <div class="chatlog">${transcript.map((m) => `<div class="bubble ${m.role === 'user' ? 'user' : 'assistant'}"><small>${m.role === 'user' ? esc(firstName || 'Visitante') : 'Ava'}</small>${esc(m.content)}</div>`).join('')}</div></section>` : ''}

        ${events.length ? `<section class="card"><div class="card-h"><h2>Registo automático</h2><span class="muted">e-mails e avisos sobre este lead</span></div>
          <div class="list">${events.map((e) => { const meta = safeParse(e.meta, {}); return `<div class="list-item"><span class="li-main"><span class="li-title">${esc(eventLabel(e))}</span><span class="li-sub">${esc(meta.subject || '')}${meta.error ? ` — ${esc(meta.error)}` : ''}</span></span><span class="li-end">${dateTime(e.created_at)}</span></div>`; }).join('')}</div></section>` : ''}

        ${isAdmin ? `<div><button class="btn danger" data-delete>${icon('trash')}Apagar lead</button></div>` : ''}
      </div>

      <section class="card" style="align-self:start">
        <div class="card-h"><h2>Atividade</h2></div>
        <form class="stack" data-act style="gap:10px;margin-bottom:8px">
          <div class="seg" role="group" aria-label="Tipo">${['note', 'call', 'email', 'whatsapp', 'meeting'].map((k, i) => `<button type="button" data-type="${k}" aria-pressed="${i === 0}">${ACT[k][1]}</button>`).join('')}</div>
          <textarea class="input" name="content" placeholder="O que aconteceu? Ex.: liguei, quer proposta até sexta." required maxlength="8000"></textarea>
          <div class="row" style="gap:8px"><label class="check" style="font-size:13px">Próxima ação: <input class="input" type="date" name="next" style="width:auto;min-height:32px" value=""></label><button class="btn primary sm" type="submit" style="margin-left:auto">Guardar</button></div>
        </form>
        <div class="timeline">${activities.map((a) => {
          const [ic, lab] = ACT[a.type] || ACT.system;
          const mine = ['note', 'call', 'email', 'whatsapp', 'meeting'].includes(a.type);
          return `<div class="tl"><span class="tl-ico">${icon(ic)}</span><div class="tl-body"><div class="tl-meta"><strong style="color:var(--ink)">${lab}</strong><span>${ago(a.created_at)}${a.user_name ? ' · ' + esc(a.user_name) : ''}</span>${mine ? `<button class="btn ghost sm" data-del-act="${a.id}" aria-label="Apagar">${icon('trash')}</button>` : ''}</div><p>${esc(a.content || '')}</p></div></div>`;
        }).join('') || '<p class="muted">Sem atividade.</p>'}</div>
      </section>
    </div>`;

  const reload = () => ctx.refresh();
  const patch = async (body, msg) => {
    try { await api(`/leads/${l.id}`, { method: 'PATCH', body }); if (msg) toast(msg); reload(); }
    catch (e) { fail(e); }
  };

  ctx.page.querySelectorAll('[data-stage]').forEach((b) =>
    b.addEventListener('click', async () => {
      try { if (await changeStage(l, b.dataset.stage)) reload(); } catch (e) { fail(e); }
    }),
  );
  ctx.page.querySelector('[data-next]').addEventListener('change', (e) => patch({ next_action_at: e.target.value || null }, e.target.value ? `Próxima ação: ${date(e.target.value)}` : 'Próxima ação removida'));
  ctx.page.querySelector('[data-qual]').addEventListener('change', (e) => patch({ qualification: e.target.value || null }, 'Qualificação atualizada'));
  ctx.page.querySelector('[data-value]').addEventListener('click', () =>
    modal({
      title: 'Valor do negócio',
      body: `<div class="grid2"><label class="field"><span>Valor</span><input class="input" name="value" inputmode="decimal" value="${esc(fromCents(l.value_cents))}" placeholder="0,00"></label>
        <label class="field"><span>Moeda</span><select class="input" name="currency">${CURRENCIES.map((c) => `<option${c === l.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></label></div>`,
      onSubmit: async (form) => {
        const d = formData(form);
        const cents = d.value ? toCents(d.value) : null;
        if (d.value && !(cents >= 0)) throw new Error('Valor inválido.');
        await api(`/leads/${l.id}`, { method: 'PATCH', body: { value_cents: cents, currency: d.currency } });
        toast('Valor guardado');
        reload();
      },
    }),
  );
  ctx.page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editModal(l, reload)));
  ctx.page.querySelector('[data-tx]').addEventListener('click', () => txModal({ kind: 'income', lead_id: l.id, currency: l.currency, amount_cents: l.value_cents, description: l.business || l.name, category: 'Projeto' }, reload));
  ctx.page.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Apagar lead', `Apagar <strong>${esc(l.name || 'este lead')}</strong> e todo o histórico? Não dá para desfazer.`, 'Apagar'))) return;
    try { await api(`/leads/${l.id}`, { method: 'DELETE' }); toast('Lead apagado'); location.hash = '#/leads'; } catch (e) { fail(e); }
  });

  // Atalhos de contacto: abre a app e oferece registar o contacto.
  ctx.page.querySelectorAll('[data-log]').forEach((a) =>
    a.addEventListener('click', () => {
      const type = a.dataset.log;
      const form = ctx.page.querySelector('[data-act]');
      form.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
      const ta = form.querySelector('textarea');
      ta.placeholder = `Como correu? (${ACT[type][1]})`;
      setTimeout(() => ta.focus(), 300);
    }),
  );

  const actForm = ctx.page.querySelector('[data-act]');
  actForm.querySelectorAll('[data-type]').forEach((b) =>
    b.addEventListener('click', () => actForm.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))),
  );
  actForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(actForm);
    if (!d.content.trim()) return actForm.querySelector('textarea').focus();
    const type = actForm.querySelector('[data-type][aria-pressed="true"]').dataset.type;
    const btn = actForm.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api(`/leads/${l.id}/activities`, { method: 'POST', body: { type, content: d.content } });
      if (d.next) await api(`/leads/${l.id}`, { method: 'PATCH', body: { next_action_at: d.next } });
      toast('Registado');
      reload();
    } catch (err) { fail(err); btn.disabled = false; }
  });
  ctx.page.querySelectorAll('[data-del-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmBox('Apagar registo', 'Apagar esta entrada do histórico?', 'Apagar'))) return;
      try { await api(`/activities/${b.dataset.delAct}`, { method: 'DELETE' }); reload(); } catch (e) { fail(e); }
    }),
  );
}

function eventLabel(e) {
  const src = EMAIL_SOURCE[e.source] || e.source;
  return ({ email_sent: `E-mail enviado (${src})`, email_failed: `E-mail falhou (${src})`, whatsapp_sent: `WhatsApp enviado (${src})`, form_submit: 'Formulário enviado', lead_created: 'Lead criado' })[e.type] || e.type;
}

function editModal(l, done) {
  const svc = safeParse(l.services, []);
  const field = ([k, lab]) => LONG.includes(k)
    ? `<label class="field" style="grid-column:1/-1"><span>${lab}</span><textarea class="input" name="${k}">${esc(l[k] || '')}</textarea></label>`
    : `<label class="field"><span>${lab}</span><input class="input" name="${k}" value="${esc(l[k] || '')}"${k === 'email' ? ' type="email"' : ''}></label>`;
  modal({
    title: 'Editar lead',
    wide: true,
    body: `<div class="grid2">${[['summary', 'Resumo'], ...FIELDS.filter(([k]) => !['page', 'ip_country'].includes(k))].map(field).join('')}</div>
      <fieldset class="field" style="border:0;padding:0;margin:0"><span>Serviços</span><div class="row" style="gap:14px">${SERVICE_OPTIONS.map(([k, lab]) => `<label class="check"><input type="checkbox" name="svc" value="${k}"${svc.includes(k) ? ' checked' : ''}>${lab}</label>`).join('')}</div></fieldset>`,
    onSubmit: async (form) => {
      const d = formData(form);
      delete d.svc;
      const body = { ...d, services: [...form.querySelectorAll('[name=svc]:checked')].map((c) => c.value) };
      await api(`/leads/${l.id}`, { method: 'PATCH', body });
      toast('Lead atualizado');
      done();
    },
  });
}

export { addDays };
