// Painel Pipe Hero Studio — arranque, login, menu e rotas (#/…).
import { api, esc, icon, initials, LOGO, setUnauthorizedHandler, toast, fail } from './lib.js';
import * as dashboard from './views/dashboard.js';
import * as crm from './views/crm.js';
import * as lead from './views/lead.js';
import * as finance from './views/finance.js';
import * as agent from './views/agent.js';
import * as settings from './views/settings.js';

try {
  const t = localStorage.getItem('phs-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* sem armazenamento: segue o sistema */ }

const root = document.getElementById('root');
export const state = { user: null, pendingUsers: 0 };

const NAV = [
  { href: '#/', key: 'dashboard', label: 'Visão geral', icon: 'home' },
  { href: '#/crm', key: 'crm', label: 'CRM', icon: 'board' },
  { href: '#/leads', key: 'leads', label: 'Leads', icon: 'list' },
  { href: '#/finance', key: 'finance', label: 'Financeiro', icon: 'money' },
  { href: '#/agent', key: 'agent', label: 'Ava e agentes', icon: 'bot' },
  { group: 'Administração', admin: true },
  { href: '#/integrations', key: 'integrations', label: 'Integrações', icon: 'plug', admin: true },
  { href: '#/users', key: 'users', label: 'Usuários', icon: 'users', admin: true, badge: () => state.pendingUsers },
];

const ROUTES = [
  [/^\/?$/, 'dashboard', (c) => dashboard.render(c)],
  [/^\/crm$/, 'crm', (c) => crm.renderBoard(c)],
  [/^\/leads$/, 'leads', (c) => crm.renderList(c)],
  [/^\/leads\/(\d+)$/, 'leads', (c) => lead.render(c)],
  [/^\/finance$/, 'finance', (c) => finance.render(c)],
  [/^\/agent$/, 'agent', (c) => agent.render(c)],
  [/^\/integrations$/, 'integrations', (c) => settings.renderIntegrations(c), true],
  [/^\/users$/, 'users', (c) => settings.renderUsers(c), true],
  [/^\/account$/, 'account', (c) => settings.renderAccount(c)],
];

/* ---------- Login e cadastro ---------- */
function authPage(mode) {
  const login = mode === 'login';
  root.innerHTML = `<main class="auth">
    <form class="auth-card" novalidate>
      <div class="brand">${LOGO}<span>Pipe Hero Studio</span></div>
      <div><h1>${login ? 'Entrar no painel' : 'Pedir acesso'}</h1>
      <p class="muted" style="margin:6px 0 0">${login ? 'CRM, leads, financeiro e métricas da Ava.' : 'O acesso fica ativo depois de aprovado pelo administrador.'}</p></div>
      <div data-msg></div>
      ${login ? '' : `<label class="field"><span>Nome</span><input class="input" name="name" autocomplete="name" required maxlength="120"></label>`}
      <label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" required minlength="${login ? 1 : 8}">${login ? '' : '<small class="faint">8+ caracteres, com letras e números.</small>'}</label>
      ${login ? '' : `<label class="field"><span>Porque precisa de acesso? <span class="faint">(opcional)</span></span><input class="input" name="reason" maxlength="500"></label>
      <input name="website" tabindex="-1" autocomplete="off" class="sr" aria-hidden="true">`}
      <button class="btn primary" type="submit" style="min-height:42px">${login ? 'Entrar' : 'Enviar pedido'}</button>
      <p class="auth-foot">${login ? 'Ainda não tem acesso? <a href="#/signup">Pedir acesso</a>' : 'Já tem conta? <a href="#/login">Entrar</a>'}</p>
    </form>
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
        form.innerHTML = `<div class="brand">${LOGO}<span>Pipe Hero Studio</span></div><h1>Pedido enviado</h1>
          <p class="notice ok">Recebemos o seu pedido. Vai poder entrar assim que o acesso for aprovado.</p>
          <a class="btn" href="#/login">Voltar ao login</a>`;
      }
    } catch (err) {
      msg.innerHTML = `<p class="notice ${err.code === 'pending' ? 'warn' : 'err'}">${esc(err.message)}</p>`;
      btn.disabled = false;
    }
  });
}

/* ---------- Estrutura ---------- */
function shell() {
  const u = state.user;
  root.innerHTML = `<div class="shell">
    <aside class="side" aria-label="Menu">
      <a class="brand" href="#/">${LOGO}<span>Pipe Hero<br>Studio</span></a>
      <nav class="nav">${NAV.filter((n) => !n.admin || u.role === 'admin')
        .map((n) => (n.group ? `<div class="nav-label">${esc(n.group)}</div>` : `<a href="${n.href}" data-key="${n.key}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.badge ? '<span class="count" data-badge hidden></span>' : ''}</a>`))
        .join('')}</nav>
      <div class="side-foot">
        <a class="side-site" href="https://pipeherostudio.digital" target="_blank" rel="noopener">${'pipeherostudio.digital ↗'}</a>
        <a class="me" href="#/account" data-key="account"><span class="avatar">${esc(initials(u.name))}</span><span><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'Administrador' : 'Membro'}</small></span></a>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="btn ghost menu-btn" type="button" data-menu aria-label="Abrir menu">${icon('menu')}</button>
        <div><h1 data-title></h1><div class="sub" data-sub></div></div>
        <div class="actions" data-actions></div>
      </header>
      <main class="page" data-page tabindex="-1"></main>
    </div>
  </div>`;
  const sh = root.querySelector('.shell');
  root.querySelector('[data-menu]').addEventListener('click', () => sh.classList.toggle('nav-open'));
  sh.addEventListener('click', (e) => {
    if (sh.classList.contains('nav-open') && (e.target.closest('.nav a, .me') || !e.target.closest('.side, [data-menu]'))) sh.classList.remove('nav-open');
  });
  updateBadge();
}

export function updateBadge() {
  const b = root.querySelector('[data-badge]');
  if (!b) return;
  b.hidden = !state.pendingUsers;
  b.textContent = state.pendingUsers;
}

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
    page.innerHTML = `<div class="card empty"><b>Esta página não existe.</b><a class="btn" href="#/">Voltar à visão geral</a></div>`;
    return;
  }
  const [re, key, fn] = found;
  root.querySelectorAll('.nav a, .me').forEach((a) => (a.dataset.key === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const seq = ++renderSeq;
  page.innerHTML = '<div class="boot" style="min-height:40vh"><span class="spinner"></span></div>';
  actions.innerHTML = '';
  sub.textContent = '';
  const ctx = {
    page,
    params: path.match(re).slice(1),
    query: new URLSearchParams(qs || ''),
    state,
    stale: () => seq !== renderSeq,
    setTitle: (t, s = '') => { title.textContent = t; sub.textContent = s; document.title = `${t} · Painel Pipe Hero Studio`; },
    setActions: (html) => { actions.innerHTML = html; return actions; },
    refresh: () => route(),
  };
  try {
    await fn(ctx);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) return;
    page.innerHTML = `<div class="card empty"><b>Não foi possível carregar.</b>${esc(e.message)}<div style="margin-top:12px"><button class="btn" data-retry>${icon('refresh')}Tentar de novo</button></div></div>`;
    page.querySelector('[data-retry]').addEventListener('click', route);
  }
  page.focus({ preventScroll: true });
}

async function boot(fromLogin = false) {
  try {
    const me = await api('/me');
    state.user = me.user;
    state.pendingUsers = me.pendingUsers;
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
boot();
