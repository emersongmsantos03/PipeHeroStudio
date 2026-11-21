/* Chat de IA: interface, histórico na sessão e respostas em streaming de /api/chat. */

type Msg = { role: 'user' | 'assistant'; content: string };
type Strings = {
  greeting: string; chips: string[]; err: string; rate: string; long: string; sent: string; email: string; lang: string;
};
type State = { sid: string; messages: Msg[]; leadSent: boolean };

const KEY = 'phs-chat';
const MARK_LEAD = '[[PHS:LEAD_SENT]]';
const MARK_ERR = '[[PHS:ERROR]]';

let root: HTMLElement;
let S: Strings;
let state: State;
let panel: HTMLElement, launch: HTMLButtonElement, log: HTMLElement, form: HTMLFormElement, input: HTMLTextAreaElement, send: HTMLButtonElement;
let busy = false;
let ready = false;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Markdown mínimo e seguro: **negrito**, listas, links e e-mails. */
function md(text: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+[a-z])/gi, '$1<a href="mailto:$2">$2</a>');
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

function save() {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sem armazenamento */ }
}
function load(): State {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.messages) && s.messages.length) return s;
  } catch { /* ignora */ }
  return { sid: crypto.randomUUID().replace(/-/g, ''), messages: [{ role: 'assistant', content: S.greeting }], leadSent: false };
}

function bubble(role: Msg['role'] | 'err', content: string, isNew = true): HTMLElement {
  const el = document.createElement('div');
  el.className = `cb-msg ${role === 'user' ? 'is-me' : role === 'err' ? 'is-err' : 'is-ai'}${isNew ? ' is-new' : ''}`;
  if (role === 'user') el.textContent = content;
  else el.innerHTML = md(content);
  log.appendChild(el);
  return el;
}
function sys(text: string) {
  const el = document.createElement('p');
  el.className = 'cb-sys';
  el.textContent = '✓ ' + text;
  log.appendChild(el);
}
function chips() {
  log.querySelector('.cb-chips')?.remove();
  if (state.messages.length !== 1) return;
  const box = document.createElement('div');
  box.className = 'cb-chips';
  for (const c of S.chips) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cb-chip';
    b.textContent = c;
    b.addEventListener('click', () => submit(c));
    box.appendChild(b);
  }
  log.appendChild(box);
}
const toBottom = () => { log.scrollTop = log.scrollHeight; };

function renderAll() {
  log.replaceChildren();
  for (const m of state.messages) bubble(m.role, m.content, false);
  if (state.leadSent) sys(S.sent);
  chips();
  requestAnimationFrame(toBottom);
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

async function submit(text: string) {
  const content = text.trim().slice(0, 1000);
  if (!content || busy) return;
  busy = true;
  send.disabled = true;
  log.querySelector('.cb-chips')?.remove();
  state.messages.push({ role: 'user', content });
  save();
  bubble('user', content);
  input.value = '';
  autosize();

  const out = bubble('assistant', '');
  out.innerHTML = '<span class="cb-typing" aria-hidden="true"><i></i><i></i><i></i></span>';
  out.setAttribute('aria-busy', 'true');
  toBottom();

  let reply = '';
  let failed = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages, lang: S.lang, page: location.pathname, sessionId: state.sid, leadSent: state.leadSent }),
    });
    if (!res.ok || !res.body) {
      failed = res.status === 429 ? S.rate : res.status === 413 ? S.long : S.err;
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let raf = 0;
      const paint = () => { raf = 0; out.innerHTML = md(reply) || out.innerHTML; toBottom(); };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += dec.decode(value, { stream: true });
        if (reply.includes(MARK_LEAD)) {
          reply = reply.split(MARK_LEAD).join('');
          if (!state.leadSent) { state.leadSent = true; sys(S.sent); }
        }
        if (reply.includes(MARK_ERR)) { reply = reply.split(MARK_ERR).join(''); failed = S.err; }
        if (!raf && reply.trim()) raf = requestAnimationFrame(paint);
      }
      reply = reply.trim();
      if (raf) cancelAnimationFrame(raf);
      if (reply) out.innerHTML = md(reply);
    }
  } catch {
    failed = S.err;
  }

  out.removeAttribute('aria-busy');
  if (reply) {
    state.messages.push({ role: 'assistant', content: reply });
  } else {
    out.remove();
  }
  if (failed && !reply) bubble('err', failed.replace('{email}', S.email));
  // Se o resumo foi enviado, o aviso fica depois da resposta.
  const pill = log.querySelector('.cb-sys');
  if (pill && state.leadSent && pill !== log.lastElementChild) log.appendChild(pill);
  save();
  busy = false;
  send.disabled = false;
  toBottom();
  input.focus({ preventScroll: true });
}

export function init(el: HTMLElement) {
  if (ready) return;
  ready = true;
  root = el;
  S = JSON.parse(root.dataset.i18n || '{}');
  panel = root.querySelector('[data-chat-panel]')!;
  launch = root.querySelector('[data-chat-launch]')!;
  log = root.querySelector('[data-chat-log]')!;
  form = root.querySelector('[data-chat-form]')!;
  input = root.querySelector('[data-chat-input]')!;
  send = root.querySelector('[data-chat-send]')!;
  state = load();
  renderAll();

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); }
  });
  root.querySelector('[data-chat-close]')!.addEventListener('click', () => close());
  root.querySelector('[data-chat-reset]')!.addEventListener('click', () => {
    if (busy) return;
    state = { sid: crypto.randomUUID().replace(/-/g, ''), messages: [{ role: 'assistant', content: S.greeting }], leadSent: false };
    save();
    renderAll();
    input.focus();
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

export function open(focus = true) {
  panel.hidden = false;
  launch.setAttribute('aria-expanded', 'true');
  try { sessionStorage.setItem('phs-chat-open', '1'); } catch { /* sem armazenamento */ }
  requestAnimationFrame(toBottom);
  if (focus) input.focus({ preventScroll: true });
}

export function close() {
  panel.hidden = true;
  launch.setAttribute('aria-expanded', 'false');
  try { sessionStorage.setItem('phs-chat-open', '0'); } catch { /* sem armazenamento */ }
  launch.focus();
}

export function toggle() {
  if (panel.hidden) open(); else close();
}
