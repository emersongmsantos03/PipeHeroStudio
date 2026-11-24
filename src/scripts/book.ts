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
  let zones: string[] = [];
  try { zones = (Intl as any).supportedValuesOf('timeZone'); } catch { /* navegador antigo */ }
  if (!zones.length) zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo',
    'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'UTC'];
  if (!zones.includes(guess)) zones.unshift(guess);
  const offset = (z: string) => {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      return p ? p.value.replace('GMT', 'UTC') : '';
    } catch { return ''; }
  };
  tzSel.innerHTML = zones.map((z) => `<option value="${z}">${z.replace(/_/g, ' ')} (${offset(z)})</option>`).join('');
  tzSel.value = guess;

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
