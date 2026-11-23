// Ava — assistente interna do painel (widget flutuante no canto inferior direito, em todas as páginas).
// As perguntas vão para a fila do painel e são respondidas pelo agente Qwen no PC do Emerson.
import { api, esc, icon } from './lib.js';

const KEY = 'phs-ava-chat';
const SUGESTOES = [
  'Quanto faturamos este mês?',
  'Compare com o mês passado',
  'Projeção de faturamento para 12 meses',
  'Quantos e-mails o prospector enviou hoje?',
  'Leads quentes parados há 7+ dias',
  'Quem clicou nos e-mails esta semana?',
];

let el = null;
let msgs = [];
let busy = false;
let online = null;

const load = () => { try { msgs = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { msgs = []; } };
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))); } catch { /* sem armazenamento */ } };
const hora = (t) => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

/** Markdown leve: **negrito**, listas com - ou •, quebras de linha. */
function md(t) {
  const linhas = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, '$1<strong>$2</strong>').split('\n');
  let html = '', lista = false;
  for (const l of linhas) {
    const m = l.match(/^\s*(?:[-•·]|\d+[.)])\s+(.*)$/);
    if (m) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${m[1]}</li>`; continue; }
    if (lista) { html += '</ul>'; lista = false; }
    html += l.trim() ? `<p>${l}</p>` : '';
  }
  return html + (lista ? '</ul>' : '');
}

function bolha(m) {
  if (m.role === 'user') return `<div class="ava-row me"><div class="ava-b me">${md(m.content)}<time>${hora(m.t)}</time></div></div>`;
  return `<div class="ava-row"><img class="ava-av sm" src="/ava.svg" alt=""><div class="ava-b ${m.erro ? 'err' : ''}">${m.pending
    ? '<span class="ava-typing" aria-label="A Ava está a escrever"><i></i><i></i><i></i></span>' : md(m.content) + `<time>${hora(m.t)}</time>`}</div></div>`;
}

function desenhar() {
  const log = el.querySelector('[data-log]');
  log.innerHTML = msgs.length ? msgs.map(bolha).join('') : `
    <div class="ava-hello">
      <img class="ava-av lg" src="/ava.svg" alt="">
      <h3>Olá! Eu sou a Ava.</h3>
      <p>Consulto os números da Pipe Hero em tempo real: faturamento, CRM, financeiro, e-mails do prospector, visitas ao site. Também crio tarefas e atualizo leads.</p>
    </div>`;
  el.querySelector('[data-sug]').hidden = msgs.length > 0;
  log.scrollTop = log.scrollHeight;
  el.querySelector('[data-send]').disabled = busy;
}

async function estado() {
  try {
    const s = await api('/assistant/status');
    online = !!s.online;
  } catch { online = false; }
  if (!el) return;
  el.querySelector('[data-dot]').className = 'ava-dot ' + (online ? 'on' : 'off');
  el.querySelector('[data-st]').textContent = online ? 'online · responde em segundos' : 'offline · o PC do agente está desligado';
  el.querySelector('[data-launch-dot]').className = 'ava-dot ' + (online ? 'on' : 'off');
}

async function perguntar(texto) {
  texto = texto.trim();
  if (!texto || busy) return;
  busy = true;
  msgs.push({ role: 'user', content: texto, t: Date.now() });
  const p = { role: 'assistant', content: '', pending: true, t: Date.now() };
  msgs.push(p);
  desenhar();
  try {
    const hist = msgs.filter((m) => !m.pending && !m.erro).slice(-9, -1).map(({ role, content }) => ({ role, content }));
    const { id } = await api('/assistant', { method: 'POST', body: { question: texto, history: hist } });
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await api(`/assistant/${id}`);
      if (j.status === 'done' || j.status === 'error') { p.content = j.answer || 'Sem resposta.'; p.erro = j.status === 'error'; break; }
    }
    if (!p.content) { p.content = 'Demorei demais a responder. Confirme se o PC do agente está ligado e tente de novo.'; p.erro = true; }
  } catch (e) {
    p.content = 'Não consegui enviar a pergunta: ' + e.message;
    p.erro = true;
  }
  p.pending = false;
  p.t = Date.now();
  busy = false;
  save();
  desenhar();
  el.querySelector('[data-q]').focus();
}

export function abrirAva() {
  if (!el) return;
  el.classList.add('open');
  el.querySelector('[data-q]').focus();
  desenhar();
  estado();
}

function fechar() { el.classList.remove('open'); el.querySelector('[data-launch]').focus(); }

export function montarAva() {
  if (el && document.body.contains(el)) return;
  load();
  el = document.createElement('div');
  el.className = 'ava';
  el.innerHTML = `
    <section class="ava-panel" role="dialog" aria-label="Ava, assistente interna" aria-modal="false">
      <header class="ava-h">
        <img class="ava-av" src="/ava.svg" alt="">
        <div class="ava-id"><strong>Ava</strong><span><i class="ava-dot" data-dot></i><span data-st>a verificar…</span></span></div>
        <button class="ava-ic" type="button" data-new title="Nova conversa" aria-label="Nova conversa">${icon('refresh')}</button>
        <button class="ava-ic" type="button" data-close title="Fechar" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="ava-log" data-log aria-live="polite"></div>
      <div class="ava-sug" data-sug>${SUGESTOES.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>
      <form class="ava-f" data-form>
        <textarea data-q rows="1" maxlength="2000" placeholder="Pergunte à Ava…" aria-label="Mensagem para a Ava"></textarea>
        <button type="submit" data-send aria-label="Enviar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg></button>
      </form>
      <p class="ava-foot">Dados reais · alterações importantes pedem confirmação</p>
    </section>
    <button class="ava-launch" type="button" data-launch aria-label="Falar com a Ava">
      <img src="/ava.svg" alt=""><i class="ava-dot" data-launch-dot></i>
      <span class="ava-x">${icon('x')}</span>
    </button>`;
  document.body.append(el);

  const q = el.querySelector('[data-q]');
  const auto = () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; };
  q.addEventListener('input', auto);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('[data-form]').requestSubmit(); } });
  el.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); const t = q.value; q.value = ''; auto(); perguntar(t); });
  el.querySelector('[data-launch]').addEventListener('click', () => (el.classList.contains('open') ? fechar() : abrirAva()));
  el.querySelector('[data-close]').addEventListener('click', fechar);
  el.querySelector('[data-new]').addEventListener('click', () => { if (busy) return; msgs = []; save(); desenhar(); q.focus(); });
  el.querySelectorAll('[data-sug] button').forEach((b) => b.addEventListener('click', () => perguntar(b.textContent)));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('open')) fechar(); });
  desenhar();
  estado();
  setInterval(() => { if (document.visibilityState === 'visible') estado(); }, 30000);
}
