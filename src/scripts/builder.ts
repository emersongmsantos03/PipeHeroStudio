/* Gancho do hero: o mini-site monta-se enquanto a pessoa escreve. Tudo no navegador. */
import { campaignFromQuery } from '../../shared/campaign';
import { PALETTE, domainFor, initials, isBizType, type BizType } from '../lib/minisite';

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
  const exampleButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-example]'));
  const q = (sel: string) => ms.querySelector<HTMLElement>(sel)!;
  const setAll = (sel: string, text: string) => ms.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.textContent = text));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current: BizType = ms.dataset.type as BizType;

  const render = (name: string, type: BizType, animate: boolean) => {
    const tp = data.types[type];
    const p = PALETTE[type];
    ms.dataset.type = type;
    ms.style.cssText = `--ms-bg:${p.bg};--ms-fg:${p.fg};--ms-muted:${p.muted};--ms-accent:${p.accent};--ms-on:${p.on}`;
    setAll('[data-ms-logo]', initials(name));
    setAll('[data-ms-brand]', name);
    setAll('[data-ms-domain]', domainFor(name, ms.dataset.lang || 'en'));
    const n = q('[data-ms-name]');
    n.textContent = name;
    n.classList.toggle('is-long', name.length > 15 && name.length <= 24);
    n.classList.toggle('is-xlong', name.length > 24);
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

  const selectExample = (type: BizType) => exampleButtons.forEach((button, i) => {
    button.setAttribute('aria-pressed', String(data.examples[i].type === type));
  });

  exampleButtons.forEach((button, i) => button.addEventListener('click', () => {
    typeIn.value = data.examples[i].type;
    update();
  }));

  let liveTimer = 0;
  const update = () => {
    const typed = nameIn.value.trim();
    const type = isBizType(typeIn.value) ? typeIn.value : 'other';
    const fallback = data.examples.find((e) => e.type === type)?.name || data.types[type].label;
    const typeChanged = type !== current;
    render(typed || fallback, type, typeChanged);
    badge.textContent = typed ? data.yourPreview : data.example;
    selectExample(type);
    clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => {
      live.textContent = data.live.replace('{name}', typed || fallback).replace('{type}', data.types[type].label);
    }, 900);
  };
  nameIn.addEventListener('input', update);
  typeIn.addEventListener('change', update);

  // Leva o nome e o tipo para o formulário da landing de Sites.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = new URL(form.action);
    for (const [key, value] of Object.entries(campaignFromQuery(location.search))) url.searchParams.set(key, value);
    const typed = nameIn.value.trim();
    if (typed) url.searchParams.set('nome', typed);
    url.searchParams.set('tipo', typeIn.value);
    location.href = url.href;
  });
}
