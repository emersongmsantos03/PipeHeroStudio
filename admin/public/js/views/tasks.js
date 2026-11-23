// Tarefas: follow-ups, chamadas, reuniões. Agrupadas por prazo; leads novos sem contacto aparecem à parte.
import {
  api, esc, icon, modal, toast, fail, formData, confirmBox, todayStr, addDays, nextWeekday, dueLabel, dueClass, daysFromToday,
  avatar, team, ownerOptions, emptyState, TASK_TYPES, TASK_TYPE, srcTag, qualTag, ago, getPref, setPref, waLink, menu,
} from '../lib.js';

let leadCache = null;
async function leadOptions() {
  if (!leadCache) leadCache = api('/leads?open=1&limit=2000').then((r) => r.leads).catch((e) => { leadCache = null; throw e; });
  return leadCache;
}

/**
 * Modal de tarefa. initial: { id?, title, type, due_date, due_time, lead_id, assignee_id, notes, lead_name }
 */
export async function taskModal(initial = {}, onDone) {
  const [users, leads] = await Promise.all([team().catch(() => []), initial.lead_id && initial.lead_name ? Promise.resolve(null) : leadOptions().catch(() => [])]);
  const me = (await import('../app.js')).state.user;
  const type0 = initial.type || 'todo';
  const leadField = leads
    ? `<select class="input" name="lead_id"><option value="">— Sem lead —</option>${leads.map((l) => `<option value="${l.id}"${Number(initial.lead_id) === l.id ? ' selected' : ''}>${esc(l.name || l.email || 'Lead #' + l.id)}${l.business ? ' — ' + esc(l.business) : ''}</option>`).join('')}</select>`
    : `<input type="hidden" name="lead_id" value="${initial.lead_id}"><input class="input" value="${esc(initial.lead_name)}" disabled>`;
  modal({
    title: initial.id ? 'Editar tarefa' : 'Nova tarefa',
    submit: initial.id ? 'Guardar' : 'Criar tarefa',
    body: `
      <div class="seg" role="group" aria-label="Tipo">${TASK_TYPES.map(([k, l, ic]) => `<button type="button" data-type="${k}" aria-pressed="${k === type0}">${icon(ic)}${l}</button>`).join('')}</div>
      <input type="hidden" name="type" value="${type0}">
      <label class="field"><span>O que fazer</span><input class="input" name="title" required maxlength="200" value="${esc(initial.title || '')}" placeholder="Ex.: Ligar para apresentar a proposta"></label>
      <div class="grid2">
        <label class="field"><span>Data</span><input class="input" type="date" name="due_date" value="${esc(initial.due_date ?? todayStr())}">
          <span class="quick-dates"><button type="button" class="btn xs" data-d="${todayStr()}">Hoje</button><button type="button" class="btn xs" data-d="${addDays(1)}">Amanhã</button><button type="button" class="btn xs" data-d="${addDays(3)}">Em 3 dias</button><button type="button" class="btn xs" data-d="${nextWeekday(1)}">Próx. semana</button></span></label>
        <label class="field"><span>Hora <span class="faint">(opcional)</span></span><input class="input" type="time" name="due_time" value="${esc(initial.due_time || '')}"></label>
        <label class="field"><span>Lead</span>${leadField}</label>
        <label class="field"><span>Responsável</span><select class="input" name="assignee_id">${ownerOptions(users, initial.id ? initial.assignee_id : initial.assignee_id ?? me?.id, 'Qualquer pessoa')}</select></label>
      </div>
      <label class="field"><span>Notas <span class="faint">(opcional)</span></span><textarea class="input" name="notes" maxlength="4000" style="min-height:64px">${esc(initial.notes || '')}</textarea></label>`,
    onOpen: (form) => {
      const titleInput = form.title;
      const defaults = { todo: '', call: 'Ligar', email: 'Enviar e-mail', whatsapp: 'Mandar WhatsApp', meeting: 'Reunião' };
      form.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        form.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        const prev = defaults[form.type.value];
        form.type.value = b.dataset.type;
        if (!titleInput.value || titleInput.value === prev) titleInput.value = defaults[b.dataset.type];
        titleInput.focus();
      }));
      form.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { form.due_date.value = b.dataset.d; }));
    },
    onSubmit: async (form) => {
      const d = formData(form);
      if (!d.title.trim()) throw new Error('Escreva o que há para fazer.');
      const body = { title: d.title, type: d.type, due_date: d.due_date || null, due_time: d.due_time || null, lead_id: d.lead_id || null, assignee_id: d.assignee_id || null, notes: d.notes };
      if (initial.id) await api(`/tasks/${initial.id}`, { method: 'PATCH', body });
      else await api('/tasks', { method: 'POST', body });
      toast(initial.id ? 'Tarefa atualizada' : 'Tarefa criada');
      leadCache = null;
      onDone?.();
    },
  });
}

/** Conclui uma tarefa (com nota opcional do resultado, que vai para o histórico do lead). */
export async function completeTask(t, onDone, { ask = false } = {}) {
  const done = async (outcome) => {
    await api(`/tasks/${t.id}`, { method: 'PATCH', body: { done: true, outcome } });
    toast('Tarefa concluída');
    onDone?.();
  };
  if (!ask || !t.lead_id) return done();
  modal({
    title: 'Concluir tarefa',
    submit: 'Concluir',
    body: `<p style="margin:0"><strong>${esc(t.title)}</strong></p>
      <label class="field"><span>Como correu? <span class="faint">(opcional — fica no histórico do lead)</span></span><textarea class="input" name="outcome" maxlength="4000" placeholder="Ex.: Falei com ela, quer proposta até sexta."></textarea></label>
      <label class="check"><input type="checkbox" name="next"> Criar a próxima tarefa a seguir</label>`,
    onSubmit: async (form) => {
      const d = formData(form);
      await done(d.outcome);
      if (d.next) taskModal({ lead_id: t.lead_id, lead_name: t.lead_name || t.lead_business, type: 'call', due_date: addDays(2) }, onDone);
    },
  });
}

/** Linha de tarefa (usada aqui e na ficha do lead). */
export function taskRow(t, { showLead = true } = {}) {
  const ty = TASK_TYPE[t.type] || TASK_TYPE.todo;
  const done = !!t.done_at;
  return `<div class="task${done ? ' done' : ''}" data-task="${t.id}">
    <button type="button" class="tick" data-tick aria-label="${done ? 'Reabrir' : 'Concluir'} tarefa">${icon('check')}</button>
    <div class="t-main">
      <span class="t-title">${esc(t.title)}</span>
      <span class="t-meta">
        <span class="type-ico" title="${ty.label}">${icon(ty.icon)}</span>
        ${done ? `<span>${icon('check')}Concluída ${ago(t.done_at)}</span>` : `<span class="${dueClass(t.due_date)}">${icon('clock')}${esc(dueLabel(t.due_date, t.due_time))}</span>`}
        ${showLead && t.lead_id ? `<a href="#/leads/${t.lead_id}">${icon('user')}${esc(t.lead_name || t.lead_business || 'Lead #' + t.lead_id)}</a>` : ''}
        ${t.assignee_name ? `<span>${avatar(t.assignee_name, 'xs')}${esc(t.assignee_name.split(' ')[0])}</span>` : ''}
      </span>
      ${t.notes ? `<span class="t-notes">${esc(t.notes)}</span>` : ''}
    </div>
    <div class="t-act">
      ${!done && t.type === 'whatsapp' && waLink(t.lead_phone) ? `<a class="btn ghost xs icon" href="${waLink(t.lead_phone)}" target="_blank" rel="noopener" aria-label="Abrir WhatsApp">${icon('whatsapp')}</a>` : ''}
      ${!done && t.type === 'call' && t.lead_phone ? `<a class="btn ghost xs icon" href="tel:${esc(t.lead_phone.replace(/[^\d+]/g, ''))}" aria-label="Ligar">${icon('phone')}</a>` : ''}
      <button type="button" class="btn ghost xs icon" data-task-menu aria-label="Mais ações">${icon('more')}</button>
    </div>
  </div>`;
}

/** Liga os eventos das linhas de tarefa dentro de `el`. */
export function bindTasks(el, list, onChange) {
  el.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-task]');
    if (!row) return;
    const t = list.find((x) => x.id === Number(row.dataset.task));
    if (!t) return;
    if (e.target.closest('[data-tick]')) {
      e.preventDefault();
      try {
        if (t.done_at) { await api(`/tasks/${t.id}`, { method: 'PATCH', body: { done: false } }); toast('Tarefa reaberta'); onChange(); }
        else { row.classList.add('done'); await completeTask(t, onChange); }
      } catch (err) { row.classList.remove('done'); fail(err); }
    } else if (e.target.closest('[data-task-menu]')) {
      const b = e.target.closest('[data-task-menu]');
      menu(b, [
        ...(t.done_at ? [] : [
          { label: 'Concluir com nota…', icon: 'note', onClick: () => completeTask(t, onChange, { ask: true }) },
          { label: 'Adiar para amanhã', icon: 'clock', onClick: () => patch(t, { due_date: addDays(1) }, 'Adiada para amanhã', onChange) },
          { label: 'Adiar 1 semana', icon: 'calendar', onClick: () => patch(t, { due_date: addDays(7) }, 'Adiada 1 semana', onChange) },
          'sep',
        ]),
        { label: 'Editar', icon: 'edit', onClick: () => taskModal(t, onChange) },
        { label: 'Apagar', icon: 'trash', danger: true, onClick: async () => {
          if (!(await confirmBox('Apagar tarefa', `Apagar “${esc(t.title)}”?`, 'Apagar'))) return;
          try { await api(`/tasks/${t.id}`, { method: 'DELETE' }); toast('Tarefa apagada'); onChange(); } catch (err) { fail(err); }
        } },
      ], { align: 'right' });
    }
  });
}
async function patch(t, body, msg, onChange) {
  try { await api(`/tasks/${t.id}`, { method: 'PATCH', body }); toast(msg); onChange(); } catch (e) { fail(e); }
}

/* ---------- Página ---------- */
export async function render(ctx) {
  ctx.setTitle('Tarefas', 'O que há para fazer, por ordem de prazo');
  ctx.setActions(`<button class="btn primary" data-new>${icon('plus')}<span class="lbl">Nova tarefa</span></button>`)
    .querySelector('[data-new]').addEventListener('click', () => taskModal({}, reload));
  const reload = () => { ctx.refreshCounts(); ctx.refresh(); };

  const who = getPref('phs-t-who', 'me');
  const showDone = getPref('phs-t-done', '0') === '1';
  const [data, users] = await Promise.all([api(`/tasks?assignee=${encodeURIComponent(who)}&done=${showDone ? 1 : 0}`), team().catch(() => [])]);
  if (ctx.stale()) return;
  const list = data.tasks;

  const groups = showDone
    ? [['done', 'Concluídas recentemente', list]]
    : (() => {
        const g = { late: [], today: [], tomorrow: [], week: [], later: [], none: [] };
        for (const t of list) {
          const n = daysFromToday(t.due_date);
          if (n == null) g.none.push(t);
          else if (n < 0) g.late.push(t);
          else if (n === 0) g.today.push(t);
          else if (n === 1) g.tomorrow.push(t);
          else if (n < 7) g.week.push(t);
          else g.later.push(t);
        }
        return [['late', 'Atrasadas', g.late], ['today', 'Hoje', g.today], ['tomorrow', 'Amanhã', g.tomorrow], ['week', 'Próximos 7 dias', g.week], ['later', 'Mais tarde', g.later], ['none', 'Sem data', g.none]];
      })();
  const late = showDone ? 0 : groups[0][2].length;
  const today = showDone ? 0 : groups[1][2].length;

  ctx.page.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="De quem">
        <button type="button" data-who="me" aria-pressed="${who === 'me'}">${icon('user')}Minhas</button>
        <button type="button" data-who="all" aria-pressed="${who === 'all'}">${icon('users')}Toda a equipa</button>
      </div>
      ${users.length > 1 ? `<select class="input" data-who-sel aria-label="Pessoa" style="min-width:160px"><option value="">Por pessoa…</option>${users.map((u) => `<option value="${u.id}"${String(u.id) === who ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      <div class="grow"></div>
      <div class="seg" role="group" aria-label="Estado"><button type="button" data-done="0" aria-pressed="${!showDone}">Por fazer</button><button type="button" data-done="1" aria-pressed="${showDone}">Concluídas</button></div>
    </div>
    ${!showDone ? `<section class="tiles">
      <div class="tile tc-red"><span class="label"><span class="ti">${icon('alert')}</span>Atrasadas</span><span class="value">${late}</span></div>
      <div class="tile tc-amber"><span class="label"><span class="ti">${icon('clock')}</span>Para hoje</span><span class="value">${today}</span></div>
      <div class="tile tc-blue"><span class="label"><span class="ti">${icon('calendar')}</span>Próximas</span><span class="value">${list.length - late - today}</span></div>
      <div class="tile tc-ink"><span class="label"><span class="ti">${icon('inbox')}</span>Leads por contactar</span><span class="value">${data.uncontacted.length}</span><span class="foot">Novos e sem tarefa</span></div>
    </section>` : ''}
    <div class="cols">
      <section class="card" data-list>
        ${list.length ? groups.filter(([, , items]) => items.length).map(([k, label, items]) => `<div class="task-group ${k}"><h3>${label}<span class="n">${items.length}</span></h3><div class="tasks">${items.map((t) => taskRow(t)).join('')}</div></div>`).join('')
          : emptyState('tasks', showDone ? 'Nenhuma tarefa concluída ainda.' : 'Tudo em dia.', showDone ? '' : 'Crie tarefas para não deixar nenhum lead sem resposta.', showDone ? '' : `<button class="btn primary" data-new2>${icon('plus')}Nova tarefa</button>`)}
      </section>
      ${showDone ? '' : `<section class="card" style="align-self:start">
        <div class="card-h"><span class="ico">${icon('inbox')}</span><h2>Leads por contactar</h2><span class="muted">novos, sem tarefa</span></div>
        ${data.uncontacted.length ? `<div class="list">${data.uncontacted.map((l) => `<div class="list-item">
            ${avatar(l.name || l.email || '?', 'sm')}
            <a class="li-main" href="#/leads/${l.id}" style="text-decoration:none"><span class="li-title">${esc(l.name || l.email || 'Sem nome')}</span><span class="li-sub">${esc(l.business || l.summary || '')}</span></a>
            <span class="li-end">${ago(l.created_at)}<span class="row" style="gap:4px">${srcTag(l.source)}${qualTag(l.qualification)}</span></span>
            <button class="btn xs" data-plan="${l.id}" title="Criar tarefa">${icon('plus')}Tarefa</button>
          </div>`).join('')}</div>` : emptyState('check', 'Nenhum lead esquecido.', 'Todos os leads novos já têm uma tarefa.')}
      </section>`}
    </div>`;

  ctx.page.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => { setPref('phs-t-who', b.dataset.who); ctx.refresh(); }));
  ctx.page.querySelector('[data-who-sel]')?.addEventListener('change', (e) => { setPref('phs-t-who', e.target.value || 'all'); ctx.refresh(); });
  ctx.page.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => { setPref('phs-t-done', b.dataset.done); ctx.refresh(); }));
  ctx.page.querySelector('[data-new2]')?.addEventListener('click', () => taskModal({}, reload));
  ctx.page.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => {
    const l = data.uncontacted.find((x) => x.id === Number(b.dataset.plan));
    taskModal({ lead_id: l.id, lead_name: l.name || l.email || l.business, type: 'call', title: `Primeiro contacto com ${(l.name || '').split(' ')[0] || 'o lead'}`, due_date: todayStr() }, reload);
  }));
  bindTasks(ctx.page.querySelector('[data-list]'), list, reload);
}
