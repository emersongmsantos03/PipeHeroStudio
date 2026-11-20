/* Formulário: pré-preenchimento, validação e envio (webhook n8n ou /api/contact na Cloudflare). */

type Msgs = {
  required: string; email: string; phone: string; privacy: string; fix: string;
  sending: string; successTitle: string; successText: string; fail: string; localOnly: string;
  prefill: string; types: Record<string, string>;
};

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const isLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function init(form: HTMLFormElement) {
  const m: Msgs = JSON.parse(form.dataset.i18n || '{}');
  const root = form.closest('[data-form-root]')!;
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const success = root.querySelector<HTMLElement>('[data-success]')!;
  const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;

  const q = new URLSearchParams(location.search);

  // Regresso de um envio sem JavaScript (o Worker redireciona com ?enviado=1 / ?sent=1).
  if (q.get('enviado') === '1' || q.get('sent') === '1') {
    success.querySelector('[data-success-title]')!.textContent = m.successTitle.replace(/,?\s*\{name\}/, '');
    success.querySelector('[data-success-text]')!.textContent = m.successText;
    form.hidden = true;
    success.hidden = false;
    return;
  }

  // Pré-preenchimento vindo do hero: ?nome=…&tipo=…
  const nome = (q.get('nome') || '').slice(0, 80).trim();
  const tipo = q.get('tipo') || '';
  const tipoLabel = m.types[tipo];
  if (nome || tipoLabel) {
    if (nome) el('negocio').value = nome;
    if (tipoLabel) el('tipo').value = tipo;
    const svc = el('servico') as unknown as HTMLSelectElement;
    if (!svc.value) svc.value = 'site';
    const box = form.querySelector<HTMLElement>('[data-prefill]');
    if (box && nome) {
      box.textContent = fill(m.prefill, { name: nome, type: tipoLabel || '—' });
      box.hidden = false;
    }
  }

  function setError(input: HTMLInputElement, msg: string) {
    const box = document.getElementById(input.id + '-error');
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (box) box.textContent = msg;
  }

  function check(): HTMLInputElement | null {
    let first: HTMLInputElement | null = null;
    const mark = (input: HTMLInputElement, msg: string) => {
      setError(input, msg);
      if (msg && !first) first = input;
    };
    for (const n of ['nome', 'negocio', 'pais', 'servico', 'mensagem']) {
      const i = el(n);
      mark(i, i.value.trim() ? '' : m.required);
    }
    const em = el('email').value.trim();
    mark(el('email'), !em ? m.required : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em) ? '' : m.email);
    const ph = el('telefone').value.trim();
    mark(el('telefone'), ph && ph.replace(/\D/g, '').length < 9 ? m.phone : '');
    mark(el('privacidade'), el('privacidade').checked ? '' : m.privacy);
    return first;
  }

  form.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.getAttribute('aria-invalid') === 'true') check();
  });
  form.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.getAttribute('aria-invalid') === 'true') check();
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    status.textContent = '';
    const first = check();
    if (first) {
      status.textContent = m.fix;
      (first as HTMLInputElement).focus();
      return;
    }
    const data = new URLSearchParams();
    new FormData(form).forEach((v, k) => data.append(k, String(v).trim()));
    const name = el('nome').value.trim().split(/\s+/)[0];

    const done = () => {
      success.querySelector('[data-success-title]')!.textContent = fill(m.successTitle, { name });
      success.querySelector('[data-success-text]')!.textContent = m.successText;
      form.hidden = true;
      success.hidden = false;
      success.focus();
    };

    // Honeypot preenchido: fingimos sucesso e não enviamos nada.
    if (data.get('bot-field')) return done();

    const label = submit.innerHTML;
    submit.disabled = true;
    submit.textContent = m.sending;
    try {
      const res = await fetch(form.dataset.endpoint || '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: data.toString(),
      });
      // Em `npm run dev` (só Astro) não existe /api/contact: avisa em vez de dar erro.
      if (res.status === 404 && isLocal) {
        status.textContent = m.localOnly;
        submit.disabled = false;
        submit.innerHTML = label;
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      done();
    } catch {
      status.textContent = m.fail;
      submit.disabled = false;
      submit.innerHTML = label;
    }
  });
}

document.querySelectorAll<HTMLFormElement>('form[data-form]').forEach(init);
