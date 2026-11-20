/* Gancho do hero: o mini-site monta-se enquanto a pessoa escreve. Tudo no navegador. */
import { PALETTE, initials, isBizType, type BizType } from '../lib/minisite';

type TypeText = { label: string; tagline: string; cta: string; sections: string[][] };
type Data = {
  types: Record<BizType, TypeText>;
  examples: { name: string; type: BizType }[];
  example: string;
  yourPreview: string;
  live: string;
};

const root = document.querySelector<HTMLElement>('[data-builder-root]');
if (root) {
  const data: Data = JSON.parse(root.querySelector('[data-builder-data]')!.textContent || '{}');
  const ms = root.querySelector<HTMLElement>('[data-ms]')!;
  const form = root.querySelector<HTMLFormElement>('[data-builder]')!;
  const nameIn = root.querySelector<HTMLInputElement>('[data-builder-name]')!;
  const typeIn = root.querySelector<HTMLSelectElement>('[data-builder-type]')!;
  const badge = root.querySelector<HTMLElement>('[data-builder-badge]')!;
  const live = root.querySelector<HTMLElement>('[data-builder-live]')!;
  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-example]'));
  const q = (sel: string) => ms.querySelector<HTMLElement>(sel)!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current: BizType = ms.dataset.type as BizType;

  const render = (name: string, type: BizType, animate: boolean) => {
    const tp = data.types[type];
    const p = PALETTE[type];
    ms.dataset.type = type;
    ms.style.cssText = `--ms-bg:${p.bg};--ms-fg:${p.fg};--ms-muted:${p.muted};--ms-accent:${p.accent};--ms-on:${p.on}`;
    q('[data-ms-logo]').textContent = initials(name);
    q('[data-ms-brand]').textContent = name;
    const n = q('[data-ms-name]');
    n.textContent = name;
    n.classList.toggle('is-long', name.length > 16 && name.length <= 26);
    n.classList.toggle('is-xlong', name.length > 26);
    q('[data-ms-kicker]').textContent = tp.label;
    q('[data-ms-tag]').textContent = tp.tagline;
    q('[data-ms-cta]').textContent = tp.cta;
    if (type !== current || animate) {
      const list = q('[data-ms-list]');
      list.replaceChildren(
        ...tp.sections.map(([h, s]) => {
          const li = document.createElement('li');
          const b = document.createElement('b');
          const sp = document.createElement('span');
          b.textContent = h;
          sp.textContent = s;
          li.append(b, sp);
          return li;
        }),
      );
    }
    if (animate && !reduced) {
      // Reinicia a animação sem forçar o layout da página.
      ms.classList.remove('is-building');
      requestAnimationFrame(() => requestAnimationFrame(() => ms.classList.add('is-building')));
    }
    current = type;
  };

  const setDots = (i: number) => dots.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));

  // Exemplos: mostra os 3 uma vez e para no primeiro. Nunca em loop.
  let idx = 0;
  let steps = 0;
  let timer = 0;
  const showExample = (i: number) => {
    idx = i;
    const e = data.examples[i];
    render(e.name, e.type, true);
    badge.textContent = data.example;
    setDots(i);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = 0; } };
  if (!reduced && data.examples.length > 1) {
    timer = window.setInterval(() => {
      steps += 1;
      showExample((idx + 1) % data.examples.length);
      if (steps >= data.examples.length) stop();
    }, 3600);
  }
  dots.forEach((b, i) => b.addEventListener('click', () => { stop(); nameIn.value = ''; showExample(i); }));

  let liveTimer = 0;
  const update = () => {
    stop();
    const typed = nameIn.value.trim();
    const type = isBizType(typeIn.value) ? typeIn.value : 'other';
    const fallback = data.examples.find((e) => e.type === type)?.name || data.types[type].label;
    const typeChanged = type !== current;
    render(typed || fallback, type, typeChanged);
    badge.textContent = typed ? data.yourPreview : data.example;
    setDots(-1);
    clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => {
      live.textContent = data.live.replace('{name}', typed || fallback).replace('{type}', data.types[type].label);
    }, 900);
  };
  nameIn.addEventListener('input', update);
  typeIn.addEventListener('change', update);
  nameIn.addEventListener('focus', stop);

  // Leva o nome e o tipo para o formulário da landing de Sites.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const typed = nameIn.value.trim();
    if (typed) params.set('nome', typed);
    params.set('tipo', typeIn.value);
    location.href = `${form.getAttribute('action')}?${params.toString()}#pedido`;
  });
}
