// CRM: pipeline (arrastar e soltar), lista com vistas, filtros, ordenação e ações em massa, novo lead e importação CSV.
import {
  api, esc, icon, num, money, moneyMulti, date, ago, todayStr, addDays, toCents, fromCents, modal, toast, fail, formData, confirmBox,
  STAGES, STAGE, SOURCES, QUAL, CURRENCIES, SERVICES, srcTag, qualTag, stageTag, services, avatar, team, ownerOptions, emptyState,
  getPref, setPref, probOf, STAGE_PROB, tagChips, tagsOf, dueLabel, dueClass, daysSince, menu, parseCsv, debounce,
} from '../lib.js';

const SERVICE_OPTIONS = [['website', 'Site'], ['chat', 'Chat IA'], ['crm', 'CRM'], ['ai_agents', 'Agentes IA'], ['clinic_assistant', 'Clínicas'], ['other', 'Outro']];
const OPEN = ['new', 'contacted', 'meeting', 'proposal'];
const STALE_DAYS = 7;

/* ---------- Novo lead ---------- */
export async function newLeadModal(onDone, preset = {}) {
  const users = await team().catch(() => []);
  const me = (await import('../app.js')).state.user;
  modal({
    title: 'Novo lead',
    wide: true,
    submit: 'Criar lead',
    body: `
      <div class="grid2">
        <label class="field"><span>Nome</span><input class="input" name="name" maxlength="120" placeholder="Maria Silva"></label>
        <label class="field"><span>Negócio</span><input class="input" name="business" maxlength="200" placeholder="Clínica Sorriso"></label>
        <label class="field"><span>E-mail</span><input class="input" name="email" type="email" placeholder="maria@exemplo.com"></label>
        <label class="field"><span>Telefone / WhatsApp</span><input class="input" name="phone" placeholder="+351 …"></label>
        <label class="field"><span>País / cidade</span><input class="input" name="country"></label>
        <label class="field"><span>Tipo de negócio</span><input class="input" name="business_type" placeholder="Clínica, restaurante…"></label>
      </div>
      <fieldset class="field" style="border:0;padding:0;margin:0"><span>Serviços de interesse</span><div class="row" style="gap:14px">${SERVICE_OPTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" name="svc" value="${k}">${l}</label>`).join('')}</div></fieldset>
      <label class="field"><span>O que precisa</span><textarea class="input" name="needs" maxlength="8000" style="min-height:70px"></textarea></label>
      <div class="grid3">
        <label class="field"><span>Etapa</span><select class="input" name="stage">${STAGES.map(([k, l]) => `<option value="${k}"${k === (preset.stage || 'new') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Qualificação</span><select class="input" name="qualification"><option value="">—</option>${Object.entries(QUAL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Responsável</span><select class="input" name="owner_id">${ownerOptions(users, me?.id)}</select></label>
        <label class="field"><span>Valor estimado</span><input class="input" name="value" inputmode="decimal" placeholder="0,00"></label>
        <label class="field"><span>Moeda</span><select class="input" name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label class="field"><span>Etiquetas</span><input class="input" name="tags" placeholder="indicação, urgente"></label>
      </div>
      <label class="field"><span>Criar tarefa de primeiro contacto para</span><input class="input" type="date" name="next_action_at" value="${todayStr()}" style="max-width:200px"><small class="faint">Deixe vazio para não criar tarefa.</small></label>`,
    onSubmit: async (form) => {
      const d = formData(form);
      const body = {
        name: d.name, business: d.business, email: d.email, phone: d.phone, country: d.country, business_type: d.business_type, needs: d.needs,
        stage: d.stage, qualification: d.qualification || null, next_action_at: d.next_action_at || null, currency: d.currency,
        owner_id: d.owner_id || null, tags: d.tags,
        services: [...form.querySelectorAll('[name=svc]:checked')].map((c) => c.value),
      };
      if (d.value) {
        body.value_cents = toCents(d.value);
        if (!(body.value_cents >= 0)) throw new Error('Valor inválido.');
      }
      const r = await api('/leads', { method: 'POST', body });
      toast(r.created === false ? 'Já existia um lead com este e-mail — foi atualizado' : 'Lead criado');
      (await import('../app.js')).refreshCounts();
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
        danger: true,
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
        title: 'Negócio ganho 🎉',
        submit: 'Confirmar',
        body: `<p style="margin:0">Parabéns! Confirme o valor fechado${lead.name ? ` com <strong>${esc(lead.name)}</strong>` : ''}.</p>
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
          await api(`/leads/${lead.id}`, { method: 'PATCH', body: { stage, ...(cents ? { value_cents: cents, currency: d.currency } : {}) } });
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

/* ---------- Importar CSV ---------- */
const CSV_MAP = {
  name: ['nome', 'name', 'contacto', 'contato', 'cliente', 'full name'],
  email: ['email', 'e-mail', 'mail', 'correio'],
  phone: ['telefone', 'phone', 'telemovel', 'telemóvel', 'celular', 'whatsapp', 'tel', 'mobile'],
  business: ['negocio', 'negócio', 'empresa', 'company', 'business', 'organizacao', 'organização'],
  business_type: ['tipo', 'setor', 'sector', 'industria', 'indústria', 'tipo de negocio', 'tipo de negócio'],
  country: ['pais', 'país', 'country'],
  location: ['cidade', 'city', 'local', 'localidade', 'location'],
  needs: ['necessidade', 'mensagem', 'message', 'notas', 'notes', 'observacoes', 'observações', 'descricao', 'descrição', 'needs'],
  value: ['valor', 'value', 'montante', 'amount', 'orcamento valor'],
  tags: ['etiquetas', 'tags', 'etiqueta', 'tag'],
  qualification: ['qualificacao', 'qualificação', 'qualification', 'temperatura'],
};
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export async function importModal(onDone) {
  const users = await team().catch(() => []);
  let parsed = null;
  const m = modal({
    title: 'Importar leads de CSV',
    wide: true,
    submit: 'Importar',
    body: `
      <label class="dropzone" data-drop>${icon('upload')}<strong>Escolha um ficheiro .csv</strong><span class="faint" style="font-size:12.5px">ou arraste-o para aqui. Exportado do Excel, Google Sheets, outro CRM…</span><input type="file" accept=".csv,text/csv" hidden data-file></label>
      <div data-preview></div>
      <div class="grid2">
        <label class="field"><span>Responsável pelos leads importados</span><select class="input" name="owner_id">${ownerOptions(users, '', 'Sem responsável')}</select></label>
      </div>
      <p class="faint" style="margin:0;font-size:12.5px">Colunas reconhecidas: nome, e-mail, telefone, empresa/negócio, tipo, país, cidade, mensagem/notas, valor, etiquetas, qualificação. E-mails que já têm um negócio aberto são atualizados em vez de duplicados.</p>`,
    onOpen: (form) => {
      const drop = form.querySelector('[data-drop]');
      const file = form.querySelector('[data-file]');
      const read = async (f) => {
        if (!f) return;
        const text = await f.text();
        const { headers, rows } = parseCsv(text);
        const map = {};
        headers.forEach((h, i) => { const n = norm(h); for (const [k, alts] of Object.entries(CSV_MAP)) if (!(k in map) && alts.some((a) => norm(a) === n)) map[k] = i; });
        parsed = rows.map((r) => {
          const o = {};
          for (const [k, i] of Object.entries(map)) { const v = (r[i] || '').trim(); if (v) o[k] = v; }
          if (o.value) { o.value_cents = toCents(o.value.replace(/[^\d,.-]/g, '')); delete o.value; if (!(o.value_cents >= 0)) delete o.value_cents; }
          if (o.qualification) { const q = norm(o.qualification); o.qualification = q.startsWith('q') || q === 'hot' ? 'hot' : q.startsWith('m') || q === 'warm' ? 'warm' : q.startsWith('f') || q === 'cold' ? 'cold' : undefined; }
          return o;
        }).filter((o) => o.name || o.email || o.phone || o.business);
        const recog = Object.keys(map);
        form.querySelector('[data-preview]').innerHTML = !recog.length
          ? `<p class="notice err">${icon('alert')}<span>Não reconheci nenhuma coluna. A primeira linha tem de ter os nomes das colunas (ex.: Nome, E-mail, Telefone).</span></p>`
          : `<p class="notice info">${icon('check')}<span><strong>${f.name}</strong>: ${num(parsed.length)} lead${parsed.length === 1 ? '' : 's'} para importar. Colunas: ${recog.map((k) => headers[map[k]]).map(esc).join(', ')}.</span></p>
             <div class="table-wrap" style="max-height:200px;overflow:auto;margin:0;padding:0"><table class="t"><thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Negócio</th></tr></thead><tbody>${parsed.slice(0, 5).map((o) => `<tr><td>${esc(o.name || '—')}</td><td>${esc(o.email || '—')}</td><td>${esc(o.phone || '—')}</td><td>${esc(o.business || '—')}</td></tr>`).join('')}</tbody></table></div>`;
        drop.querySelector('strong').textContent = f.name;
      };
      file.addEventListener('change', () => read(file.files[0]));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('on'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); read(e.dataTransfer.files[0]); });
    },
    onSubmit: async (form) => {
      if (!parsed?.length) throw new Error('Escolha um ficheiro CSV com leads.');
      const owner = form.owner_id.value || null;
      const btn = form.querySelector('[type=submit]');
      const tot = { created: 0, updated: 0, skipped: 0 };
      for (let i = 0; i < parsed.length; i += 8) {
        btn.textContent = `A importar… ${Math.min(i + 8, parsed.length)}/${parsed.length}`;
        const r = await api('/leads/import', { method: 'POST', body: { rows: parsed.slice(i, i + 8), owner_id: owner } });
        tot.created += r.created; tot.updated += r.updated; tot.skipped += r.skipped;
      }
      toast(`${tot.created} criado${tot.created === 1 ? '' : 's'}, ${tot.updated} atualizado${tot.updated === 1 ? '' : 's'}${tot.skipped ? `, ${tot.skipped} ignorado${tot.skipped === 1 ? '' : 's'}` : ''}`);
      onDone?.();
    },
  });
  void m;
}

/* ---------- Partilhado: filtro de responsável ---------- */
const ownerFilter = (users, sel) =>
  `<select class="input" data-f="owner" aria-label="Responsável" style="min-width:150px"><option value="">Todos os responsáveis</option><option value="me"${sel === 'me' ? ' selected' : ''}>Os meus</option><option value="none"${sel === 'none' ? ' selected' : ''}>Sem responsável</option>${users.map((u) => `<option value="${u.id}"${sel === String(u.id) ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;

/* ---------- Quadro ---------- */
export async function renderBoard(ctx) {
  ctx.setTitle('Pipeline', 'Arraste os cartões entre etapas');
  ctx.setActions(`<a class="btn" href="#/leads">${icon('list')}<span class="lbl">Lista</span></a><button class="btn primary" data-new>${icon('plus')}<span class="lbl">Novo lead</span></button>`)
    .querySelector('[data-new]').addEventListener('click', () => newLeadModal());

  const [{ leads }, users] = await Promise.all([api('/leads?limit=2000'), team().catch(() => [])]);
  if (ctx.stale()) return;
  const f = { q: '', owner: getPref('phs-b-owner', ''), source: getPref('phs-b-src', ''), qual: getPref('phs-b-qual', ''), closed: getPref('phs-b-closed', '30') };

  ctx.page.innerHTML = `
    <div class="toolbar">
      <div class="search-box">${icon('search')}<input class="input" type="search" placeholder="Procurar no pipeline…" data-f="q" aria-label="Procurar"></div>
      ${ownerFilter(users, f.owner)}
      <select class="input" data-f="source" aria-label="Origem"><option value="">Todas as origens</option>${SOURCES.map(([k, l]) => `<option value="${k}"${f.source === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="qual" aria-label="Qualificação"><option value="">Qualquer qualificação</option>${Object.entries(QUAL).map(([k, l]) => `<option value="${k}"${f.qual === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="closed" aria-label="Fechados"><option value="30"${f.closed === '30' ? ' selected' : ''}>Fechados: 30 dias</option><option value="90"${f.closed === '90' ? ' selected' : ''}>Fechados: 90 dias</option><option value="all"${f.closed === 'all' ? ' selected' : ''}>Fechados: todos</option><option value="none"${f.closed === 'none' ? ' selected' : ''}>Esconder fechados</option></select>
      <span class="muted" style="margin-left:auto;font-size:13px" data-sum></span>
    </div>
    <div class="board" data-board></div>`;
  const board = ctx.page.querySelector('[data-board]');
  const sumEl = ctx.page.querySelector('[data-sum]');
  const me = ctx.state.user.id;

  const draw = () => {
    const q = f.q.toLowerCase();
    const minClosed = f.closed === 'all' || f.closed === 'none' ? '' : new Date(Date.now() - Number(f.closed) * 864e5).toISOString();
    const shown = leads.filter((l) => {
      if (f.owner === 'me' && l.owner_id !== me) return false;
      if (f.owner === 'none' && l.owner_id) return false;
      if (/^\d+$/.test(f.owner) && l.owner_id !== Number(f.owner)) return false;
      if (f.source && l.source !== f.source) return false;
      if (f.qual && l.qualification !== f.qual) return false;
      if (['won', 'lost'].includes(l.stage)) {
        if (f.closed === 'none') return false;
        if (minClosed && (l.closed_at || l.updated_at) < minClosed) return false;
      }
      if (q && ![l.name, l.email, l.business, l.phone, l.needs, l.tags].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const open = shown.filter((l) => OPEN.includes(l.stage));
    const weighted = {};
    for (const l of open) if (l.value_cents) weighted[l.currency] = (weighted[l.currency] || 0) + Math.round((l.value_cents * probOf(l)) / 100);
    sumEl.innerHTML = `${num(open.length)} em aberto · ponderado <strong style="color:var(--ink)">${moneyMulti(weighted)}</strong>`;
    board.innerHTML = STAGES.filter(([k]) => !(f.closed === 'none' && ['won', 'lost'].includes(k)))
      .map(([k, label]) => {
        const items = shown.filter((l) => l.stage === k);
        const val = {};
        for (const l of items) if (l.value_cents) val[l.currency] = (val[l.currency] || 0) + l.value_cents;
        return `<section class="col st-${k}" data-stage="${k}" aria-label="${label}">
          <div class="col-h"><div class="r1"><b>${label}</b><span class="n">${items.length}</span>${OPEN.includes(k) ? `<button class="btn ghost xs icon add" data-add="${k}" aria-label="Novo lead em ${label}" title="Novo lead em ${label}">${icon('plus')}</button>` : ''}</div>
            <span class="v">${moneyMulti(val, '—')}${OPEN.includes(k) ? ` <span class="faint">· ${STAGE_PROB[k]}%</span>` : ''}</span></div>
          <div class="col-body">${items.map(card).join('') || `<p class="col-empty">${OPEN.includes(k) ? 'Arraste um lead para aqui' : 'Nada por aqui'}</p>`}</div>
        </section>`;
      })
      .join('');
  };
  const card = (l) => {
    const open = OPEN.includes(l.stage);
    const idle = daysSince(l.last_activity_at || l.created_at);
    const stale = open && idle >= STALE_DAYS;
    return `<a class="lcard${l.qualification === 'hot' && open ? ' hot-edge' : ''}" href="#/leads/${l.id}" draggable="true" data-id="${l.id}">
      <span class="corner">${avatar(l.owner_name, 'xs', l.owner_name ? `Responsável: ${l.owner_name}` : 'Sem responsável')}</span>
      <span class="t1">${esc(l.name || l.email || l.phone || 'Sem nome')}</span>
      ${l.business ? `<span class="t2">${esc(l.business)}</span>` : ''}
      <span class="meta">${srcTag(l.source)}${qualTag(l.qualification)}${tagChips(l.tags, 2)}</span>
      <span class="foot">
        ${open && l.next_action_at ? `<span class="${dueClass(l.next_action_at)}" title="Próxima tarefa">${icon('clock')}${esc(dueLabel(l.next_action_at))}</span>` : open ? `<span class="faint" title="Sem tarefa marcada">${icon('clock')}Sem tarefa</span>` : `<span>${ago(l.closed_at || l.updated_at)}</span>`}
        ${stale ? `<span class="stale" title="Sem atividade há ${idle} dias">${icon('alert')}${idle}d</span>` : ''}
        ${l.value_cents ? `<span class="val">${money(l.value_cents, l.currency)}</span>` : ''}
      </span>
    </a>`;
  };
  draw();

  const persist = { owner: 'phs-b-owner', source: 'phs-b-src', qual: 'phs-b-qual', closed: 'phs-b-closed' };
  ctx.page.querySelectorAll('[data-f]').forEach((el) =>
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      f[el.dataset.f] = el.value;
      if (persist[el.dataset.f]) setPref(persist[el.dataset.f], el.value);
      draw();
    }),
  );
  board.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    e.preventDefault();
    newLeadModal(undefined, { stage: b.dataset.add });
  });

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
const VIEWS = [
  ['all', 'Todos'], ['mine', 'Os meus'], ['open', 'Em aberto'], ['hot', 'Quentes'], ['unassigned', 'Sem responsável'], ['stale', `Parados ${STALE_DAYS}+ dias`], ['won', 'Ganhos'],
];
const SORTS = {
  created: (l) => l.created_at, name: (l) => (l.name || l.email || '').toLowerCase(), stage: (l) => STAGES.findIndex(([k]) => k === l.stage),
  value: (l) => l.value_cents || 0, activity: (l) => l.last_activity_at || '', next: (l) => l.next_action_at || '9999', owner: (l) => (l.owner_name || '~').toLowerCase(),
};

export async function renderList(ctx) {
  ctx.setTitle('Leads', 'Todos os contactos que entraram');
  const acts = ctx.setActions(`<button class="btn" data-more aria-label="Mais ações">${icon('more')}</button><a class="btn" href="#/crm">${icon('board')}<span class="lbl">Pipeline</span></a><button class="btn primary" data-new>${icon('plus')}<span class="lbl">Novo lead</span></button>`);
  acts.querySelector('[data-new]').addEventListener('click', () => newLeadModal());
  acts.querySelector('[data-more]').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Importar CSV', icon: 'upload', onClick: () => importModal(ctx.refresh) },
    { label: 'Exportar CSV', icon: 'download', href: '/api/export/leads.csv' },
  ], { align: 'right' }));

  const isAdmin = ctx.state.user.role === 'admin';
  const [users, tagList] = await Promise.all([team().catch(() => []), api('/tags').then((r) => r.tags).catch(() => [])]);
  if (ctx.stale()) return;
  const f = {
    q: ctx.query.get('q') || '', source: ctx.query.get('source') || '', stage: ctx.query.get('stage') || '', qualification: ctx.query.get('qualification') || '',
    owner: ctx.query.get('owner') || '', tag: ctx.query.get('tag') || '', view: ctx.query.get('view') || getPref('phs-l-view', 'all'),
  };
  if (ctx.query.toString()) f.view = ctx.query.get('view') || 'all';
  let sort = getPref('phs-l-sort', 'created');
  let dir = getPref('phs-l-dir', 'desc');
  const selected = new Set();
  let rows = [];

  ctx.page.innerHTML = `
    <div class="views" role="group" aria-label="Vistas">${VIEWS.map(([k, l]) => `<button type="button" class="view-chip" data-view="${k}" aria-pressed="${f.view === k}">${l}</button>`).join('')}</div>
    <div class="toolbar">
      <div class="search-box">${icon('search')}<input class="input" type="search" placeholder="Nome, e-mail, negócio, telefone…" data-f="q" value="${esc(f.q)}" aria-label="Procurar"></div>
      ${ownerFilter(users, f.owner)}
      <select class="input" data-f="stage" aria-label="Etapa"><option value="">Todas as etapas</option>${STAGES.map(([k, l]) => `<option value="${k}"${f.stage === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="source" aria-label="Origem"><option value="">Todas as origens</option>${SOURCES.map(([k, l]) => `<option value="${k}"${f.source === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="input" data-f="qualification" aria-label="Qualificação"><option value="">Qualquer qualificação</option>${Object.entries(QUAL).map(([k, l]) => `<option value="${k}"${f.qualification === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${tagList.length ? `<select class="input" data-f="tag" aria-label="Etiqueta"><option value="">Qualquer etiqueta</option>${tagList.map((t) => `<option value="${esc(t.name)}"${f.tag === t.name ? ' selected' : ''}>${esc(t.name)} (${t.n})</option>`).join('')}</select>` : ''}
      <span class="muted" style="margin-left:auto;font-size:13px" data-count></span>
    </div>
    <section class="card flush"><div class="table-wrap" data-table></div></section>
    <div data-bulk></div>`;

  const tableEl = ctx.page.querySelector('[data-table]');
  const countEl = ctx.page.querySelector('[data-count]');
  const bulkEl = ctx.page.querySelector('[data-bulk]');

  const query = () => {
    const p = { q: f.q, source: f.source, stage: f.stage, qualification: f.qualification, owner: f.owner, tag: f.tag };
    if (f.view === 'mine') p.owner = 'me';
    if (f.view === 'unassigned') p.owner = 'none';
    if (f.view === 'hot') p.qualification = 'hot';
    if (f.view === 'won') p.stage = 'won';
    if (['open', 'stale'].includes(f.view) || (f.view === 'hot' && !p.stage)) p.open = '1';
    return new URLSearchParams(Object.entries(p).filter(([, v]) => v));
  };

  const draw = () => {
    let list = rows;
    if (f.view === 'stale') list = list.filter((l) => daysSince(l.last_activity_at || l.created_at) >= STALE_DAYS);
    const key = SORTS[sort] || SORTS.created;
    list = [...list].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1); });
    for (const id of [...selected]) if (!list.some((l) => l.id === id)) selected.delete(id);
    const open = list.filter((l) => OPEN.includes(l.stage));
    const val = {};
    for (const l of open) if (l.value_cents) val[l.currency] = (val[l.currency] || 0) + l.value_cents;
    countEl.innerHTML = `${num(list.length)} lead${list.length === 1 ? '' : 's'}${open.length ? ` · ${moneyMulti(val, '')} em aberto` : ''}`;
    if (!list.length) {
      const filtered = Object.entries(f).some(([k, v]) => v && !(k === 'view' && v === 'all'));
      tableEl.innerHTML = emptyState('users', 'Nenhum lead encontrado.', filtered ? 'Experimente outra vista ou limpe os filtros.' : 'Quando alguém preencher o formulário ou falar com a Ava, aparece aqui.', filtered ? `<button class="btn" data-clear>Limpar filtros</button>` : `<button class="btn primary" data-new2>${icon('plus')}Novo lead</button>`);
      tableEl.querySelector('[data-clear]')?.addEventListener('click', () => { location.hash = '#/leads?view=all'; });
      tableEl.querySelector('[data-new2]')?.addEventListener('click', () => newLeadModal());
      drawBulk();
      return;
    }
    const th = (k, label, cls = '') => `<th class="sort ${cls}" data-sort="${k}"${sort === k ? ` aria-sort="${dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>${label}</th>`;
    tableEl.innerHTML = `<table class="t"><thead><tr><th class="cb"><input type="checkbox" data-all aria-label="Selecionar todos" ${selected.size && selected.size === list.length ? 'checked' : ''}></th>
      ${th('name', 'Lead')}${th('stage', 'Etapa')}<th>Origem</th>${th('owner', 'Responsável')}${th('next', 'Próxima tarefa')}${th('activity', 'Última atividade')}${th('value', 'Valor', 'num')}${th('created', 'Entrou')}</tr></thead><tbody>${list
      .map((l) => {
        const idle = daysSince(l.last_activity_at || l.created_at);
        const open = OPEN.includes(l.stage);
        return `<tr class="click${selected.has(l.id) ? ' sel' : ''}" data-id="${l.id}">
        <td class="cb"><input type="checkbox" data-sel="${l.id}" aria-label="Selecionar" ${selected.has(l.id) ? 'checked' : ''}></td>
        <td><div class="lead-cell">${avatar(l.name || l.email || '?', 'sm')}<span><a href="#/leads/${l.id}" class="name">${esc(l.name || l.email || 'Sem nome')}</a> ${qualTag(l.qualification)}<br><span class="sub">${esc([l.business, l.name ? l.email || l.phone : l.phone].filter(Boolean).join(' · ') || '—')}</span>${l.tags ? `<br><span class="row" style="gap:4px;margin-top:3px">${tagChips(l.tags, 3)}</span>` : ''}</span></div></td>
        <td>${stageTag(l.stage)}</td>
        <td>${srcTag(l.source)}</td>
        <td>${l.owner_name ? `<span class="who-line">${avatar(l.owner_name, 'xs')}${esc(l.owner_name.split(' ')[0])}</span>` : '<span class="faint">—</span>'}</td>
        <td class="nowrap">${open && l.next_action_at ? `<span class="${dueClass(l.next_action_at)}">${esc(dueLabel(l.next_action_at))}</span>` : open ? '<span class="faint">Sem tarefa</span>' : '<span class="faint">—</span>'}</td>
        <td class="nowrap">${l.last_activity_at ? `<span class="${open && idle >= STALE_DAYS ? 'due-today' : ''}">${ago(l.last_activity_at)}</span>` : '<span class="faint">Nenhuma</span>'}</td>
        <td class="num">${l.value_cents ? money(l.value_cents, l.currency) : '<span class="faint">—</span>'}</td>
        <td class="nowrap"><span title="${esc(date(l.created_at))}">${ago(l.created_at)}</span></td>
      </tr>`;
      })
      .join('')}</tbody></table>`;
    drawBulk();
  };

  const drawBulk = () => {
    if (!selected.size) { bulkEl.innerHTML = ''; return; }
    bulkEl.innerHTML = `<div class="bulkbar"><b>${selected.size} selecionado${selected.size === 1 ? '' : 's'}</b>
      <button class="btn sm" data-b="stage">${icon('flag')}Etapa</button>
      <button class="btn sm" data-b="owner">${icon('user')}Responsável</button>
      <button class="btn sm" data-b="tag">${icon('tag')}Etiqueta</button>
      ${isAdmin ? `<button class="btn sm danger" data-b="delete">${icon('trash')}Apagar</button>` : ''}
      <button class="btn sm icon" data-b="clear" aria-label="Limpar seleção">${icon('x')}</button></div>`;
  };

  const bulk = async (action, value, label) => {
    try {
      await api('/leads/bulk', { method: 'POST', body: { ids: [...selected], action, value } });
      toast(label);
      selected.clear();
      await load();
    } catch (e) { fail(e); }
  };
  bulkEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const k = b.dataset.b;
    if (k === 'clear') { selected.clear(); draw(); return; }
    if (k === 'stage') menu(b, STAGES.map(([s, l]) => ({ label: l, html: `<span class="stage st-${s}"></span>`, onClick: () => bulk('stage', s, `Movidos para ${l}`) })), { up: true });
    if (k === 'owner') menu(b, [{ label: 'Sem responsável', icon: 'user', onClick: () => bulk('owner', null, 'Responsável removido') }, 'sep', ...users.map((u) => ({ label: u.name, html: avatar(u.name, 'xs'), onClick: () => bulk('owner', u.id, `Atribuídos a ${u.name}`) }))], { up: true });
    if (k === 'tag') {
      modal({
        title: 'Etiqueta', submit: 'Aplicar',
        body: `<label class="field"><span>Etiqueta</span><input class="input" name="tag" list="bulk-tags" required maxlength="40"><datalist id="bulk-tags">${tagList.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist></label>
          <div class="seg" role="group"><button type="button" data-m="tag" aria-pressed="true">Adicionar</button><button type="button" data-m="untag" aria-pressed="false">Remover</button></div><input type="hidden" name="mode" value="tag">`,
        onOpen: (form) => form.querySelectorAll('[data-m]').forEach((x) => x.addEventListener('click', () => { form.querySelectorAll('[data-m]').forEach((y) => y.setAttribute('aria-pressed', String(y === x))); form.mode.value = x.dataset.m; })),
        onSubmit: async (form) => { const d = formData(form); if (!d.tag.trim()) throw new Error('Escreva a etiqueta.'); await bulk(d.mode, d.tag.trim(), d.mode === 'tag' ? 'Etiqueta adicionada' : 'Etiqueta removida'); },
      });
    }
    if (k === 'delete') {
      if (!(await confirmBox('Apagar leads', `Apagar <strong>${selected.size}</strong> lead${selected.size === 1 ? '' : 's'} e todo o histórico? Não dá para desfazer.`, 'Apagar'))) return;
      bulk('delete', null, 'Leads apagados');
    }
  });

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    const r = await api(`/leads?${query()}&limit=2000`);
    if (ctx.stale() || my !== seq) return;
    rows = r.leads;
    draw();
  };

  tableEl.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      if (sort === k) dir = dir === 'asc' ? 'desc' : 'asc';
      else { sort = k; dir = ['name', 'owner', 'next'].includes(k) ? 'asc' : 'desc'; }
      setPref('phs-l-sort', sort); setPref('phs-l-dir', dir);
      draw();
      return;
    }
    const all = e.target.closest('[data-all]');
    if (all) {
      const ids = [...tableEl.querySelectorAll('[data-sel]')].map((c) => Number(c.dataset.sel));
      if (all.checked) ids.forEach((id) => selected.add(id)); else selected.clear();
      draw();
      return;
    }
    const cb = e.target.closest('[data-sel]');
    if (cb) {
      const id = Number(cb.dataset.sel);
      cb.checked ? selected.add(id) : selected.delete(id);
      cb.closest('tr').classList.toggle('sel', cb.checked);
      drawBulk();
      return;
    }
    if (e.target.closest('td.cb')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('a')) location.hash = `#/leads/${tr.dataset.id}`;
  });
  ctx.page.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    f.view = b.dataset.view;
    setPref('phs-l-view', f.view);
    ctx.page.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load().catch(fail);
  }));
  const debounced = debounce(() => load().catch(fail), 250);
  ctx.page.querySelectorAll('[data-f]').forEach((el) =>
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      f[el.dataset.f] = el.value;
      el.tagName === 'INPUT' ? debounced() : load().catch(fail);
    }),
  );
  await load();
}

export { SERVICE_OPTIONS, SERVICES, tagsOf };
