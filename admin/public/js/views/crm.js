// CRM: quadro por etapas (arrastar e soltar), lista com filtros, novo lead e mudança de etapa.
import {
  api, esc, icon, num, money, moneyMulti, date, ago, todayStr, addDays, toCents, fromCents, modal, toast, fail, formData,
  STAGES, STAGE, SOURCES, QUAL, CURRENCIES, SERVICES, srcTag, qualTag, stageTag, services,
} from '../lib.js';

const SERVICE_OPTIONS = [['website', 'Site'], ['chat', 'Chat IA'], ['crm', 'CRM'], ['ai_agents', 'Agentes IA'], ['clinic_assistant', 'Clínicas'], ['other', 'Outro']];

/* ---------- Novo lead ---------- */
export function newLeadModal(onDone) {
  modal({
    title: 'Novo lead',
    wide: true,
    submit: 'Criar lead',
    body: `
      <div class="grid2">
        <label class="field"><span>Nome</span><input class="input" name="name" maxlength="120"></label>
        <label class="field"><span>Negócio</span><input class="input" name="business" maxlength="200"></label>
        <label class="field"><span>E-mail</span><input class="input" name="email" type="email"></label>
        <label class="field"><span>Telefone / WhatsApp</span><input class="input" name="phone" placeholder="+351 …"></label>
        <label class="field"><span>País / cidade</span><input class="input" name="country"></label>
        <label class="field"><span>Tipo de negócio</span><input class="input" name="business_type" placeholder="Clínica, restaurante…"></label>
      </div>
      <fieldset class="field" style="border:0;padding:0;margin:0"><span>Serviços de interesse</span><div class="row" style="gap:14px">${SERVICE_OPTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" name="svc" value="${k}">${l}</label>`).join('')}</div></fieldset>
      <label class="field"><span>O que precisa</span><textarea class="input" name="needs" maxlength="8000"></textarea></label>
      <div class="grid3">
        <label class="field"><span>Etapa</span><select class="input" name="stage">${STAGES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Qualificação</span><select class="input" name="qualification"><option value="">—</option>${Object.entries(QUAL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Próxima ação</span><input class="input" type="date" name="next_action_at" value="${addDays(1)}"></label>
        <label class="field"><span>Valor estimado</span><input class="input" name="value" inputmode="decimal" placeholder="0,00"></label>
        <label class="field"><span>Moeda</span><select class="input" name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label class="field"><span>Origem</span><input class="input" value="Manual" disabled></label>
      </div>`,
    onSubmit: async (form) => {
      const d = formData(form);
      const body = {
        name: d.name, business: d.business, email: d.email, phone: d.phone, country: d.country, business_type: d.business_type, needs: d.needs,
        stage: d.stage, qualification: d.qualification || null, next_action_at: d.next_action_at || null, currency: d.currency,
        services: [...form.querySelectorAll('[name=svc]:checked')].map((c) => c.value),
      };
      if (d.value) body.value_cents = toCents(d.value);
      const r = await api('/leads', { method: 'POST', body });
      toast('Lead criado');
      onDone ? onDone(r.id) : (location.hash = `#/leads/${r.id}`);
    },
  });
}

/* ---------- Mudar etapa (pede motivo se perdido; oferece registar receita se ganho) ---------- */
export async function changeStage(lead, stage) {
  if (stage === lead.stage) return false;
  if (stage === 'lost') {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: 'Marcar como perdido',
        submit: 'Marcar perdido',
        body: `<label class="field"><span>Motivo (ajuda a perceber o que melhorar)</span>
          <select class="input" name="reason"><option>Preço</option><option>Sem resposta</option><option>Escolheu outra empresa</option><option>Não era o momento</option><option>Não era o cliente certo</option><option>Outro</option></select></label>
          <label class="field"><span>Detalhe <span class="faint">(opcional)</span></span><input class="input" name="detail"></label>`,
        onSubmit: async (form) => {
          const d = formData(form);
          await api(`/leads/${lead.id}`, { method: 'PATCH', body: { stage, lost_reason: d.detail ? `${d.reason}: ${d.detail}` : d.reason } });
          done = true;
          toast('Marcado como perdido');
        },
      });
      m.dialog.addEventListener('close', () => resolve(done));
    });
  }
  if (stage === 'won') {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: 'Negócio ganho',
        submit: 'Confirmar',
        body: `<p style="margin:0">Parabéns. Confirme o valor fechado${lead.name ? ` com <strong>${esc(lead.name)}</strong>` : ''}.</p>
          <div class="grid2">
            <label class="field"><span>Valor</span><input class="input" name="value" inputmode="decimal" value="${esc(fromCents(lead.value_cents))}" placeholder="0,00"></label>
            <label class="field"><span>Moeda</span><select class="input" name="currency">${CURRENCIES.map((c) => `<option${c === (lead.currency || 'EUR') ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          </div>
          <label class="check"><input type="checkbox" name="tx" checked> Registar no Financeiro</label>
          <label class="field"><span>Estado do pagamento</span><select class="input" name="status"><option value="pending">A receber</option><option value="paid">Já recebido</option></select></label>`,
        onSubmit: async (form) => {
          const d = formData(form);
          const cents = d.value ? toCents(d.value) : null;
          if (d.value && !(cents > 0)) throw new Error('Valor inválido.');
          await api(`/leads/${lead.id}`, { method: 'PATCH', body: { stage, ...(cents ? { value_cents: cents, currency: d.currency } : {}), next_action_at: null } });
          if (d.tx && cents) {
            await api('/transactions', {
              method: 'POST',
              body: { date: todayStr(), kind: 'income', category: 'Projeto', description: `${lead.business || lead.name || 'Cliente'}`, amount_cents: cents, currency: d.currency, status: d.status, lead_id: lead.id },
            });
          }
          done = true;
          toast('Negócio ganho registado');
        },
      });
      m.dialog.addEventListener('close', () => resolve(done));
    });
  }
  await api(`/leads/${lead.id}`, { method: 'PATCH', body: { stage } });
  toast(`Movido para ${STAGE[stage]}`);
  return true;
}

/* ---------- Quadro ---------- */
function getPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } }

export async function renderBoard(ctx) {
  ctx.setTitle('CRM', 'Arraste os cartões entre etapas');
  ctx.setActions(`<a class="btn" href="#/leads">${icon('list')}<span class="lbl">Lista</span></a><button class="btn primary" data-new>${icon('plus')}<span class="lbl">Novo lead</span></button>`)
    .querySelector('[data-new]').addEventListener('click', () => newLeadModal());

  const { leads } = await api('/leads?limit=2000');
  if (ctx.stale()) return;
  const f = { q: '', source: getPref('phs-b-src', ''), qual: getPref('phs-b-qual', ''), closed: getPref('phs-b-closed', '30') };

  ctx.page.innerHTML = `
    <div class="toolbar">
      <input class="input search" type="search" placeholder="Procurar nome, e-mail, negócio…" data-f="q" aria-label="Procurar">
      <select class="input" data-f="source" aria-label="Origem"><option value="">Todas as origens</option>${SOURCES.map(([k, l]) => `<option value="${k}"${f.source === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="qual" aria-label="Qualificação"><option value="">Qualquer qualificação</option>${Object.entries(QUAL).map(([k, l]) => `<option value="${k}"${f.qual === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="closed" aria-label="Fechados"><option value="30"${f.closed === '30' ? ' selected' : ''}>Ganhos/perdidos: 30 dias</option><option value="90"${f.closed === '90' ? ' selected' : ''}>Ganhos/perdidos: 90 dias</option><option value="all"${f.closed === 'all' ? ' selected' : ''}>Ganhos/perdidos: todos</option><option value="none"${f.closed === 'none' ? ' selected' : ''}>Esconder fechados</option></select>
    </div>
    <div class="board" data-board></div>`;
  const board = ctx.page.querySelector('[data-board]');

  const draw = () => {
    const q = f.q.toLowerCase();
    const minClosed = f.closed === 'all' ? '' : new Date(Date.now() - Number(f.closed) * 864e5).toISOString();
    const shown = leads.filter((l) => {
      if (f.source && l.source !== f.source) return false;
      if (f.qual && l.qualification !== f.qual) return false;
      if (['won', 'lost'].includes(l.stage)) {
        if (f.closed === 'none') return false;
        if (minClosed && (l.closed_at || l.updated_at) < minClosed) return false;
      }
      if (q && ![l.name, l.email, l.business, l.phone, l.needs, l.tags].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const t = todayStr();
    board.innerHTML = STAGES.filter(([k]) => !(f.closed === 'none' && ['won', 'lost'].includes(k)))
      .map(([k, label]) => {
        const items = shown.filter((l) => l.stage === k);
        const val = {};
        for (const l of items) if (l.value_cents) val[l.currency] = (val[l.currency] || 0) + l.value_cents;
        return `<section class="col stage-${k}" data-stage="${k}" aria-label="${label}">
          <div class="col-h"><b>${label}</b><span class="n">${items.length}</span><span class="v">${moneyMulti(val, '')}</span></div>
          <div class="col-body">${items.map((l) => card(l, t)).join('') || '<p class="faint" style="font-size:12.5px;text-align:center;margin:12px 0">Sem leads</p>'}</div>
        </section>`;
      })
      .join('');
  };
  const card = (l, t) => `<a class="lcard" href="#/leads/${l.id}" draggable="true" data-id="${l.id}">
      <span class="t1">${esc(l.name || l.email || l.phone || 'Sem nome')}</span>
      ${l.business ? `<span class="t2">${esc(l.business)}</span>` : ''}
      <span class="meta">${srcTag(l.source)}${qualTag(l.qualification)}</span>
      <span class="meta">${l.next_action_at ? `<span class="${l.next_action_at < t && !['won', 'lost'].includes(l.stage) ? 'overdue' : ''}">${icon('calendar').replace('<svg', '<svg width="12" height="12"')} ${date(l.next_action_at)}</span>` : `<span>${ago(l.created_at)}</span>`}${l.value_cents ? `<span class="val">${money(l.value_cents, l.currency)}</span>` : ''}</span>
    </a>`;
  draw();

  ctx.page.querySelectorAll('[data-f]').forEach((el) =>
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      f[el.dataset.f] = el.value;
      if (el.dataset.f === 'source') setPref('phs-b-src', el.value);
      if (el.dataset.f === 'qual') setPref('phs-b-qual', el.value);
      if (el.dataset.f === 'closed') setPref('phs-b-closed', el.value);
      draw();
    }),
  );

  // Arrastar e soltar
  let dragId = null;
  board.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.lcard');
    if (!c) return;
    dragId = Number(c.dataset.id);
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  board.addEventListener('dragend', (e) => { e.target.closest('.lcard')?.classList.remove('dragging'); board.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop')); });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.col');
    if (!col || dragId == null) return;
    e.preventDefault();
    board.querySelectorAll('.drop').forEach((c) => c !== col && c.classList.remove('drop'));
    col.classList.add('drop');
  });
  board.addEventListener('drop', async (e) => {
    const col = e.target.closest('.col');
    if (!col || dragId == null) return;
    e.preventDefault();
    col.classList.remove('drop');
    const lead = leads.find((l) => l.id === dragId);
    dragId = null;
    if (!lead || lead.stage === col.dataset.stage) return;
    try {
      const ok = await changeStage(lead, col.dataset.stage);
      if (ok) {
        const fresh = await api(`/leads/${lead.id}`);
        Object.assign(lead, fresh.lead);
        draw();
      }
    } catch (err) { fail(err); }
  });
}

/* ---------- Lista ---------- */
export async function renderList(ctx) {
  ctx.setTitle('Leads', 'Todos os contactos que entraram');
  ctx.setActions(`<a class="btn" href="/api/export/leads.csv" download>${icon('download')}<span class="lbl">Exportar CSV</span></a><a class="btn" href="#/crm">${icon('board')}<span class="lbl">Quadro</span></a><button class="btn primary" data-new>${icon('plus')}<span class="lbl">Novo lead</span></button>`)
    .querySelector('[data-new]').addEventListener('click', () => newLeadModal());

  const f = { q: ctx.query.get('q') || '', source: ctx.query.get('source') || '', stage: ctx.query.get('stage') || '', qualification: ctx.query.get('qualification') || '' };
  ctx.page.innerHTML = `
    <div class="toolbar">
      <input class="input search" type="search" placeholder="Procurar nome, e-mail, negócio, telefone…" data-f="q" value="${esc(f.q)}" aria-label="Procurar">
      <select class="input" data-f="source" aria-label="Origem"><option value="">Todas as origens</option>${SOURCES.map(([k, l]) => `<option value="${k}"${f.source === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="stage" aria-label="Etapa"><option value="">Todas as etapas</option>${STAGES.map(([k, l]) => `<option value="${k}"${f.stage === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="qualification" aria-label="Qualificação"><option value="">Qualquer qualificação</option>${Object.entries(QUAL).map(([k, l]) => `<option value="${k}"${f.qualification === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted" data-count></span>
    </div>
    <section class="card" style="padding-top:6px;padding-bottom:6px"><div class="table-wrap" data-table></div></section>`;

  const tableEl = ctx.page.querySelector('[data-table]');
  const countEl = ctx.page.querySelector('[data-count]');
  let timer;
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const { leads } = await api(`/leads?${qs}`);
    if (ctx.stale()) return;
    countEl.textContent = `${num(leads.length)} lead${leads.length === 1 ? '' : 's'}`;
    if (!leads.length) {
      tableEl.innerHTML = `<div class="empty"><b>Nenhum lead encontrado.</b>${Object.values(f).some(Boolean) ? 'Experimente limpar os filtros.' : 'Quando alguém preencher o formulário ou falar com a Ava, aparece aqui.'}</div>`;
      return;
    }
    tableEl.innerHTML = `<table class="t"><thead><tr><th>Entrou</th><th>Nome / negócio</th><th>Contacto</th><th>Origem</th><th>Interesse</th><th>Qualificação</th><th>Etapa</th><th class="num">Valor</th></tr></thead><tbody>${leads
      .map((l) => `<tr class="click" data-id="${l.id}">
        <td class="nowrap"><span title="${esc(l.created_at)}">${date(l.created_at)}</span><br><span class="faint" style="font-size:12px">${ago(l.created_at)}</span></td>
        <td><a href="#/leads/${l.id}" class="strong" style="text-decoration:none">${esc(l.name || 'Sem nome')}</a>${l.business ? `<br><span class="muted">${esc(l.business)}</span>` : ''}</td>
        <td>${l.email ? `${esc(l.email)}<br>` : ''}<span class="muted">${esc(l.phone || '')}</span></td>
        <td>${srcTag(l.source)}</td>
        <td class="clip" title="${esc(l.needs || '')}">${esc(services(l.services).join(', ') || '—')}<br><span class="muted">${esc((l.summary || l.needs || '').slice(0, 80))}</span></td>
        <td>${qualTag(l.qualification) || '<span class="faint">—</span>'}</td>
        <td>${stageTag(l.stage)}</td>
        <td class="num">${l.value_cents ? money(l.value_cents, l.currency) : '<span class="faint">—</span>'}</td>
      </tr>`)
      .join('')}</tbody></table>`;
  };
  tableEl.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('a')) location.hash = `#/leads/${tr.dataset.id}`;
  });
  ctx.page.querySelectorAll('[data-f]').forEach((el) =>
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      f[el.dataset.f] = el.value;
      clearTimeout(timer);
      timer = setTimeout(() => load().catch(fail), el.tagName === 'INPUT' ? 250 : 0);
    }),
  );
  await load();
}

export { SERVICE_OPTIONS, SERVICES };
