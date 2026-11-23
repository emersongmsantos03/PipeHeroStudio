// Modelos de mensagem (WhatsApp / e-mail) com variáveis. Usados no botão "Mensagem" da ficha do lead.
import { api, esc, icon, modal, toast, fail, formData, confirmBox, emptyState, TEMPLATE_VARS, fillTemplate, ago } from '../lib.js';
import { resetTemplates } from './lead.js';

const CH = { any: ['template', 'WhatsApp e e-mail'], whatsapp: ['whatsapp', 'WhatsApp'], email: ['mail', 'E-mail'] };
const SAMPLE = { name: 'Maria Silva', business: 'Clínica Sorriso' };

export async function render(ctx) {
  ctx.setTitle('Modelos de mensagem', 'Textos prontos para WhatsApp e e-mail, preenchidos com os dados do lead');
  ctx.setActions(`<button class="btn primary" data-new>${icon('plus')}<span class="lbl">Novo modelo</span></button>`)
    .querySelector('[data-new]').addEventListener('click', () => tplModal({}, done));
  const done = () => { resetTemplates(); ctx.refresh(); };
  const { templates } = await api('/templates');
  if (ctx.stale()) return;
  const me = ctx.state.user;

  ctx.page.innerHTML = `
    <p class="notice info">${icon('spark')}<span>Na ficha de cada lead, carregue em <strong>Mensagem</strong>, escolha um modelo e o texto abre já preenchido no WhatsApp ou no e-mail. O envio fica registado no histórico. Variáveis: ${TEMPLATE_VARS.map(([v]) => `<span class="mono">${v}</span>`).join(' ')}</span></p>
    ${templates.length ? `<div class="tpl-grid">${templates.map((t) => `<section class="card tpl">
        <div class="card-h" style="margin:0"><span class="ico">${icon(CH[t.channel]?.[0] || 'template')}</span><h2>${esc(t.name)}</h2><span class="end"><button class="btn ghost xs icon" data-edit="${t.id}" aria-label="Editar">${icon('edit')}</button><button class="btn ghost xs icon" data-del="${t.id}" aria-label="Apagar">${icon('trash')}</button></span></div>
        <span class="faint" style="font-size:12.5px">${CH[t.channel]?.[1] || ''}${t.subject ? ` · Assunto: ${esc(fillTemplate(t.subject, SAMPLE, me))}` : ''}</span>
        <div class="tpl-body">${esc(fillTemplate(t.body, SAMPLE, me))}</div>
        <span class="faint" style="font-size:12px">${t.user_name ? `Criado por ${esc(t.user_name)} · ` : ''}${ago(t.created_at)}</span>
      </section>`).join('')}</div>`
      : `<div class="card">${emptyState('template', 'Ainda não há modelos.', 'Crie textos para o primeiro contacto, follow-up e propostas.', '<button class="btn primary" data-new2>Criar modelo</button>')}</div>`}`;

  ctx.page.querySelector('[data-new2]')?.addEventListener('click', () => tplModal({}, done));
  ctx.page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => tplModal(templates.find((t) => t.id === Number(b.dataset.edit)), done)));
  ctx.page.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const t = templates.find((x) => x.id === Number(b.dataset.del));
    if (!(await confirmBox('Apagar modelo', `Apagar o modelo “${esc(t.name)}”?`, 'Apagar'))) return;
    try { await api(`/templates/${t.id}`, { method: 'DELETE' }); toast('Modelo apagado'); done(); } catch (e) { fail(e); }
  }));
}

async function tplModal(t, done) {
  const me = (await import('../app.js')).state.user;
  modal({
    title: t.id ? 'Editar modelo' : 'Novo modelo',
    wide: true,
    submit: t.id ? 'Guardar' : 'Criar modelo',
    body: `
      <div class="grid2">
        <label class="field"><span>Nome</span><input class="input" name="name" required maxlength="80" value="${esc(t.name || '')}" placeholder="Ex.: Primeiro contacto"></label>
        <label class="field"><span>Canal</span><select class="input" name="channel">${Object.entries(CH).map(([k, [, l]]) => `<option value="${k}"${(t.channel || 'any') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field" data-subj><span>Assunto do e-mail <span class="faint">(opcional)</span></span><input class="input" name="subject" maxlength="200" value="${esc(t.subject || '')}"></label>
      <label class="field"><span>Mensagem</span><textarea class="input" name="body" required maxlength="4000" style="min-height:160px">${esc(t.body || '')}</textarea></label>
      <div class="var-chips"><span class="faint" style="font-size:12.5px;align-self:center">Inserir:</span>${TEMPLATE_VARS.map(([v, l]) => `<button type="button" data-var="${v}" title="${l}">${v}</button>`).join('')}</div>
      <div class="field"><span>Pré-visualização (exemplo: ${esc(SAMPLE.name)}, ${esc(SAMPLE.business)})</span><div class="preview-msg" data-prev></div></div>`,
    onOpen: (form) => {
      const prev = form.querySelector('[data-prev]');
      const upd = () => {
        prev.textContent = fillTemplate(form.body.value, SAMPLE, me) || '…';
        form.querySelector('[data-subj]').hidden = form.channel.value === 'whatsapp';
      };
      form.body.addEventListener('input', upd);
      form.channel.addEventListener('change', upd);
      form.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
        const ta = form.body;
        const s = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, s) + b.dataset.var + ta.value.slice(ta.selectionEnd ?? s);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = s + b.dataset.var.length;
        upd();
      }));
      upd();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      if (t.id) await api(`/templates/${t.id}`, { method: 'PATCH', body: d });
      else await api('/templates', { method: 'POST', body: d });
      toast(t.id ? 'Modelo guardado' : 'Modelo criado');
      done();
    },
  });
}
