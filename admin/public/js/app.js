// Painel Pipe Hero Studio — arranque, login, menu, pesquisa global (⌘K) e rotas (#/…).
import { api, esc, icon, LOGO, setUnauthorizedHandler, toast, fail, avatar, menu, skeleton, withToday, getPref, setPref, stageTag, debounce } from './lib.js';
import * as dashboard from './views/dashboard.js';
import * as crm from './views/crm.js';
import * as lead from './views/lead.js';
import * as finance from './views/finance.js';
import * as agent from './views/agent.js';
import * as settings from './views/settings.js';
import * as tasks from './views/tasks.js';
import * as reports from './views/reports.js';
import * as templates from './views/templates.js';

applyTheme(getPref('phs-theme', 'auto'));

const root = document.getElementById('root');
export const state = { user: null, pendingUsers: 0, tasksDue: 0 };

const NAV = [
  { href: '#/', key: 'dashboard', label: 'Visão geral', icon: 'home' },
  { href: '#/tasks', key: 'tasks', label: 'Tarefas', icon: 'tasks', badge: () => state.tasksDue, red: true },
  { group: 'Vendas' },
  { href: '#/crm', key: 'crm', label: 'Pipeline', icon: 'board' },
  { href: '#/leads', key: 'leads', label: 'Leads', icon: 'list' },
  { href: '#/reports', key: 'reports', label: 'Relatórios', icon: 'chart' },
  { group: 'Gestão' },
  { href: '#/finance', key: 'finance', label: 'Financeiro', icon: 'money' },
  { href: '#/agent', key: 'agent', label: 'Ava e agentes', icon: 'bot' },
  { group: 'Configurar' },
  { href: '#/templates', key: 'templates', label: 'Modelos de mensagem', icon: 'template' },
  { href: '#/integrations', key: 'integrations', label: 'Integrações', icon: 'plug', admin: true },
  { href: '#/users', key: 'users', label: 'Usuários', icon: 'users', admin: true, badge: () => state.pendingUsers },
];

const ROUTES = [
  [/^\/?$/, 'dashboard', (c) => dashboard.render(c)],
  [/^\/tasks$/, 'tasks', (c) => tasks.render(c), false, 'list'],
  [/^\/crm$/, 'crm', (c) => crm.renderBoard(c), false, 'list'],
  [/^\/leads$/, 'leads', (c) => crm.renderList(c), false, 'list'],
  [/^\/leads\/(\d+)$/, 'leads', (c) => lead.render(c), false, 'list'],
  [/^\/reports$/, 'reports', (c) => reports.render(c)],
  [/^\/finance$/, 'finance', (c) => finance.render(c)],
  [/^\/agent$/, 'agent', (c) => agent.render(c)],
  [/^\/templates$/, 'templates', (c) => templates.render(c), false, 'list'],
  [/^\/integrations$/, 'integrations', (c) => settings.renderIntegrations(c), true, 'list'],
  [/^\/users$/, 'users', (c) => settings.renderUsers(c), true, 'list'],
  [/^\/account$/, 'account', (c) => settings.renderAccount(c), false, 'list'],
];

/* ---------- Tema ---------- */
export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else document.documentElement.removeAttribute('data-theme');
}
export function setTheme(t) { setPref('phs-theme', t); applyTheme(t); }
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

/* ---------- Login e cadastro ---------- */
function authPage(mode) {
  const login = mode === 'login';
  root.innerHTML = `<main class="auth">
    <aside class="auth-side">
      <div class="brand">${LOGO}<span>Pipe Hero<br>Studio</span></div>
      <h2>O seu negócio, <em>do primeiro contacto</em> ao pagamento.</h2>
      <ul>
        <li>${icon('board')}<span>Pipeline de vendas com tarefas, responsáveis e previsão de fecho</span></li>
        <li>${icon('bot')}<span>Leads da Ava e dos agentes entram sozinhos, já qualificados</span></li>
        <li>${icon('money')}<span>Financeiro, relatórios e resumo diário por e-mail</span></li>
      </ul>
    </aside>
    <div class="auth-main">
      <form class="auth-card" novalidate>
        <div class="brand">${LOGO}<span>Pipe Hero Studio</span></div>
        <div><h1>${login ? 'Bem-vindo de volta' : 'Pedir acesso'}</h1>
        <p class="muted" style="margin:6px 0 0">${login ? 'Entre para ver o seu CRM, tarefas e números.' : 'O acesso fica ativo depois de aprovado pelo administrador.'}</p></div>
        <div data-msg></div>
        ${login ? '' : `<label class="field"><span>Nome</span><input class="input" name="name" autocomplete="name" required maxlength="120"></label>`}
        <label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email" required placeholder="nome@empresa.com"></label>
        <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" required minlength="${login ? 1 : 8}">${login ? '' : '<small class="faint">8+ caracteres, com letras e números.</small>'}</label>
        ${login ? '' : `<label class="field"><span>Porque precisa de acesso? <span class="faint">(opcional)</span></span><input class="input" name="reason" maxlength="500"></label>
        <input name="website" tabindex="-1" autocomplete="off" class="sr" aria-hidden="true">`}
        <button class="btn primary" type="submit">${login ? 'Entrar' : 'Enviar pedido'}</button>
        <p class="auth-foot">${login ? 'Ainda não tem acesso? <a href="#/signup">Pedir acesso</a>' : 'Já tem conta? <a href="#/login">Entrar</a>'}</p>
      </form>
    </div>
  </main>`;
  const form = root.querySelector('form');
  const msg = root.querySelector('[data-msg]');
  form.querySelector('input').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const data = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true;
    msg.innerHTML = '';
    try {
      if (login) {
        await api('/auth/login', { method: 'POST', body: { email: data.email, password: data.password } });
        await boot(true);
      } else {
        await api('/auth/signup', { method: 'POST', body: data });
        form.innerHTML = `<div class="brand" style="display:flex">${LOGO}<span>Pipe Hero Studio</span></div><h1>Pedido enviado</h1>
          <p class="notice ok">${icon('check')}<span>Recebemos o seu pedido. Vai poder entrar assim que o acesso for aprovado.</span></p>
          <a class="btn" href="#/login">Voltar ao login</a>`;
      }
    } catch (err) {
      msg.innerHTML = `<p class="notice ${err.code === 'pending' ? 'warn' : 'err'}">${icon('alert')}<span>${esc(err.message)}</span></p>`;
      btn.disabled = false;
    }
  });
}

/* ---------- Estrutura ---------- */
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function shell() {
  const u = state.user;
  root.innerHTML = `<div class="shell">
    <aside class="side" aria-label="Menu">
      <a class="brand" href="#/">${LOGO}<span>Pipe Hero<br>Studio</span></a>
      <nav class="nav">${NAV.filter((n) => !n.admin || u.role === 'admin')
        .map((n) => (n.group ? `<div class="nav-label">${esc(n.group)}</div>` : `<a href="${n.href}" data-key="${n.key}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.badge ? `<span class="count${n.red ? ' red' : ''}" data-badge="${n.key}" hidden></span>` : ''}</a>`))
        .join('')}</nav>
      <div class="side-foot">
        <a class="side-site" href="https://pipeherostudio.digital" target="_blank" rel="noopener">${icon('globe')}pipeherostudio.digital</a>
        <button class="me" type="button" data-me aria-haspopup="menu" aria-expanded="false">${avatar(u.name)}<span><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'Administrador' : 'Membro'}</small></span>${icon('more')}</button>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="btn ghost icon menu-btn" type="button" data-menu aria-label="Abrir menu">${icon('menu')}</button>
        <button class="search-trigger" type="button" data-search>${icon('search')}<span>Procurar leads, páginas, ações…</span><span class="kbd">${isMac ? '⌘' : 'Ctrl'}</span><span class="kbd">K</span></button>
        <div class="end">
          <button class="btn ghost icon" type="button" data-theme-toggle aria-label="Mudar tema">${icon(isDark() ? 'sun' : 'moon')}</button>
          <button class="btn primary" type="button" data-create aria-haspopup="menu">${icon('plus')}<span class="lbl">Criar</span></button>
        </div>
      </header>
      <div class="phead"><div><h1 data-title></h1><div class="sub" data-sub></div></div><div class="actions" data-actions></div></div>
      <main class="page" data-page tabindex="-1"></main>
    </div>
  </div>`;
  const sh = root.querySelector('.shell');
  root.querySelector('[data-menu]').addEventListener('click', () => sh.classList.toggle('nav-open'));
  sh.addEventListener('click', (e) => {
    if (sh.classList.contains('nav-open') && (e.target.closest('.nav a') || !e.target.closest('.side, [data-menu]'))) sh.classList.remove('nav-open');
  });
  root.querySelector('[data-search]').addEventListener('click', openPalette);
  root.querySelector('[data-create]').addEventListener('click', (e) => menu(e.currentTarget, createItems(), { align: 'right' }));
  root.querySelector('[data-theme-toggle]').addEventListener('click', (e) => {
    setTheme(isDark() ? 'light' : 'dark');
    e.currentTarget.innerHTML = icon(isDark() ? 'sun' : 'moon');
  });
  root.querySelector('[data-me]').addEventListener('click', (e) => {
    const t = getPref('phs-theme', 'auto');
    menu(e.currentTarget, [
      { header: u.email },
      { label: 'Minha conta', icon: 'user', href: '#/account' },
      { label: 'Modelos de mensagem', icon: 'template', href: '#/templates' },
      'sep',
      { header: 'Tema' },
      { label: 'Automático', icon: 'layers', sel: t === 'auto', onClick: () => setTheme('auto') },
      { label: 'Claro', icon: 'sun', sel: t === 'light', onClick: () => setTheme('light') },
      { label: 'Escuro', icon: 'moon', sel: t === 'dark', onClick: () => setTheme('dark') },
      'sep',
      { label: 'Sair', icon: 'logout', danger: true, onClick: logout },
    ], { up: true });
  });
  updateBadge();
}

function createItems() {
  return [
    { label: 'Novo lead', icon: 'user', kbd: 'N', onClick: () => crm.newLeadModal() },
    { label: 'Nova tarefa', icon: 'tasks', kbd: 'T', onClick: () => tasks.taskModal({}, refreshAfterCreate) },
    'sep',
    { label: 'Nova receita', icon: 'trend', onClick: () => finance.txModal({ kind: 'income' }, refreshAfterCreate) },
    { label: 'Nova despesa', icon: 'money', onClick: () => finance.txModal({ kind: 'expense' }, refreshAfterCreate) },
    'sep',
    { label: 'Importar leads (CSV)', icon: 'upload', onClick: () => crm.importModal(refreshAfterCreate) },
  ];
}
function refreshAfterCreate() { refreshCounts(); route(); }

export function updateBadge() {
  for (const n of NAV) {
    if (!n.badge) continue;
    const b = root.querySelector(`[data-badge="${n.key}"]`);
    if (!b) continue;
    const v = n.badge();
    b.hidden = !v;
    b.textContent = v > 99 ? '99+' : v;
  }
}
/** Atualiza as contagens do menu (tarefas para hoje, cadastros pendentes). */
export async function refreshCounts() {
  try {
    const me = await api(withToday('/me'));
    state.pendingUsers = me.pendingUsers;
    state.tasksDue = me.tasksDue;
    updateBadge();
  } catch { /* ignora */ }
}

/* ---------- Pesquisa global (⌘K) ---------- */
let paletteOpen = false;
function openPalette() {
  if (paletteOpen || !state.user) return;
  paletteOpen = true;
  const d = document.createElement('dialog');
  d.className = 'palette';
  d.innerHTML = `<div class="palette-in">${icon('search')}<input type="text" placeholder="Procurar leads, páginas ou ações…" aria-label="Procurar" autocomplete="off" spellcheck="false"><span class="kbd">Esc</span></div>
    <div class="palette-list" role="listbox"></div>
    <div class="palette-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> navegar</span><span><span class="kbd">↵</span> abrir</span><span><span class="kbd">Esc</span> fechar</span></div>`;
  document.body.append(d);
  const input = d.querySelector('input');
  const list = d.querySelector('.palette-list');
  const close = () => { d.close(); d.remove(); paletteOpen = false; };
  d.addEventListener('close', () => { d.remove(); paletteOpen = false; });
  d.addEventListener('click', (e) => { if (e.target === d) close(); });

  const pages = NAV.filter((n) => !n.group && (!n.admin || state.user.role === 'admin')).map((n) => ({ group: 'Ir para', icon: n.icon, title: n.label, run: () => (location.hash = n.href) }));
  pages.push({ group: 'Ir para', icon: 'user', title: 'Minha conta', run: () => (location.hash = '#/account') });
  const actions = createItems().filter((x) => x !== 'sep').map((x) => ({ group: 'Criar', icon: x.icon, title: x.label, run: x.onClick }));
  let items = [];
  let sel = 0;
  let leads = [];
  let seq = 0;

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const match = (x) => !q || x.title.toLowerCase().includes(q);
    items = [...leads, ...pages.filter(match), ...actions.filter(match)];
    if (!q) items = [...pages, ...actions];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let last = '';
    list.innerHTML = items.length
      ? items.map((it, i) => {
          const head = it.group !== last ? `<div class="palette-group">${esc(it.group)}</div>` : '';
          last = it.group;
          return `${head}<div class="palette-item" role="option" data-i="${i}" aria-selected="${i === sel}">${it.html || icon(it.icon)}<span class="pi-main"><span>${esc(it.title)}</span>${it.sub ? `<div class="pi-sub">${esc(it.sub)}</div>` : ''}</span>${it.end || ''}</div>`;
        }).join('')
      : `<div class="palette-empty">Nada encontrado para “${esc(input.value)}”.</div>`;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { leads = []; draw(); return; }
    try {
      const r = await api(`/leads?q=${encodeURIComponent(q)}&limit=8`);
      if (my !== seq) return;
      leads = r.leads.map((l) => ({
        group: 'Leads', html: avatar(l.name || l.email || '?', 'sm'), title: l.name || l.email || l.phone || `Lead #${l.id}`,
        sub: [l.business, l.email, l.phone].filter(Boolean).join(' · '), end: stageTag(l.stage), run: () => (location.hash = `#/leads/${l.id}`),
      }));
      sel = 0;
      draw();
    } catch { /* ignora */ }
  }, 180);
  const run = (i) => { const it = items[i]; if (!it) return; close(); it.run(); };
  input.addEventListener('input', () => { sel = 0; draw(); search(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  list.addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) run(Number(el.dataset.i)); });
  list.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-i]');
    if (el && Number(el.dataset.i) !== sel) { sel = Number(el.dataset.i); list.querySelectorAll('[aria-selected]').forEach((x) => x.setAttribute('aria-selected', String(x === el))); }
  });
  draw();
  d.showModal();
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key.toLowerCase() === 'n') { e.preventDefault(); crm.newLeadModal(); }
  else if (e.key.toLowerCase() === 't') { e.preventDefault(); tasks.taskModal({}, refreshAfterCreate); }
});

/* ---------- Rotas ---------- */
let renderSeq = 0;
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  if (!state.user) return authPage(path === '/signup' ? 'signup' : 'login');
  if (path === '/login' || path === '/signup') { location.hash = '#/'; return; }
  if (!root.querySelector('.shell')) shell();

  const found = ROUTES.find(([re]) => re.test(path));
  const page = root.querySelector('[data-page]');
  const title = root.querySelector('[data-title]');
  const sub = root.querySelector('[data-sub]');
  const actions = root.querySelector('[data-actions]');
  if (!found || (found[3] && state.user.role !== 'admin')) {
    title.textContent = 'Página não encontrada';
    sub.textContent = '';
    actions.innerHTML = '';
    page.innerHTML = `<div class="card">${'<div class="empty"><span class="e-ico">' + icon('alert') + '</span><b>Esta página não existe.</b><a class="btn" href="#/">Voltar à visão geral</a></div>'}</div>`;
    return;
  }
  const [re, key, fn, , sk] = found;
  root.querySelectorAll('.nav a').forEach((a) => (a.dataset.key === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const seq = ++renderSeq;
  page.classList.remove('fade-in');
  page.innerHTML = skeleton(sk || 'dash');
  actions.innerHTML = '';
  const ctx = {
    page,
    params: path.match(re).slice(1),
    query: new URLSearchParams(qs || ''),
    state,
    stale: () => seq !== renderSeq,
    setTitle: (t, s = '') => { title.textContent = t; sub.innerHTML = s; document.title = `${t} · Painel Pipe Hero Studio`; },
    setActions: (html) => { actions.innerHTML = html; return actions; },
    refresh: () => route(),
    refreshCounts,
  };
  try {
    await fn(ctx);
    if (seq === renderSeq) { void page.offsetWidth; page.classList.add('fade-in'); }
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) return;
    console.error(e);
    page.innerHTML = `<div class="card"><div class="empty"><span class="e-ico">${icon('alert')}</span><b>Não foi possível carregar.</b><span>${esc(e.message)}</span><button class="btn" data-retry>${icon('refresh')}Tentar de novo</button></div></div>`;
    page.querySelector('[data-retry]').addEventListener('click', route);
  }
  page.focus({ preventScroll: true });
}

async function boot(fromLogin = false) {
  try {
    const me = await api(withToday('/me'));
    state.user = me.user;
    state.pendingUsers = me.pendingUsers;
    state.tasksDue = me.tasksDue;
    if (fromLogin) toast(`Olá, ${me.user.name.split(' ')[0]}!`);
  } catch (e) {
    state.user = null;
    if (e.status !== 401) fail(e);
  }
  root.innerHTML = '';
  route();
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignora */ }
  state.user = null;
  location.hash = '#/login';
  root.innerHTML = '';
  route();
}

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  toast('A sessão expirou. Entre novamente.', true);
  root.innerHTML = '';
  route();
});
addEventListener('hashchange', route);
// Volta a contar as tarefas quando o separador regressa ao primeiro plano.
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refreshCounts(); });
boot();

