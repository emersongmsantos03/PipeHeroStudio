// Página "Marcar chamada": fuso → dia → hora → dados → confirmação.
type T = Record<string, any>;
const root = document.querySelector<HTMLElement>('[data-book]');
if (root) {
  const t: T = JSON.parse(root.dataset.i18n || '{}');
  const $ = <E extends Element = HTMLElement>(s: string) => root.querySelector<E>(s)!;
  const steps = { pick: $('[data-step="pick"]'), form: $<HTMLFormElement>('[data-step="form"]'), done: $('[data-step="done"]') };
  const tzSel = $<HTMLSelectElement>('[data-tz]');
  const daysEl = $('[data-days]');
  const timesEl = $('[data-times]');
  let slots: string[] = [];
  let minutes = 15;
  let day = '';
  let chosen = '';

  const guess = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  // lista curta e com nomes que as pessoas reconhecem (em vez das ~400 zonas do navegador)
  const GROUPS: [string, [string, string][]][] = [
    [t.tzGroups?.na || 'United States & Canada', [
      ['America/New_York', 'Eastern Time (New York, Miami, Toronto)'], ['America/Chicago', 'Central Time (Chicago, Dallas, Houston)'],
      ['America/Denver', 'Mountain Time (Denver, Salt Lake City)'], ['America/Phoenix', 'Arizona (Phoenix)'],
      ['America/Los_Angeles', 'Pacific Time (Los Angeles, Seattle, Vancouver)'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
      ['America/Halifax', 'Atlantic Time (Halifax)']]],
    [t.tzGroups?.eu || 'UK & Europe', [
      ['Europe/London', 'London'], ['Europe/Dublin', 'Dublin'], ['Europe/Lisbon', 'Lisbon'], ['Europe/Madrid', 'Madrid, Paris, Berlin, Rome']]],
    [t.tzGroups?.la || 'Latin America', [
      ['America/Sao_Paulo', 'Brasília (São Paulo, Rio, Curitiba)'], ['America/Mexico_City', 'Mexico City'], ['America/Bogota', 'Bogotá, Lima'],
      ['America/Argentina/Buenos_Aires', 'Buenos Aires'], ['America/Santiago', 'Santiago']]],
    [t.tzGroups?.oc || 'Australia & New Zealand', [
      ['Australia/Sydney', 'Sydney, Melbourne, Canberra'], ['Australia/Brisbane', 'Brisbane'], ['Australia/Adelaide', 'Adelaide'],
      ['Australia/Perth', 'Perth'], ['Pacific/Auckland', 'Auckland, Wellington']]],
  ];
  const now = new Date();
  const hora = (z: string) => { try { return new Intl.DateTimeFormat(t.locale, { timeZone: z, hour: 'numeric', minute: '2-digit' }).format(now); } catch { return ''; } };
  const offMin = (z: string) => {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(now);
      const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
      return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - now.getTime()) / 60000);
    } catch { return NaN; }
  };
  // se o fuso detetado não está na lista, usa o da lista com a mesma hora agora (ou mostra-o à parte)
  const known = GROUPS.flatMap(([, zs]) => zs.map(([z]) => z));
  let initial = guess;
  let extra = '';
  if (!known.includes(guess)) {
    const same = known.find((z) => offMin(z) === offMin(guess));
    if (same) initial = same;
    else extra = `<option value="${guess}">${guess.replace(/_/g, ' ').split('/').pop()} · ${hora(guess)}</option>`;
  }
  tzSel.innerHTML = (extra ? `<optgroup label="${t.tzDetected || 'Detected'}">${extra}</optgroup>` : '') +
    GROUPS.map(([g, zs]) => `<optgroup label="${g}">${zs.map(([z, l]) => `<option value="${z}">${l} · ${hora(z)}</option>`).join('')}</optgroup>`).join('');
  tzSel.value = initial;

  const tz = () => tzSel.value || 'UTC';
  const ymd = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(t.locale, { timeZone: tz(), ...o }).format(new Date(iso));
  const whenTxt = (iso: string) => `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmt(iso, { hour: 'numeric', minute: '2-digit' })} (${tz().replace(/_/g, ' ')})`;
  const show = (k: keyof typeof steps) => { for (const [n, el] of Object.entries(steps)) el.hidden = n !== k; };

  function drawDays() {
    const byDay = new Map<string, string[]>();
    for (const s of slots) { const k = ymd(s); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(s); }
    const keys = [...byDay.keys()];
    if (!keys.length) { daysEl.innerHTML = `<p class="muted">${t.noneAtAll}</p>`; timesEl.innerHTML = ''; return; }
    if (!keys.includes(day)) day = keys[0];
    daysEl.innerHTML = keys.map((k) => {
      const iso = byDay.get(k)![0];
      return `<button type="button" class="bk-day" role="option" aria-selected="${k === day}" data-day="${k}"><small>${fmt(iso, { weekday: 'short' })}</small><b>${fmt(iso, { day: 'numeric' })}</b><small>${fmt(iso, { month: 'short' })}</small></button>`;
    }).join('');
    daysEl.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((b) => b.addEventListener('click', () => { day = b.dataset.day!; drawDays(); }));
    const list = byDay.get(day) || [];
    timesEl.innerHTML = list.length ? list.map((s) => `<button type="button" class="bk-time" data-slot="${s}">${fmt(s, { hour: 'numeric', minute: '2-digit' })}</button>`).join('') : `<p class="muted">${t.none}</p>`;
    timesEl.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.slot!)));
  }

  function pick(s: string) {
    chosen = s;
    $('[data-when]').textContent = whenTxt(s);
    show('form');
    (steps.form.elements.namedItem('name') as HTMLInputElement).focus();
  }

  async function load() {
    try {
      const r = await fetch('/api/slots', { headers: { Accept: 'application/json' } });
      const j = await r.json();
      slots = j.slots || [];
      minutes = j.minutes || 15;
    } catch { slots = []; }
    drawDays();
  }

  tzSel.addEventListener('change', drawDays);
  $('[data-back]').addEventListener('click', () => { show('pick'); });

  steps.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = steps.form;
    const v = (n: string) => ((f.elements.namedItem(n) as HTMLInputElement)?.value || '').trim();
    const err = $('[data-err]');
    err.textContent = '';
    if (!v('name') || !v('business') || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) { err.textContent = t.invalid; return; }
    const btn = $<HTMLButtonElement>('[data-submit]');
    btn.disabled = true;
    btn.textContent = t.sending;
    try {
      const r = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ start: chosen, name: v('name'), email: v('email'), business: v('business'), phone: v('phone'), notes: v('notes'), website: v('website'), timezone: tz(), lang: t.lang }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 || j.error === 'taken') { err.textContent = t.taken; await load(); show('pick'); return; }
      if (!r.ok || !j.ok) { err.textContent = j.error === 'validation' ? t.invalid : t.fail; return; }
      $('[data-done-title]').textContent = String(t.doneTitle).replace('{name}', v('name').split(' ')[0]);
      $('[data-done-when]').textContent = whenTxt(chosen);
      $('[data-done-text]').textContent = String(t.doneText).replace('{email}', v('email'));
      $<HTMLAnchorElement>('[data-gcal]').href = j.gcal;
      const st = Date.parse(chosen), en = st + (j.minutes || minutes) * 60e3;
      const d8 = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pipe Hero Studio//Booking//EN', 'BEGIN:VEVENT', `UID:${j.id}@pipeherostudio.digital`, `DTSTAMP:${d8(Date.now())}`,
        `DTSTART:${d8(st)}`, `DTEND:${d8(en)}`, 'SUMMARY:Pipe Hero Studio · 15-min call', j.meetingLink ? `LOCATION:${j.meetingLink}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
      $<HTMLAnchorElement>('[data-ics]').href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      show('done');
      steps.done.focus();
    } catch {
      err.textContent = t.fail;
    } finally {
      btn.disabled = false;
      btn.textContent = t.confirm;
    }
  });

  load();
}
