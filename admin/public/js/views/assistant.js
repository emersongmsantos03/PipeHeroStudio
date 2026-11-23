// Assistente interno: perguntas sobre os números da empresa, respondidas pelo agente Qwen no PC do Emerson.
import { api, esc, icon, toast } from '../lib.js';

const history = [];   // conversa desta sessão do browser
const EXEMPLOS = ['Quanto faturamos este mês?', 'E comparado com o mês passado?', 'Se continuarmos a crescer neste ritmo, quanto faturamos em 1 ano?',
  'Quantos e-mails o prospector enviou esta semana?', 'Quais leads quentes estão parados há mais de 7 dias?', 'Cria uma tarefa para amanhã: ligar para o lead 12'];

function fmt(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

export async function render(ctx) {
  ctx.setTitle('Assistente', 'Pergunte pelos números, peça cálculos ou alterações no CRM e no financeiro');
  ctx.page.innerHTML = `
    <section class="card assist">
      <div class="card-h"><h2>${icon('bot')} Agente interno</h2><span class="badge" data-online>a verificar…</span></div>
      <div class="assist-log" data-log aria-live="polite"></div>
      <div class="assist-ex" data-ex>${EXEMPLOS.map((e) => `<button class="btn sm" type="button">${esc(e)}</button>`).join('')}</div>
      <form class="assist-form" data-form>
        <textarea class="input" data-q rows="2" maxlength="2000" placeholder="Ex.: quanto faturamos este mês comparado com o mês passado?" aria-label="Pergunta"></textarea>
        <button class="btn primary" data-send type="submit">${icon('chat')}<span class="lbl">Perguntar</span></button>
      </form>
      <p class="faint" style="margin:8px 0 0;font-size:12px">As contas são feitas pelo sistema com os dados reais. Exclusões e mudanças de valores pedem confirmação antes.</p>
    </section>`;
  const log = ctx.page.querySelector('[data-log]');
  const q = ctx.page.querySelector('[data-q]');
  const send = ctx.page.querySelector('[data-send]');
  const draw = () => {
    log.innerHTML = history.length ? history.map((m) => `<div class="msg ${m.role}">${m.pending ? '<span class="typing"><i></i><i></i><i></i></span>' : fmt(m.content)}</div>`).join('')
      : '<div class="empty"><b>Pergunte o que quiser sobre a empresa.</b>Faturamento, comparações, projeções, leads, tarefas, e-mails do prospector…</div>';
    log.scrollTop = log.scrollHeight;
  };
  draw();

  const status = async () => {
    try {
      const s = await api('/assistant/status');
      const b = ctx.page.querySelector('[data-online]');
      if (!b) return;
      b.textContent = s.online ? 'online' : 'offline (PC desligado?)';
      b.className = 'badge ' + (s.online ? 'won' : 'hot');
    } catch { /* ignora */ }
  };
  status();
  const timer = setInterval(() => { if (!document.body.contains(log)) return clearInterval(timer); status(); }, 20000);

  async function ask(text) {
    if (!text.trim()) return;
    history.push({ role: 'user', content: text.trim() });
    const pend = { role: 'assistant', content: '', pending: true };
    history.push(pend);
    draw();
    send.disabled = true;
    try {
      const prev = history.filter((m) => !m.pending).slice(-9, -1).map(({ role, content }) => ({ role, content }));
      const { id } = await api('/assistant', { method: 'POST', body: { question: text.trim(), history: prev } });
      const t0 = Date.now();
      while (Date.now() - t0 < 300000) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await api(`/assistant/${id}`);
        if (j.status === 'done' || j.status === 'error') { pend.content = j.answer || '(sem resposta)'; break; }
      }
      if (!pend.content) pend.content = 'O agente demorou demais a responder. Confirme se o PC está ligado.';
    } catch (e) {
      pend.content = 'Não consegui enviar a pergunta: ' + e.message;
      toast(e.message, true);
    }
    pend.pending = false;
    send.disabled = false;
    draw();
  }

  ctx.page.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); const t = q.value; q.value = ''; ask(t); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ctx.page.querySelector('[data-form]').requestSubmit(); } });
  ctx.page.querySelectorAll('[data-ex] button').forEach((b) => b.addEventListener('click', () => ask(b.textContent)));
}
