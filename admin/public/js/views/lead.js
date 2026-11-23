// Ficha do lead: dados, etapa, negócio (valor, probabilidade, fecho, responsável, etiquetas), tarefas, atividade,
// conversa da Ava, mensagens a partir de modelos e pagamentos.
import {
  api, esc, icon, money, date, dateTime, ago, todayStr, addDays, toCents, fromCents, modal, toast, fail, formData, confirmBox, safeParse,
  STAGES, SOURCE, QUAL, CURRENCIES, EMAIL_SOURCE, ACT, srcTag, qualTag, services, avatar, team, ownerOptions, probOf, STAGE_PROB,
  tagsOf, emptyState, menu, fillTemplate, waLink, mailLink, copy, getPref, setPref, daysSince,
} from '../lib.js';
import { changeStage, SERVICE_OPTIONS } from './crm.js';
import { txModal } from './finance.js';
import { taskModal, taskRow, bindTasks } from './tasks.js';

const GROUPS = [
  ['Contacto', [['email', 'E-mail'], ['phone', 'Telefone'], ['preferred_contact', 'Preferência'], ['language', 'Idioma'], ['country', 'País'], ['location', 'Local']]],
  ['Negócio', [['business', 'Nome'], ['business_type', 'Tipo'], ['needs', 'O que precisa'], ['current_situation', 'Situação atual']]],
  ['Qualificação', [['timeline', 'Prazo'], ['budget', 'Orçamento'], ['decision_maker', 'Decisor'], ['qualification_reason', 'Porquê'], ['lost_reason', 'Motivo da perda']]],
  ['Origem', [['page', 'Página'], ['ip_country', 'País (IP)']]],
];
const FIELDS = [
  ['name', 'Nome'], ['business', 'Negócio'], ['business_type', 'Tipo de negócio'], ['email', 'E-mail'], ['phone', 'Telefone / WhatsApp'],
  ['preferred_contact', 'Contacto preferido'], ['country', 'País'], ['location', 'Local'], ['language', 'Idioma'], ['needs', 'O que precisa'],
  ['current_situation', 'Situação atual'], ['timeline', 'Prazo'], ['budget', 'Orçamento'], ['decision_maker', 'Decisor'],
  ['qualification_reason', 'Motivo da qualificação'], ['next_step', 'Próximo passo sugerido'], ['lost_reason', 'Motivo da perda'],
];
const LONG = ['needs', 'current_situation', 'qualification_reason', 'next_step', 'summary'];
const LANG = { pt: 'Português', en: 'Inglês', es: 'Espanhol' };
const MANUAL = ['note', 'call', 'email', 'whatsapp', 'meeting'];

let tplCache = null;
const templates = async () => (tplCache ||= api('/templates').then((r) => r.templates).catch((e) => { tplCache = null; throw e; }));
export const resetTemplates = () => { tplCache = null; };

export async function render(ctx) {
  const id = Number(ctx.params[0]);
  const [data, users] = await Promise.all([api(`/leads/${id}`), team().catch(() => [])]);
  if (ctx.stale()) return;
  const { lead: l, activities, transactions, events, tasks } = data;
  const me = ctx.state.user;
  const isAdmin = me.role === 'admin';
  ctx.setTitle('Ficha do lead', `<a href="#/leads" style="color:inherit">Leads</a> › ${esc(l.name || l.email || `Lead #${l.id}`)}`);
  document.title = `${l.name || l.email || `Lead #${l.id}`} · Painel Pipe Hero Studio`;
  ctx.setActions(`<a class="btn ghost" href="#/crm">${icon('back')}<span class="lbl">Pipeline</span></a>`);

  const transcript = safeParse(l.transcript, []);
  const svc = services(l.services);
  const first = (l.name || '').split(' ')[0];
  const wa = waLink(l.phone, `Olá${first ? ' ' + first : ''}! Aqui é o ${me.name.split(' ')[0]}, da Pipe Hero Studio.`);
  const mail = mailLink(l.email, `Pipe Hero Studio${l.business ? ' — ' + l.business : ''}`, `Olá${first ? ' ' + first : ''},\n\n`);
  const openTasks = tasks.filter((t) => !t.done_at);
  const doneTasks = tasks.filter((t) => t.done_at);
  const paid = transactions.filter((x) => x.kind === 'income' && x.status === 'paid');
  const pending = transactions.filter((x) => x.kind === 'income' && x.status === 'pending');
  const stageIdx = STAGES.findIndex(([k]) => k === l.stage);
  const closed = ['won', 'lost'].includes(l.stage);
  const prob = probOf(l);
  const tags = tagsOf(l.tags);
  const idle = daysSince(activities.find((a) => [...MANUAL, 'task'].includes(a.type))?.created_at || l.created_at);
  const tab = getPref('phs-lead-tab', 'activity');

  const act = (cls, inner, label, attrs = '') => `<span class="ra">${cls === 'a' ? `<a class="ra-b" ${attrs} aria-label="${label}">${inner}</a>` : `<button type="button" class="ra-b" ${attrs} aria-label="${label}">${inner}</button>`}<span>${label}</span></span>`;
  const telHref = l.phone ? `tel:${esc(l.phone.replace(/[^\d+]/g, ''))}` : '';
  ctx.page.innerHTML = `
    <div class="lead-grid rec">
      <div class="l-col l-left">
        <section class="card rec-profile">
          ${avatar(l.name || l.email || '?', 'xl')}
          <h2>${esc(l.name || l.email || 'Sem nome')}</h2>
          ${l.business ? `<p class="rec-biz">${icon('building')}${esc(l.business)}${l.business_type ? ` <span class="faint">· ${esc(l.business_type)}</span>` : ''}</p>` : ''}
          <div class="rec-tags">${qualTag(l.qualification)}${srcTag(l.source)}${svc.map((s) => `<span class="badge outline">${esc(s)}</span>`).join('')}</div>
          <div class="rec-actions">
            ${act('b', icon('note'), 'Nota', 'data-note')}
            ${mail ? act('a', icon('mail'), 'E-mail', `href="${mail}" data-log="email"`) : ''}
            ${l.phone ? act('a', icon('phone'), 'Ligar', `href="${telHref}" data-log="call"`) : ''}
            ${wa ? act('a', icon('whatsapp'), 'Whats', `href="${wa}" target="_blank" rel="noopener" data-log="whatsapp"`) : ''}
            ${act('b', icon('tasks'), 'Tarefa', 'data-task2')}
            ${act('b', icon('more'), 'Mais', 'data-more aria-haspopup="menu"')}
          </div>
          <button class="btn primary rec-msg" data-msg aria-haspopup="menu">${icon('send')}Mensagem a partir de modelo</button>
          <div class="rec-contact">
            ${l.email ? `<a href="mailto:${esc(l.email)}">${icon('mail')}<span>${esc(l.email)}</span></a>` : ''}
            ${l.phone ? `<a href="${telHref}">${icon('phone')}<span>${esc(l.phone)}</span></a>` : ''}
            ${l.location || l.country ? `<span>${icon('globe')}<span>${esc([l.location, l.country].filter(Boolean).join(', '))}</span></span>` : ''}
          </div>
        </section>
        <section class="card">
          <div class="card-h"><h2>Sobre este lead</h2><button class="end btn ghost xs" data-edit>${icon('edit')}Editar</button></div>
          ${GROUPS.map(([g, fields]) => {
            const rows = fields.filter(([k]) => l[k]);
            if (!rows.length) return '';
            return `<div class="kv-group"><h3>${g}</h3><dl class="kv stack">${rows.map(([k, lab]) => `<dt>${lab}</dt><dd>${k === 'email' ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : k === 'language' ? esc(LANG[l[k]] || l[k]) : esc(l[k])}</dd>`).join('')}</dl></div>`;
          }).join('')}
          <div class="kv-group"><h3>Registo</h3><dl class="kv"><dt>Origem</dt><dd>${esc(SOURCE[l.source] || l.source)}</dd><dt>Criado</dt><dd>${dateTime(l.created_at)}</dd><dt>Atualizado</dt><dd>${ago(l.updated_at)}</dd>${l.closed_at ? `<dt>Fechado</dt><dd>${date(l.closed_at)}</dd>` : ''}</dl></div>
        </section>
      </div>

      <div class="l-col l-mid">
        <section class="card rec-stage">
          <div class="rec-stage-h"><span class="faint">Etapa do negócio</span>
            <span class="rec-meta"><span title="${esc(dateTime(l.created_at))}">entrou ${ago(l.created_at)}</span>${!closed && idle >= 7 ? `<span class="badge pending" title="Última atividade há ${idle} dias">${icon('alert')} parado há ${idle} dias</span>` : ''}</span></div>
          <div class="pipeline" role="group" aria-label="Etapa">${STAGES.map(([k, lab], i) => `<button type="button" class="${k}${!closed && i < stageIdx ? ' past' : ''}${l.stage === 'won' && i < 4 ? ' past' : ''}" data-stage="${k}" aria-pressed="${l.stage === k}" title="${lab}">${lab}</button>`).join('')}</div>
        </section>
        ${l.summary || l.next_step ? `<section class="card"><div class="card-h"><span class="ico">${icon('spark')}</span><h2>Resumo</h2>${l.source === 'chat' ? '<span class="muted">pela Ava</span>' : ''}</div>
          ${l.summary ? `<div class="summary">${esc(l.summary)}</div>` : ''}
          ${l.next_step ? `<p style="margin:12px 0 0;font-size:13.5px"><strong>Próximo passo sugerido:</strong> ${esc(l.next_step)}</p>` : ''}</section>` : ''}

        <section class="card">
          <div class="tabs" role="tablist">
            <button role="tab" data-tab="activity" aria-selected="${tab === 'activity'}">${icon('chat').replace('<svg', '<svg width="15" height="15"')}Atividade<span class="n">${activities.length}</span></button>
            ${transcript.length ? `<button role="tab" data-tab="chat" aria-selected="${tab === 'chat'}">${icon('bot').replace('<svg', '<svg width="15" height="15"')}Conversa com a Ava<span class="n">${transcript.length}</span></button>` : ''}
            ${events.length ? `<button role="tab" data-tab="log" aria-selected="${tab === 'log'}">${icon('mail').replace('<svg', '<svg width="15" height="15"')}E-mails e avisos<span class="n">${events.length}</span></button>` : ''}
          </div>
          <div data-panel="activity">
            <form class="composer" data-act>
              <div class="c-top" role="group" aria-label="Tipo">${MANUAL.map((k, i) => `<button type="button" data-type="${k}" aria-pressed="${i === 0}">${icon(ACT[k][0])}${ACT[k][1]}</button>`).join('')}</div>
              <textarea name="content" placeholder="Escreva uma nota ou registe um contacto… (Ctrl+Enter guarda)" maxlength="8000"></textarea>
              <div class="c-foot"><label>${icon('clock').replace('<svg', '<svg width="14" height="14"')}Follow-up: <input class="input" type="date" name="next"></label><button class="btn primary sm" type="submit" style="margin-left:auto">Guardar</button></div>
            </form>
            <div class="timeline" style="margin-top:12px">${activities.map((a) => {
              const [ic, lab] = ACT[a.type] || ACT.system;
              const mine = MANUAL.includes(a.type) && (a.user_id === me.id || isAdmin);
              return `<div class="tl"><span class="tl-ico k-${a.type}">${icon(ic)}</span><div class="tl-body ${a.type === 'note' ? 'note' : ''}"><div class="tl-meta"><strong>${lab}</strong><span title="${esc(dateTime(a.created_at))}">${ago(a.created_at)}${a.user_name ? ' · ' + esc(a.user_name) : ''}</span>${mine ? `<button class="btn ghost xs icon" data-del-act="${a.id}" aria-label="Apagar">${icon('trash')}</button>` : ''}</div><p>${esc(a.content || '')}</p></div></div>`;
            }).join('') || emptyState('chat', 'Sem atividade ainda.')}</div>
          </div>
          ${transcript.length ? `<div data-panel="chat"><div class="chatlog">${transcript.map((m) => `<div class="bubble ${m.role === 'user' ? 'user' : 'assistant'}"><small>${m.role === 'user' ? esc(first || 'Visitante') : 'Ava'}</small>${esc(m.content)}</div>`).join('')}</div></div>` : ''}
          ${events.length ? `<div data-panel="log"><div class="list">${events.map((e) => { const meta = safeParse(e.meta, {}); return `<div class="list-item"><span class="type-ico">${icon(e.type.startsWith('email') ? 'mail' : e.type === 'whatsapp_sent' ? 'whatsapp' : 'spark')}</span><span class="li-main"><span class="li-title">${esc(eventLabel(e))}</span><span class="li-sub">${esc(meta.subject || '')}${meta.error ? ` — ${esc(meta.error)}` : ''}</span></span><span class="li-end">${dateTime(e.created_at)}</span></div>`; }).join('')}</div></div>` : ''}
        </section>
      </div>

      <div class="l-col l-right">
        <section class="card">
          <div class="card-h"><span class="ico">${icon('target')}</span><h2>Negócio</h2></div>
          <button class="btn ghost" data-value style="padding:0;height:auto;justify-content:flex-start;box-shadow:none"><span class="deal-value">${l.value_cents ? money(l.value_cents, l.currency) : '<span class="faint" style="font-size:16px;font-weight:500">Definir valor</span>'}</span></button>
          ${l.value_cents && !closed ? `<p class="faint" style="margin:4px 0 8px;font-size:12.5px">Ponderado: <strong style="color:var(--ink)">${money(Math.round((l.value_cents * prob) / 100), l.currency)}</strong> (${prob}%)</p>` : '<div style="height:8px"></div>'}
          <div class="deal-row"><span>Responsável</span><select class="input sm" data-owner style="width:auto;max-width:170px">${ownerOptions(users, l.owner_id)}</select></div>
          ${!closed ? `<div class="deal-row"><span>Probabilidade</span><select class="input sm" data-prob style="width:auto"><option value="">Auto (${STAGE_PROB[l.stage]}%)</option>${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => `<option value="${p}"${l.probability === p ? ' selected' : ''}>${p}%</option>`).join('')}</select></div>
          <div class="deal-row"><span>Fecho previsto</span><input class="input sm" type="date" data-close value="${esc(l.expected_close_at || '')}" style="width:auto"></div>` : ''}
          <div class="deal-row"><span>Qualificação</span><select class="input sm" data-qual style="width:auto"><option value="">—</option>${Object.entries(QUAL).map(([k, v]) => `<option value="${k}"${l.qualification === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
          <div style="padding-top:10px"><div class="faint" style="font-size:13px;margin-bottom:6px">Etiquetas</div>
            <div class="row" style="gap:5px" data-tags>${tags.map((t) => `<span class="tag">${esc(t)}<button type="button" data-untag="${esc(t)}" aria-label="Remover ${esc(t)}">${icon('x')}</button></span>`).join('')}<button type="button" class="btn xs" data-addtag>${icon('plus')}Etiqueta</button></div></div>
        </section>

        <section class="card">
          <div class="card-h"><span class="ico">${icon('tasks')}</span><h2>Tarefas</h2>${openTasks.length ? `<span class="muted">${openTasks.length} aberta${openTasks.length === 1 ? '' : 's'}</span>` : ''}<button class="end btn xs" data-task>${icon('plus')}Nova</button></div>
          <div class="tasks" data-tasks>${openTasks.map((t) => taskRow({ ...t, lead_phone: l.phone }, { showLead: false })).join('') || `<p class="muted" style="margin:0 0 4px;font-size:13px">${closed ? 'Sem tarefas abertas.' : 'Nenhuma tarefa marcada. Marque o próximo passo para não perder este lead.'}</p>`}
            ${doneTasks.length ? `<details style="margin-top:6px"><summary class="faint" style="cursor:pointer;font-size:12.5px">${doneTasks.length} concluída${doneTasks.length === 1 ? '' : 's'}</summary>${doneTasks.map((t) => taskRow(t, { showLead: false })).join('')}</details>` : ''}</div>
        </section>

        <section class="card">
          <div class="card-h"><span class="ico">${icon('money')}</span><h2>Pagamentos</h2><button class="end btn xs" data-tx>${icon('plus')}Registar</button></div>
          ${paid.length || pending.length ? `<div class="stat-line"><span class="muted">Recebido</span><b>${paid.map((x) => money(x.amount_cents, x.currency)).join(' + ') || '—'}</b></div><div class="stat-line"><span class="muted">A receber</span><b>${pending.map((x) => money(x.amount_cents, x.currency)).join(' + ') || '—'}</b></div>` : ''}
          ${transactions.length ? `<div class="list" style="margin-top:6px">${transactions.map((x) => `<div class="list-item" style="padding:8px 0"><span class="li-main"><span class="li-title" style="font-size:13px">${esc(x.description || x.category)}</span><span class="li-sub">${date(x.date)} · ${x.status === 'paid' ? 'Recebido' : 'A receber'}</span></span><strong class="tnum" style="font-size:13px;${x.kind === 'expense' ? 'color:var(--danger)' : ''}">${x.kind === 'expense' ? '−' : ''}${money(x.amount_cents, x.currency)}</strong></div>`).join('')}</div>` : '<p class="muted" style="margin:0;font-size:13px">Nenhum pagamento registado.</p>'}
        </section>
      </div>
    </div>`;

  const reload = () => { ctx.refreshCounts(); ctx.refresh(); };
  const patch = async (body, msg) => {
    try { await api(`/leads/${l.id}`, { method: 'PATCH', body }); if (msg) toast(msg); reload(); }
    catch (e) { fail(e); }
  };

  // Separadores
  const showTab = (k) => {
    if (!ctx.page.querySelector(`[data-panel="${k}"]`)) k = 'activity';
    ctx.page.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
    ctx.page.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== k));
  };
  showTab(tab);
  ctx.page.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { setPref('phs-lead-tab', b.dataset.tab); showTab(b.dataset.tab); }));

  ctx.page.querySelectorAll('[data-stage]').forEach((b) =>
    b.addEventListener('click', async () => {
      try { if (await changeStage(l, b.dataset.stage)) reload(); } catch (e) { fail(e); }
    }),
  );
  ctx.page.querySelector('[data-qual]').addEventListener('change', (e) => patch({ qualification: e.target.value || null }, 'Qualificação atualizada'));
  ctx.page.querySelector('[data-owner]').addEventListener('change', (e) => patch({ owner_id: e.target.value || null }, 'Responsável atualizado'));
  ctx.page.querySelector('[data-prob]')?.addEventListener('change', (e) => patch({ probability: e.target.value === '' ? null : Number(e.target.value) }, 'Probabilidade atualizada'));
  ctx.page.querySelector('[data-close]')?.addEventListener('change', (e) => patch({ expected_close_at: e.target.value || null }, e.target.value ? `Fecho previsto: ${date(e.target.value)}` : 'Data de fecho removida'));
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

  // Etiquetas
  ctx.page.querySelectorAll('[data-untag]').forEach((b) => b.addEventListener('click', () => patch({ tags: tags.filter((t) => t !== b.dataset.untag) }, 'Etiqueta removida')));
  ctx.page.querySelector('[data-addtag]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const all = await api('/tags').then((r) => r.tags.map((t) => t.name)).catch(() => []);
    const input = document.createElement('input');
    input.className = 'input sm';
    input.style.width = '140px';
    input.placeholder = 'Nova etiqueta';
    input.maxLength = 40;
    input.setAttribute('list', 'lead-tags');
    btn.replaceWith(input);
    input.insertAdjacentHTML('afterend', `<datalist id="lead-tags">${all.filter((t) => !tags.includes(t)).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`);
    input.focus();
    const save = () => { const v = input.value.trim(); if (v) patch({ tags: [...tags, v] }, 'Etiqueta adicionada'); else reload(); };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } if (ev.key === 'Escape') reload(); });
    input.addEventListener('blur', () => { if (input.value.trim()) save(); });
  });

  // Tarefas
  ctx.page.querySelector('[data-task]').addEventListener('click', () => taskModal({ lead_id: l.id, lead_name: l.name || l.email || l.business, assignee_id: l.owner_id || me.id, type: 'call', due_date: addDays(1) }, reload));
  bindTasks(ctx.page.querySelector('[data-tasks]'), tasks.map((t) => ({ ...t, lead_name: l.name, lead_phone: l.phone })), reload);

  ctx.page.querySelector('[data-task2]').addEventListener('click', () => ctx.page.querySelector('[data-task]').click());
  ctx.page.querySelector('[data-note]').addEventListener('click', () => {
    showTab('activity');
    const form = ctx.page.querySelector('[data-act]');
    form.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === 'note')));
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => form.querySelector('textarea').focus(), 250);
  });
  ctx.page.querySelector('[data-tx]').addEventListener('click', () => txModal({ kind: 'income', lead_id: l.id, currency: l.currency, amount_cents: l.value_cents, description: l.business || l.name, category: 'Projeto' }, reload));
  ctx.page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editModal(l, reload)));
  ctx.page.querySelector('[data-more]').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Editar dados', icon: 'edit', onClick: () => editModal(l, reload) },
    { label: 'Nova tarefa', icon: 'tasks', onClick: () => ctx.page.querySelector('[data-task]').click() },
    { label: 'Registar pagamento', icon: 'money', onClick: () => ctx.page.querySelector('[data-tx]').click() },
    ...(l.email ? [{ label: 'Copiar e-mail', icon: 'copy', onClick: () => copy(l.email, 'E-mail copiado') }] : []),
    ...(l.phone ? [{ label: 'Copiar telefone', icon: 'copy', onClick: () => copy(l.phone, 'Telefone copiado') }] : []),
    ...(isAdmin ? ['sep', { label: 'Apagar lead', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmBox('Apagar lead', `Apagar <strong>${esc(l.name || 'este lead')}</strong> e todo o histórico? Não dá para desfazer.`, 'Apagar'))) return;
      try { await api(`/leads/${l.id}`, { method: 'DELETE' }); toast('Lead apagado'); location.hash = '#/leads'; } catch (err) { fail(err); }
    } }] : []),
  ], { align: 'right' }));

  // Mensagem a partir de modelo
  ctx.page.querySelector('[data-msg]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    let list = [];
    try { list = await templates(); } catch (err) { return fail(err); }
    menu(btn, [
      { header: 'Modelos' },
      ...list.map((t) => ({ label: t.name, icon: t.channel === 'email' ? 'mail' : t.channel === 'whatsapp' ? 'whatsapp' : 'template', onClick: () => messageModal(l, t, me, reload) })),
      ...(list.length ? ['sep'] : []),
      { label: 'Mensagem em branco', icon: 'edit', onClick: () => messageModal(l, { name: 'Mensagem', channel: 'any', body: '', subject: '' }, me, reload) },
      { label: 'Gerir modelos', icon: 'template', href: '#/templates' },
    ], { align: 'right' });
  });

  // Atalhos de contacto: abre a app e prepara o registo do contacto.
  ctx.page.querySelectorAll('[data-log]').forEach((a) =>
    a.addEventListener('click', () => {
      const type = a.dataset.log;
      showTab('activity');
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
  actForm.querySelector('textarea').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) actForm.requestSubmit(); });
  actForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(actForm);
    if (!d.content.trim() && !d.next) return actForm.querySelector('textarea').focus();
    const type = actForm.querySelector('[data-type][aria-pressed="true"]').dataset.type;
    const btn = actForm.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (d.content.trim()) await api(`/leads/${l.id}/activities`, { method: 'POST', body: { type, content: d.content } });
      if (d.next) await api('/tasks', { method: 'POST', body: { title: `Follow-up com ${first || l.business || 'o lead'}`, type: 'call', due_date: d.next, lead_id: l.id, assignee_id: l.owner_id || me.id } });
      toast(d.next ? 'Registado e follow-up marcado' : 'Registado');
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

/** Pré-visualiza a mensagem preenchida, deixa editar e abre no WhatsApp / e-mail, registando no histórico. */
function messageModal(l, tpl, me, done) {
  const canWa = !!waLink(l.phone);
  const canMail = !!l.email;
  const def = tpl.channel === 'email' ? (canMail ? 'email' : 'whatsapp') : canWa ? 'whatsapp' : 'email';
  modal({
    title: tpl.name,
    submit: null,
    cancel: 'Fechar',
    wide: true,
    body: `
      <div class="seg" role="group" aria-label="Canal"><button type="button" data-ch="whatsapp" aria-pressed="${def === 'whatsapp'}" ${canWa ? '' : 'disabled title="Sem telefone"'}>${icon('whatsapp')}WhatsApp</button><button type="button" data-ch="email" aria-pressed="${def === 'email'}" ${canMail ? '' : 'disabled title="Sem e-mail"'}>${icon('mail')}E-mail</button></div>
      <label class="field" data-subj ${def === 'email' ? '' : 'hidden'}><span>Assunto</span><input class="input" name="subject" value="${esc(fillTemplate(tpl.subject || `Pipe Hero Studio${l.business ? ' — ' + l.business : ''}`, l, me))}"></label>
      <label class="field"><span>Mensagem para ${esc(l.name || l.email || 'o lead')}</span><textarea class="input" name="body" style="min-height:180px">${esc(fillTemplate(tpl.body, l, me))}</textarea></label>
      <label class="check"><input type="checkbox" name="log" checked> Registar no histórico do lead</label>
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button type="button" class="btn" data-copy>${icon('copy')}Copiar</button>
        <button type="button" class="btn primary" data-send>${icon('send')}<span data-send-l>${def === 'email' ? 'Abrir no e-mail' : 'Abrir no WhatsApp'}</span></button>
      </div>
      ${!canWa && !canMail ? `<p class="notice warn">${icon('alert')}<span>Este lead não tem telefone nem e-mail. Pode copiar a mensagem.</span></p>` : ''}`,
    onOpen: (form, dialog) => {
      let ch = def;
      form.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
        ch = b.dataset.ch;
        form.querySelectorAll('[data-ch]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        form.querySelector('[data-subj]').hidden = ch !== 'email';
        form.querySelector('[data-send-l]').textContent = ch === 'email' ? 'Abrir no e-mail' : 'Abrir no WhatsApp';
      }));
      form.querySelector('[data-copy]').addEventListener('click', () => copy(form.body.value, 'Mensagem copiada'));
      form.querySelector('[data-send]').addEventListener('click', async () => {
        const body = form.body.value.trim();
        if (!body) return form.body.focus();
        const url = ch === 'email' ? mailLink(l.email, form.subject.value, body) : waLink(l.phone, body);
        if (!url) return toast(ch === 'email' ? 'Este lead não tem e-mail.' : 'Este lead não tem telefone válido.', true);
        window.open(url, ch === 'email' ? '_self' : '_blank', 'noopener');
        if (form.log.checked) {
          try {
            await api(`/leads/${l.id}/activities`, { method: 'POST', body: { type: ch, content: `${ch === 'email' ? `E-mail enviado: “${form.subject.value}”` : 'WhatsApp enviado'} (modelo: ${tpl.name})\n\n${body}` } });
            toast('Mensagem registada no histórico');
          } catch (e) { fail(e); }
        }
        dialog.close(); dialog.remove();
        done();
      });
    },
  });
}

function editModal(l, done) {
  const svc = safeParse(l.services, []);
  const field = ([k, lab]) => LONG.includes(k)
    ? `<label class="field span2"><span>${lab}</span><textarea class="input" name="${k}">${esc(l[k] || '')}</textarea></label>`
    : `<label class="field"><span>${lab}</span><input class="input" name="${k}" value="${esc(l[k] || '')}"${k === 'email' ? ' type="email"' : ''}></label>`;
  modal({
    title: 'Editar lead',
    wide: true,
    body: `<div class="grid2">${[...FIELDS, ['summary', 'Resumo']].map(field).join('')}</div>
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

