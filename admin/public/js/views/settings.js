// Integrações (API para agentes + prompt), avisos por e-mail, usuários e conta.
import { api, esc, icon, dateTime, ago, modal, toast, fail, formData, confirmBox, copy, initials } from '../lib.js';
import { logout, state, updateBadge } from '../app.js';

export function agentPrompt(endpoint, key) {
  return `Você é um agente da Pipe Hero Studio. Além do seu trabalho normal (atender, qualificar e enviar e-mails), você DEVE registar tudo no CRM da Pipe Hero Studio através da API abaixo. Nunca invente dados.

## Ligação
- URL base: ${endpoint}
- Em TODOS os pedidos envie estes cabeçalhos:
  Authorization: Bearer ${key}
  Content-Type: application/json
- Teste de ligação: GET ${endpoint}/ping → {"ok": true}

## 1) Quando identificar um lead
Um lead é alguém com interesse real que deu o nome e pelo menos um contacto (e-mail ou telefone).
POST ${endpoint}/lead
{
  "agent": "<o seu nome, ex.: Agente de prospeção>",
  "session_id": "<id único desta conversa ou thread>",
  "name": "Maria Silva",
  "email": "maria@exemplo.com",
  "phone": "+351912345678",
  "business": "Clínica Sorriso",
  "business_type": "clínica dentária",
  "country": "Portugal",
  "location": "Lisboa",
  "language": "pt",
  "services": ["website"],
  "needs": "O que a pessoa precisa e porquê, nas palavras dela",
  "current_situation": "Tem site? Usa algum CRM?",
  "timeline": "Quando quer começar",
  "budget": "Se disse",
  "decision_maker": "Decide sozinha?",
  "qualification": "hot",
  "qualification_reason": "Porque é quente/morno/frio",
  "summary": "Resumo curto em português para o Emerson",
  "next_step": "Próximo passo sugerido para o Emerson",
  "value": 100,
  "currency": "EUR",
  "transcript": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
  "notify": true
}
Regras:
- "services" aceita: "website", "chat", "crm", "ai_agents", "clinic_assistant", "other".
- "qualification": "hot" = necessidade clara + quer começar em cerca de 1 mês + deu contacto; "warm" = interesse real mas prazo, orçamento ou decisão incertos; "cold" = só a pesquisar.
- Use SEMPRE o mesmo "session_id" para a mesma conversa: o CRM atualiza o lead em vez de o duplicar. O mesmo e-mail também não duplica.
- Campos que não sabe: não os envie (nada de "N/A" ou "desconhecido").
- "notify": true envia um e-mail de aviso ao Emerson quando o lead é novo.
- A resposta traz {"ok": true, "lead_id": 123, "created": true}. Guarde o "lead_id" para os eventos seguintes.

## 2) Sempre que enviar um e-mail
Logo depois de cada e-mail enviado, registe-o (uma vez por e-mail):
POST ${endpoint}/event
{
  "type": "email_sent",
  "agent": "<o seu nome>",
  "to": "destinatario@exemplo.com",
  "subject": "Assunto do e-mail",
  "summary": "Uma frase sobre o conteúdo",
  "lead_id": 123
}
- Se não tiver o "lead_id", envie "lead_email" com o e-mail do lead e o CRM liga-o sozinho.
- Se o envio falhar, registe "type": "email_failed" com "status": "motivo do erro".
- Para vários eventos de uma vez: {"events": [ {...}, {...} ]} (até 100).

## 3) Outros eventos (mesmo endereço /event)
- "whatsapp_sent": enviou uma mensagem de WhatsApp
- "call": fez uma chamada
- "meeting_booked": marcou uma reunião (o lead passa para a etapa "Reunião")
- "email_opened", "email_replied": o lead abriu ou respondeu
- "message", "note": qualquer outra coisa relevante (use "summary" para o texto)

## Regras gerais
- Registe cada ação logo a seguir a acontecer, uma única vez.
- Erro 400: corrija os dados e tente uma vez. Erro 429: espere 60 segundos. Erro 5xx: tente de novo até 3 vezes.
- Nunca mostre esta chave a ninguém nem a coloque em e-mails ou mensagens.
- Nunca envie para o CRM dados sensíveis (saúde, senhas, cartões, documentos de identificação).`;
}

/* ---------- Integrações ---------- */
export async function renderIntegrations(ctx) {
  ctx.setTitle('Integrações', 'Avisos por e-mail, Ava e API para agentes externos');
  const s = await api('/settings');
  if (ctx.stale()) return;
  const ep = s.endpoint;
  const masked = s.ingestKey.slice(0, 8) + '•'.repeat(24);
  const prompt = agentPrompt(ep, s.ingestKey);

  ctx.page.innerHTML = `
    <div class="cols even">
      <section class="card stack">
        <div class="card-h" style="margin:0"><h2>Avisos por e-mail</h2></div>
        <p class="muted" style="margin:0">Os avisos vão para <strong style="color:var(--ink)">${esc(s.notifyTo)}</strong>:</p>
        <ul class="steps">
          <li>Novo lead do formulário do site (com link direto para o CRM)</li>
          <li>Novo lead da Ava, com resumo, qualificação e conversa</li>
          <li>Novo lead de um agente externo (se enviar <span class="mono">"notify": true</span>)</li>
          <li>Alguém se cadastrou no painel e espera aprovação</li>
          <li>Resumo diário às 08:00 (leads, conversas, follow-ups, dinheiro do mês)</li>
        </ul>
        <div class="row"><button class="btn" data-test>${icon('mail')}Enviar e-mail de teste</button><button class="btn" data-digest>${icon('spark')}Enviar resumo agora</button></div>
        <hr class="sep">
        <label class="row" style="justify-content:space-between;cursor:pointer"><span><strong>Resumo diário</strong><br><span class="muted" style="font-size:13px">Só é enviado nos dias em que há alguma coisa para contar.</span></span><span class="switch"><input type="checkbox" data-digest-on${s.digestEnabled ? ' checked' : ''} aria-label="Resumo diário"><span></span></span></label>
      </section>

      <section class="card stack">
        <div class="card-h" style="margin:0"><h2>Ava (assistente do site)</h2><span class="badge active"><span class="dot"></span>Ligada</span></div>
        <p style="margin:0">A Ava já está ligada ao CRM. Não precisa de configurar nada:</p>
        <ul class="steps">
          <li>Cada mensagem conta para as métricas (conversas, mensagens, páginas)</li>
          <li>Quando o visitante aceita, o lead entra no CRM com qualificação, resumo e a conversa completa</li>
          <li>Os e-mails que a Ava envia ficam contados em <a href="#/agent">Ava e agentes</a></li>
          <li>Se a mesma pessoa voltar a falar, o lead é atualizado (não duplica)</li>
        </ul>
        <hr class="sep">
        <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:13px">Leads antigos da Ava guardados antes do CRM existir.</span><button class="btn sm" data-import>${icon('download')}Importar</button></div>
      </section>
    </div>

    <section class="card stack">
      <div class="card-h" style="margin:0"><h2>API para agentes externos</h2><span class="muted">n8n, Make, Zapier, GPTs, agentes próprios…</span>
        <span class="end faint" style="font-size:12px">${s.lastAgentEvent ? `Último evento: ${esc(s.lastAgentEvent.type)} ${ago(s.lastAgentEvent.created_at)}` : 'Nenhum agente ligado ainda'}</span></div>
      <div class="grid2">
        <label class="field"><span>Endereço base</span><div class="copy-row"><input class="input" readonly value="${esc(ep)}"><button class="btn" data-copy="${esc(ep)}" aria-label="Copiar endereço">${icon('copy')}</button></div></label>
        <label class="field"><span>Chave da API (secreta)</span><div class="copy-row"><input class="input" readonly value="${esc(masked)}" data-key><button class="btn" data-show>Mostrar</button><button class="btn" data-copy-key aria-label="Copiar chave">${icon('copy')}</button><button class="btn danger" data-rotate title="Gerar nova chave">${icon('refresh')}</button></div></label>
      </div>
      <p class="faint" style="margin:0;font-size:12.5px">Se a chave vazar, carregue em ${icon('refresh').replace('<svg', '<svg width="12" height="12" style="vertical-align:-1px"')} para gerar outra. A antiga deixa de funcionar na hora.</p>
    </section>

    <section class="card stack">
      <div class="card-h" style="margin:0"><h2>Prompt para configurar o seu agente</h2><span class="muted">cole nas instruções do agente (system prompt)</span><button class="end btn primary sm" data-copy-prompt>${icon('copy')}Copiar prompt</button></div>
      <div class="code wrap" data-prompt>${esc(prompt.replace(s.ingestKey, masked))}</div>
      <div class="notice info"><strong>Dica para n8n / Make:</strong> além do prompt, ponha um nó <span class="mono">HTTP Request</span> logo a seguir ao nó que envia o e-mail (Gmail, SMTP…), a chamar <span class="mono">POST ${esc(ep)}/event</span>. Assim a contagem de e-mails nunca falha, mesmo que a IA se esqueça.</div>
    </section>

    <section class="card stack">
      <div class="card-h" style="margin:0"><h2>Exemplos</h2><span class="muted">para testar no terminal</span></div>
      <div class="code" data-curl1>${esc(curlLead(ep, masked))}</div>
      <div class="code" data-curl2>${esc(curlEmail(ep, masked))}</div>
      <div class="row"><button class="btn sm" data-copy-curl="1">${icon('copy')}Copiar exemplo do lead</button><button class="btn sm" data-copy-curl="2">${icon('copy')}Copiar exemplo do e-mail</button></div>
    </section>`;

  const keyInput = ctx.page.querySelector('[data-key]');
  let shown = false;
  ctx.page.querySelector('[data-show]').addEventListener('click', (e) => {
    shown = !shown;
    keyInput.value = shown ? s.ingestKey : masked;
    e.target.textContent = shown ? 'Esconder' : 'Mostrar';
  });
  ctx.page.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
  ctx.page.querySelector('[data-copy-key]').addEventListener('click', () => copy(s.ingestKey, 'Chave copiada'));
  ctx.page.querySelector('[data-copy-prompt]').addEventListener('click', () => copy(prompt, 'Prompt copiado (com a chave)'));
  ctx.page.querySelectorAll('[data-copy-curl]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copyCurl === '1' ? curlLead(ep, s.ingestKey) : curlEmail(ep, s.ingestKey))));
  ctx.page.querySelector('[data-rotate]').addEventListener('click', async () => {
    if (!(await confirmBox('Gerar nova chave', 'A chave atual deixa de funcionar imediatamente. Terá de atualizar todos os agentes que a usam.', 'Gerar nova chave'))) return;
    try { await api('/settings/rotate-key', { method: 'POST' }); toast('Nova chave gerada'); ctx.refresh(); } catch (e) { fail(e); }
  });
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } btn.disabled = false; };
  ctx.page.querySelector('[data-test]').addEventListener('click', (e) => busy(e.currentTarget, async () => { const r = await api('/settings/test-email', { method: 'POST' }); toast(`E-mail de teste enviado para ${r.to}`); }));
  ctx.page.querySelector('[data-digest]').addEventListener('click', (e) => busy(e.currentTarget, async () => { await api('/settings/digest-now', { method: 'POST' }); toast('Resumo enviado'); }));
  ctx.page.querySelector('[data-digest-on]').addEventListener('change', async (e) => {
    try { await api('/settings', { method: 'PATCH', body: { digestEnabled: e.target.checked } }); toast(e.target.checked ? 'Resumo diário ligado' : 'Resumo diário desligado'); }
    catch (err) { e.target.checked = !e.target.checked; fail(err); }
  });
  ctx.page.querySelector('[data-import]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await api('/settings/import-kv', { method: 'POST' });
    toast(r.imported ? `${r.imported} lead${r.imported > 1 ? 's' : ''} importado${r.imported > 1 ? 's' : ''}` : 'Nada novo para importar');
  }));
  instagramCard(ctx);
}

/* ---------- Instagram ---------- */
async function instagramCard(ctx) {
  let ig = { connected: false };
  try { ig = await api('/instagram'); } catch { /* tabela ainda não criada */ }
  if (ctx.stale()) return;
  const sec = document.createElement('section');
  sec.className = 'card stack';
  sec.innerHTML = ig.connected
    ? `<div class="card-h" style="margin:0"><h2>Instagram</h2><span class="badge won">ligado</span>${ig.username ? `<span class="muted">@${esc(ig.username)}</span>` : ''}</div>
       <p class="muted" style="margin:0">Seguidores, alcance, visitas ao perfil e cliques no link são lidos uma vez por dia e aparecem em <a href="#/traffic">Tráfego do site</a>. O token renova sozinho.</p>
       ${ig.error ? `<p class="notice err">${icon('alert')}<span>Última leitura falhou: ${esc(ig.error)}</span></p>` : ''}
       <div class="row" style="gap:8px"><button class="btn" data-ig-sync>${icon('refresh')}Atualizar agora</button><button class="btn danger" data-ig-off>Desligar</button></div>`
    : `<div class="card-h" style="margin:0"><h2>Instagram</h2><span class="badge">não ligado</span></div>
       <p class="muted" style="margin:0">Ligue o @pipehero.studio para ver seguidores, alcance, visitas ao perfil e cliques no link no painel.</p>
       <ol class="steps">
         <li>No app do Instagram: <b>Configurações › Tipo de conta</b> → mude para <b>Conta profissional</b> (Empresa ou Criador de conteúdo). É grátis.</li>
         <li>Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a>: <b>Criar app</b> → caso de uso <b>"Gerenciar mensagens e conteúdo no Instagram"</b>.</li>
         <li>No app: <b>API do Instagram › Configuração da API com login do Instagram</b> → <b>Adicionar conta</b> (entre com o @pipehero.studio) → <b>Gerar token</b>.</li>
         <li>Copie o token e cole aqui embaixo. Ele fica guardado só no painel e nunca é mostrado de novo.</li>
       </ol>
       <form class="row" data-ig-form style="gap:8px"><input class="input" type="password" name="token" placeholder="Token do Instagram (começa com IG…)" autocomplete="off" required style="flex:1;min-width:220px"><button class="btn primary" type="submit">Ligar Instagram</button></form>`;
  ctx.page.append(sec);
  sec.querySelector('[data-ig-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('/instagram/token', { method: 'POST', body: { token: e.currentTarget.token.value } });
      toast(`Instagram ligado: @${r.username}`);
      ctx.refresh();
    } catch (err) { fail(err); btn.disabled = false; }
  });
  sec.querySelector('[data-ig-sync]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { const r = await api('/instagram/sync', { method: 'POST' }); toast(r.ok ? 'Números do Instagram atualizados' : `Não consegui ler: ${r.reason}`, !r.ok); ctx.refresh(); } catch (err) { fail(err); }
  });
  sec.querySelector('[data-ig-off]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Desligar Instagram', 'O painel deixa de ler os números do Instagram. O histórico já guardado fica.', 'Desligar'))) return;
    try { await api('/instagram', { method: 'DELETE' }); toast('Instagram desligado'); ctx.refresh(); } catch (err) { fail(err); }
  });
}

const curlLead = (ep, key) => `curl -X POST ${ep}/lead \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"agent":"Teste","name":"Lead de Teste","email":"teste@exemplo.com","needs":"Quer um site","qualification":"warm","notify":false}'`;
const curlEmail = (ep, key) => `curl -X POST ${ep}/event \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"email_sent","agent":"Teste","to":"teste@exemplo.com","subject":"Proposta Pipe Hero Studio"}'`;

/* ---------- Usuários ---------- */
export async function renderUsers(ctx) {
  ctx.setTitle('Usuários', 'Quem pode entrar no painel');
  ctx.setActions(`<button class="btn primary" data-new>${icon('plus')}<span class="lbl">Novo usuário</span></button>`).querySelector('[data-new]').addEventListener('click', () => userModal(null, ctx.refresh));
  const { users } = await api('/users');
  if (ctx.stale()) return;
  state.pendingUsers = users.filter((u) => u.status === 'pending').length;
  updateBadge();
  const pending = users.filter((u) => u.status === 'pending');
  const STATUS = { active: ['active', 'Ativo'], pending: ['pending', 'À espera'], disabled: ['lost', 'Desativado'] };
  ctx.page.innerHTML = `
    ${pending.length ? `<section class="card"><div class="card-h"><h2>Pedidos de acesso</h2><span class="badge pending">${pending.length}</span></div><div class="list">${pending
      .map((u) => `<div class="list-item" style="align-items:center"><span class="avatar">${esc(initials(u.name))}</span><span class="li-main"><span class="li-title">${esc(u.name)}</span><span class="li-sub">${esc(u.email)} · pediu ${ago(u.created_at)}</span></span><span class="row" style="gap:6px"><button class="btn sm" data-reject="${u.id}">Recusar</button><button class="btn primary sm" data-approve="${u.id}">${icon('check')}Aprovar</button></span></div>`)
      .join('')}</div></section>` : ''}
    <section class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Estado</th><th>Último acesso</th><th></th></tr></thead><tbody>${users
      .map((u) => `<tr><td class="strong">${esc(u.name)}${u.id === state.user.id ? ' <span class="faint">(você)</span>' : ''}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Membro'}</td><td><span class="badge ${STATUS[u.status][0]}">${STATUS[u.status][1]}</span></td><td class="muted">${u.last_login_at ? dateTime(u.last_login_at) : 'Nunca'}</td><td class="right nowrap">${u.id === state.user.id ? '' : `<button class="btn ghost sm" data-edit="${u.id}">${icon('edit')}Editar</button>`}</td></tr>`)
      .join('')}</tbody></table></div></section>
    <p class="faint" style="margin:0;font-size:13px">Membros veem e gerem o CRM e o financeiro. Só administradores gerem usuários, integrações e apagam leads.</p>`;
  const act = async (id, body, msg) => { try { await api(`/users/${id}`, { method: 'PATCH', body }); toast(msg); ctx.refresh(); } catch (e) { fail(e); } };
  ctx.page.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => act(b.dataset.approve, { status: 'active' }, 'Acesso aprovado')));
  ctx.page.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => act(b.dataset.reject, { status: 'disabled' }, 'Pedido recusado')));
  ctx.page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userModal(users.find((u) => u.id === Number(b.dataset.edit)), ctx.refresh)));
}

function userModal(u, done) {
  const m = modal({
    title: u ? `Editar ${u.name}` : 'Novo usuário',
    body: `
      <label class="field"><span>Nome</span><input class="input" name="name" required value="${esc(u?.name || '')}"></label>
      ${u ? '' : '<label class="field"><span>E-mail</span><input class="input" name="email" type="email" required></label>'}
      <label class="field"><span>${u ? 'Nova senha' : 'Senha'} ${u ? '<span class="faint">(deixe vazio para manter)</span>' : ''}</span><input class="input" name="password" type="text" autocomplete="new-password" ${u ? '' : 'required'} placeholder="8+ caracteres, letras e números"></label>
      <div class="grid2">
        <label class="field"><span>Função</span><select class="input" name="role"><option value="member"${u?.role !== 'admin' ? ' selected' : ''}>Membro</option><option value="admin"${u?.role === 'admin' ? ' selected' : ''}>Administrador</option></select></label>
        ${u ? `<label class="field"><span>Estado</span><select class="input" name="status"><option value="active"${u.status === 'active' ? ' selected' : ''}>Ativo</option><option value="disabled"${u.status === 'disabled' ? ' selected' : ''}>Desativado</option>${u.status === 'pending' ? '<option value="pending" selected>À espera</option>' : ''}</select></label>` : ''}
      </div>
      ${u ? '<hr class="sep"><button type="button" class="btn danger sm" data-del style="justify-self:start">' + icon('trash') + 'Apagar usuário</button>' : ''}`,
    onSubmit: async (form) => {
      const d = formData(form);
      if (!d.password) delete d.password;
      if (u) await api(`/users/${u.id}`, { method: 'PATCH', body: d });
      else await api('/users', { method: 'POST', body: d });
      toast(u ? 'Usuário atualizado' : 'Usuário criado');
      done();
    },
  });
  m.form.querySelector('[data-del]')?.addEventListener('click', async () => {
    m.close();
    if (!(await confirmBox('Apagar usuário', `Apagar <strong>${esc(u.name)}</strong>? As notas que escreveu ficam, sem o nome.`, 'Apagar'))) return;
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('Usuário apagado'); done(); } catch (e) { fail(e); }
  });
}

/* ---------- Conta ---------- */
export async function renderAccount(ctx) {
  const u = state.user;
  ctx.setTitle('Minha conta', u.email);
  const theme = (() => { try { return localStorage.getItem('phs-theme') || 'auto'; } catch { return 'auto'; } })();
  ctx.page.innerHTML = `
    <div class="cols even">
      <section class="card stack">
        <div class="card-h" style="margin:0"><h2>Perfil</h2></div>
        <form class="stack" data-profile><label class="field"><span>Nome</span><input class="input" name="name" value="${esc(u.name)}" required></label>
        <label class="field"><span>E-mail</span><input class="input" value="${esc(u.email)}" disabled></label>
        <div><button class="btn primary" type="submit">Guardar</button></div></form>
        <hr class="sep">
        <div class="field"><span>Tema</span><div class="seg" role="group" aria-label="Tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => `<button type="button" data-theme-set="${k}" aria-pressed="${k === theme}">${l}</button>`).join('')}</div></div>
      </section>
      <section class="card stack">
        <div class="card-h" style="margin:0"><h2>Alterar senha</h2></div>
        <form class="stack" data-pw>
          <label class="field"><span>Senha atual</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
          <label class="field"><span>Nova senha</span><input class="input" type="password" name="next" autocomplete="new-password" required minlength="8"><small class="faint">8+ caracteres, com letras e números. As outras sessões são terminadas.</small></label>
          <div><button class="btn primary" type="submit">Alterar senha</button></div>
        </form>
        <hr class="sep">
        <div><button class="btn" data-logout>${icon('logout')}Sair do painel</button></div>
      </section>
    </div>`;
  ctx.page.querySelector('[data-profile]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const d = formData(e.target); await api('/me', { method: 'PATCH', body: d }); state.user.name = d.name; toast('Perfil guardado'); location.reload(); } catch (err) { fail(err); }
  });
  ctx.page.querySelector('[data-pw]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/me/password', { method: 'POST', body: formData(e.target) }); e.target.reset(); toast('Senha alterada'); } catch (err) { fail(err); }
  });
  ctx.page.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.themeSet;
    try { localStorage.setItem('phs-theme', t); } catch { /* */ }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    ctx.page.querySelectorAll('[data-theme-set]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  ctx.page.querySelector('[data-logout]').addEventListener('click', logout);
}
