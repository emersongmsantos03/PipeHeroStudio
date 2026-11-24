// Agenda: chamadas de 15 minutos marcadas pelo site, e as regras de disponibilidade (dias, horário, duração).
import { api, esc, num, icon, toast, fail, copy, avatar, confirmBox } from '../lib.js';
import { state } from '../app.js';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const BOOK_URL = { pt: 'https://pipeherostudio.digital/pt/marcar/', en: 'https://pipeherostudio.digital/en/book/', es: 'https://pipeherostudio.digital/es/reservar/' };
const ST = { confirmed: ['Marcada', 'new'], done: ['Feita', 'won'], no_show: ['Não apareceu', 'lost'], cancelled: ['Cancelada', ''] };
let scope = 'upcoming';

const brt = (iso) => new Date(iso);
const fmtDia = (iso) => brt(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' });
const fmtHora = (iso) => brt(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const deles = (iso, tz) => { try { return brt(iso).toLocaleString('pt-BR', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const diaKey = (iso) => brt(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export async function render(ctx) {
  ctx.setTitle('Agenda', 'Chamadas de 15 minutos marcadas pelo site, no horário de Brasília');
  ctx.setActions(`<button class="btn" data-copy-link>${icon('copy')}<span class="lbl">Copiar link de agendamento</span></button>
    <a class="btn" href="${BOOK_URL.pt}" target="_blank" rel="noopener">${icon('ext')}<span class="lbl">Ver a página</span></a>`);
  const [b, r] = await Promise.all([api(`/bookings?scope=${scope}`), api('/booking-rules')]);
  if (ctx.stale()) return;
  const s = b.stats || {};
  const rules = r.rules;
  const admin = state.user?.role === 'admin';

  const grupos = [];
  for (const x of b.rows) {
    const k = diaKey(x.start_at);
    if (!grupos.length || grupos[grupos.length - 1].k !== k) grupos.push({ k, iso: x.start_at, itens: [] });
    grupos[grupos.length - 1].itens.push(x);
  }
  const passado = (x) => Date.parse(x.start_at) < Date.now();
  const linha = (x) => {
    const [stl, stc] = ST[x.status] || [x.status, ''];
    const acoes = x.status === 'confirmed'
      ? (passado(x)
        ? `<button class="btn sm" data-st="done" data-id="${x.id}">${icon('check')}Feita</button><button class="btn sm" data-st="no_show" data-id="${x.id}">Não apareceu</button>`
        : `<button class="btn sm danger" data-st="cancelled" data-id="${x.id}">Cancelar</button>`)
      : x.status === 'cancelled' && !passado(x) ? `<button class="btn sm" data-st="confirmed" data-id="${x.id}">Reativar</button>` : '';
    return `<div class="ag-item${x.status !== 'confirmed' ? ' off' : ''}">
      <div class="ag-time"><b>${fmtHora(x.start_at)}</b><small>${num(x.minutes)} min</small></div>
      <div class="ag-who">${avatar(x.name, 'sm')}<div>
        <div class="ag-name">${x.lead_id ? `<a href="#/leads/${x.lead_id}">${esc(x.name)}</a>` : esc(x.name)} <span class="muted">· ${esc(x.business || '')}</span> ${x.status !== 'confirmed' || passado(x) ? `<span class="badge ${stc}">${stl}</span>` : ''}</div>
        <div class="ag-sub"><a href="mailto:${esc(x.email)}">${esc(x.email)}</a>${x.phone ? ` · ${esc(x.phone)}` : ''}${x.timezone && x.timezone !== 'America/Sao_Paulo' ? ` · para a pessoa: <b>${esc(deles(x.start_at, x.timezone))}</b> (${esc(x.timezone.replace(/_/g, ' '))})` : ''}</div>
        ${x.notes ? `<div class="ag-notes">${esc(x.notes)}</div>` : ''}
      </div></div>
      <div class="ag-act">${acoes}</div>
    </div>`;
  };

  ctx.page.innerHTML = `
    <section class="tiles">
      <div class="tile"><span class="label">Próximas chamadas</span><span class="value">${num(s.upcoming || 0)}</span><span class="foot">${num(s.week || 0)} nos próximos 7 dias</span></div>
      <div class="tile"><span class="label">Marcadas (30 dias)</span><span class="value">${num(s.last30 || 0)}</span><span class="foot">pelo site</span></div>
      <div class="tile"><span class="label">Feitas</span><span class="value">${num(s.done || 0)}</span><span class="foot">${num(s.no_show || 0)} não apareceram</span></div>
      <div class="tile"><span class="label">Horários livres</span><span class="value">${num(r.freeCount)}</span><span class="foot">${r.nextFree ? `próximo: ${fmtDia(r.nextFree)}, ${fmtHora(r.nextFree)}` : 'nenhum: reveja as regras'}</span></div>
    </section>
    <div class="ag-grid">
      <section class="card">
        <div class="card-h"><h2>Chamadas</h2>
          <div class="seg end" role="group" aria-label="Mostrar"><button type="button" data-scope="upcoming" aria-pressed="${scope === 'upcoming'}">Próximas</button><button type="button" data-scope="past" aria-pressed="${scope === 'past'}">Passadas e canceladas</button></div></div>
        ${grupos.length ? grupos.map((g) => `<h3 class="ag-day">${esc(fmtDia(g.iso))}</h3>${g.itens.map(linha).join('')}`).join('')
          : `<div class="empty"><b>${scope === 'upcoming' ? 'Nenhuma chamada marcada.' : 'Nada por aqui ainda.'}</b>Partilhe o link de agendamento: ${BOOK_URL.en}</div>`}
      </section>
      <section class="card">
        <div class="card-h"><h2>Disponibilidade</h2><span class="muted">horário de Brasília</span></div>
        <form class="stack" data-rules>
          <div class="field"><span class="ag-l">Dias da semana</span><div class="ag-days">${DIAS.map((d, i) => `<label class="ag-chip"><input type="checkbox" name="d${i}" ${rules.days.includes(i) ? 'checked' : ''} ${admin ? '' : 'disabled'}><span>${d}</span></label>`).join('')}</div></div>
          <div class="row2">
            <label class="field"><span class="ag-l">Das</span><input class="input" type="time" name="start" value="${esc(rules.start)}" step="900" ${admin ? '' : 'disabled'}></label>
            <label class="field"><span class="ag-l">Até</span><input class="input" type="time" name="end" value="${esc(rules.end)}" step="900" ${admin ? '' : 'disabled'}></label>
          </div>
          <div class="row2">
            <label class="field"><span class="ag-l">Duração</span><select class="input" name="minutes" ${admin ? '' : 'disabled'}>${[15, 20, 30, 45, 60].map((m) => `<option value="${m}" ${rules.minutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
            <label class="field"><span class="ag-l">Um horário a cada</span><select class="input" name="step" ${admin ? '' : 'disabled'}>${[15, 20, 30, 45, 60, 90].map((m) => `<option value="${m}" ${rules.step === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
          </div>
          <div class="row2">
            <label class="field"><span class="ag-l">Antecedência mínima</span><select class="input" name="noticeHours" ${admin ? '' : 'disabled'}>${[0, 1, 2, 3, 6, 12, 24, 48].map((h) => `<option value="${h}" ${rules.noticeHours === h ? 'selected' : ''}>${h ? h + ' h' : 'nenhuma'}</option>`).join('')}</select></label>
            <label class="field"><span class="ag-l">Marcar até</span><select class="input" name="maxDays" ${admin ? '' : 'disabled'}>${[7, 14, 21, 30, 45, 60].map((d) => `<option value="${d}" ${rules.maxDays === d ? 'selected' : ''}>${d} dias à frente</option>`).join('')}</select></label>
          </div>
          <label class="field"><span class="ag-l">Dias bloqueados (folgas, feriados)</span><input class="input" name="blocked" value="${esc(rules.blocked.map((d) => d.split('-').reverse().join('/')).join(', '))}" placeholder="25/12/2026, 01/01/2027" ${admin ? '' : 'disabled'}></label>
          <label class="field"><span class="ag-l">Link da videochamada <span class="muted">(opcional)</span></span><input class="input" name="meetingLink" value="${esc(rules.meetingLink)}" placeholder="https://meet.google.com/xxx-xxxx-xxx" ${admin ? '' : 'disabled'}>
            <small class="muted">Vai no e-mail de confirmação. Vazio: você manda o link por e-mail antes da chamada.</small></label>
          ${admin ? '<button class="btn primary" type="submit">Guardar disponibilidade</button>' : '<p class="muted" style="margin:0">Só administradores mudam a disponibilidade.</p>'}
        </form>
      </section>
    </div>`;

  const P = ctx.page;
  document.querySelector('[data-copy-link]')?.addEventListener('click', () => copy(BOOK_URL.en, 'Link copiado (versão em inglês)'));
  P.querySelectorAll('[data-scope]').forEach((x) => x.addEventListener('click', () => { scope = x.dataset.scope; ctx.refresh(); }));
  P.querySelectorAll('[data-st]').forEach((x) => x.addEventListener('click', async () => {
    const msg = { cancelled: 'Chamada cancelada. Avise a pessoa por e-mail.', done: 'Marcada como feita', no_show: 'Registado: não apareceu', confirmed: 'Chamada reativada' }[x.dataset.st];
    if (x.dataset.st === 'cancelled' && !(await confirmBox('Cancelar chamada', 'O horário volta a ficar livre no site. Lembre-se de avisar a pessoa por e-mail.', 'Cancelar chamada'))) return;
    try { await api(`/bookings/${x.dataset.id}`, { method: 'PATCH', body: { status: x.dataset.st } }); toast(msg); ctx.refresh(); } catch (e) { fail(e); }
  }));
  P.querySelector('[data-rules]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const blocked = f.blocked.value.split(/[,;\s]+/).map((d) => d.trim()).filter(Boolean).map((d) => { const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : d; });
    const body = { days: DIAS.map((_, i) => (f[`d${i}`].checked ? i : -1)).filter((i) => i >= 0), start: f.start.value, end: f.end.value, minutes: Number(f.minutes.value),
      step: Number(f.step.value), noticeHours: Number(f.noticeHours.value), maxDays: Number(f.maxDays.value), blocked, meetingLink: f.meetingLink.value.trim() };
    try { await api('/booking-rules', { method: 'PATCH', body }); toast('Disponibilidade guardada'); ctx.refresh(); } catch (err) { fail(err); }
  });
}
