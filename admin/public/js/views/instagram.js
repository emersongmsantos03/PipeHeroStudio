import { api, columns, dayLabel, esc, fail, getPref, hideTip, icon, num, setPref, toast } from '../lib.js';

const RANGES = [7, 30, 90];
const RANGE_PREF = 'phs-instagram-range';
const TRENDS = [
  { key: 'reach', name: 'Alcance', label: 'Contas alcançadas', icon: 'target', tone: 'pink' },
  { key: 'profile_views', name: 'Visitas ao perfil', label: 'Visitas ao perfil', icon: 'user', tone: 'orange' },
  { key: 'website_clicks', name: 'Cliques no link', label: 'Cliques no link', icon: 'ext', tone: 'blue' },
];
const LAST_SYNC = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
});

function sumMetric(rows, key) {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function metricCard({ label, icon: glyph, tone }, value, caption) {
  return `<article class="tile ig-metric ig-tone-${tone}">
    <span class="ig-symbol">${icon(glyph)}</span>
    <h3 class="label">${label}</h3>
    <strong class="value">${value == null ? '—' : num(value)}</strong>
    <span class="foot">${caption}</span>
  </article>`;
}

function referralCard(visits) {
  return `<aside class="card ig-referral">
    <span class="ig-symbol">${icon('globe')}</span>
    <h2>Visitas ao site</h2>
    <strong>${num(visits)}</strong>
    <p>Páginas vistas em pipeherostudio.digital vindas do Instagram no período.</p>
    <a class="btn" href="#/traffic">Ver tráfego do site ${icon('right')}</a>
  </aside>`;
}

export async function render(ctx) {
  const savedRange = Number(getPref(RANGE_PREF, '30'));
  const range = RANGES.includes(savedRange) ? savedRange : 30;
  ctx.setTitle('Instagram', 'Acompanhe o alcance do perfil e as visitas que ele gera para o site.');
  const ig = await api(`/instagram?range=${range}`);
  if (ctx.stale()) return;

  const username = ig.username || 'pipehero.studio';
  const rows = ig.rows || [];
  const lastSync = Date.parse(ig.last?.fetched_at);
  const canConfigure = ctx.state.user.role === 'admin';
  const rangeControl = `<div class="seg ig-range" role="group" aria-label="Período das métricas">${RANGES.map((days) =>
    `<button type="button" data-ig-range="${days}" aria-pressed="${days === range}">${days} dias</button>`).join('')}</div>`;

  ctx.page.innerHTML = `
    <section class="ig-hero" aria-labelledby="ig-profile">
      <div class="ig-identity">
        <span class="ig-avatar">${icon('instagram')}</span>
        <div>
          <div class="ig-profile-line">
            <h2 id="ig-profile">@${esc(username)}</h2>
            <span class="ig-status${ig.connected ? ' is-live' : ''}">${ig.connected ? 'Conectado' : 'Desconectado'}</span>
          </div>
          ${ig.connected && Number.isFinite(lastSync) ? `<p>Última atualização em ${esc(LAST_SYNC.format(lastSync))} (Brasília)</p>` : ''}
        </div>
      </div>
      <div class="ig-actions">
        <a class="ig-profile-link" href="https://www.instagram.com/${encodeURIComponent(username)}/" target="_blank" rel="noopener">${icon('ext')} Abrir perfil</a>
        ${ig.connected ? `<button class="btn ig-refresh" type="button" data-ig-refresh>${icon('refresh')} Atualizar agora</button>`
          : canConfigure ? `<a class="btn ig-refresh" href="#/integrations">${icon('plug')} Conectar Instagram</a>` : ''}
      </div>
    </section>
    ${ig.error ? `<p class="notice warn ig-notice">${icon('alert')}<span><strong>Aviso da última leitura</strong><br>${esc(ig.error)}</span></p>` : ''}
    <section class="ig-overview" aria-labelledby="ig-metrics">
      <div class="ig-section-head">
        <h2 id="ig-metrics">Métricas do perfil</h2>
        ${rangeControl}
      </div>
      ${ig.connected ? `<div class="tiles ig-metrics">
        ${metricCard({ label: 'Seguidores', icon: 'users', tone: 'purple' }, ig.last?.followers, 'Total atual')}
        ${TRENDS.map((metric) => {
          const value = sumMetric(rows, metric.key);
          return metricCard(metric, value, value == null ? 'Sem dados no período' :
            metric.key === 'reach' ? 'Soma do alcance diário' : 'Medições da Meta no período');
        }).join('')}
      </div>` : `<div class="card ig-empty">Conecte a conta profissional para ver os números do perfil.</div>`}
    </section>
    <div class="ig-lower${ig.connected ? ' has-chart' : ''}">
      ${ig.connected ? `<section class="card ig-trend" aria-labelledby="ig-history">
        <div class="ig-section-head">
          <h2 id="ig-history">Desempenho por dia</h2>
          <div class="seg" role="group" aria-label="Métrica do gráfico">${TRENDS.map(({ key, name }, i) =>
            `<button type="button" data-ig-metric="${key}" aria-pressed="${i === 0}" aria-controls="ig-trend-${key}">${name}</button>`).join('')}</div>
        </div>
        ${TRENDS.map(({ key, tone }, i) => `<div class="ig-tone-${tone}" id="ig-trend-${key}"${i ? ' hidden' : ''}>
          <div class="chart ig-chart"></div>
        </div>`).join('')}
      </section>` : ''}
      ${referralCard(ig.siteVisits)}
    </div>`;

  for (const button of ctx.page.querySelectorAll('[data-ig-range]')) {
    button.addEventListener('click', () => {
      if (Number(button.dataset.igRange) === range) return;
      setPref(RANGE_PREF, button.dataset.igRange);
      ctx.refresh();
    });
  }
  ctx.page.querySelector('[data-ig-refresh]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/instagram/sync', { method: 'POST' });
      if (ctx.stale()) return;
      toast(result.ok ? 'Números do Instagram atualizados' : result.reason, !result.ok);
      ctx.refresh();
    } catch (error) {
      if (!ctx.stale()) {
        fail(error);
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  });
  if (!ig.connected) return;

  const selectors = [...ctx.page.querySelectorAll('[data-ig-metric]')];
  const charts = TRENDS.map((metric, i) => ({
    ...metric, button: selectors[i], panel: ctx.page.querySelector(`#ig-trend-${metric.key}`),
  }));
  function showMetric(selected) {
    hideTip();
    for (const chart of charts) {
      chart.panel.hidden = chart !== selected;
      chart.button.setAttribute('aria-pressed', String(chart === selected));
    }
    if (selected.rendered) return;
    selected.rendered = true;
    const observed = rows.filter((row) => Number.isFinite(row[selected.key]));
    const el = selected.panel.querySelector('.chart');
    if (!observed.length) {
      el.innerHTML = '<p class="ig-empty">A Meta ainda não retornou dados dessa métrica para o período.</p>';
      return;
    }
    columns(el, {
      title: `${selected.label} por dia`,
      labels: observed.map((row) => row.day),
      data: Object.fromEntries(observed.map((row) => [row.day, { n: row[selected.key] }])),
      series: [{ key: 'n', label: selected.label, color: 'var(--ig-series)' }],
      labelFmt: dayLabel, height: 208,
    });
  }
  for (const chart of charts) chart.button.addEventListener('click', () => showMetric(chart));
  showMetric(charts[0]);
}
