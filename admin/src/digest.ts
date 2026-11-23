/**
 * E-mails do painel: modelo visual e resumo diário (cron às 08:00 UTC).
 * O resumo só sai se houver alguma coisa a dizer (leads, conversas, follow-ups ou cadastros).
 */
import { ADMIN_URL, escHtml, sendMail } from '../../shared/crm';
import { FROM, getSetting, notifyTo, STAGE_LABEL, type AppEnv } from './common';

export function emailLayout(title: string, body: string, cta?: { label: string; href: string }) {
  return `<div style="background:#eef1f4;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#10182b">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d5dbe3;border-radius:12px;overflow:hidden">
    <div style="background:#10182b;color:#eef1f4;padding:14px 20px;font-size:13px;letter-spacing:.04em">PIPE HERO STUDIO <span style="color:#ffc83d">●</span> PAINEL</div>
    <div style="padding:20px;font-size:14px;line-height:1.55">
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      ${body}
      ${cta ? `<p style="margin:20px 0 4px"><a href="${cta.href}" style="display:inline-block;background:#ffc83d;color:#10182b;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escHtml(cta.label)}</a></p>` : ''}
    </div>
  </div>
  <p style="text-align:center;font-size:12px;color:#4a556b;margin-top:12px">${ADMIN_URL.replace('https://', '')}</p>
</div>`;
}

const money = (cents: number, cur: string) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: cur, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const moneyMulti = (rows: { currency: string; total: number }[]) => (rows.length ? rows.map((r) => money(r.total, r.currency)).join(' · ') : '€0');

export async function sendDigest(env: AppEnv, { force }: { force: boolean }) {
  if (!force && (await getSetting(env.DB, 'digest_enabled')) === '0') return { sent: false, skipped: 'disabled' };

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 864e5);
  const [s, e] = [start.toISOString(), end.toISOString()];
  const today = end.toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const db = env.DB;

  const [leads, convs, emails, followups, pending, income, expense, receivable] = await db.batch([
    db.prepare(`SELECT id, name, business, source, qualification, summary, needs FROM leads WHERE created_at >= ? AND created_at < ? ORDER BY created_at`).bind(s, e),
    db.prepare(`SELECT COUNT(DISTINCT ref) n, COUNT(*) m FROM events WHERE type = 'chat_message' AND created_at >= ? AND created_at < ?`).bind(s, e),
    db.prepare(`SELECT source, COUNT(*) n FROM events WHERE type = 'email_sent' AND created_at >= ? AND created_at < ? GROUP BY source`).bind(s, e),
    db.prepare(
      `SELECT t.lead_id id, t.title, t.due_date next_action_at, t.due_time, l.name, l.business, l.stage, u.name assignee FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.done_at IS NULL AND t.due_date <= ? ORDER BY t.due_date, t.due_time IS NULL, t.due_time LIMIT 20`,
    ).bind(today),
    db.prepare(`SELECT name, email FROM users WHERE status = 'pending'`),
    db.prepare(`SELECT currency, SUM(amount_cents) total FROM transactions WHERE kind = 'income' AND status = 'paid' AND date >= ? GROUP BY currency`).bind(monthStart),
    db.prepare(`SELECT currency, SUM(amount_cents) total FROM transactions WHERE kind = 'expense' AND status = 'paid' AND date >= ? GROUP BY currency`).bind(monthStart),
    db.prepare(`SELECT currency, SUM(amount_cents) total FROM transactions WHERE kind = 'income' AND status = 'pending' GROUP BY currency`),
  ]);
  const L = leads.results as { id: number; name: string; business: string; source: string; qualification: string | null; summary: string | null; needs: string | null }[];
  const C = convs.results[0] as { n: number; m: number };
  const E = emails.results as { source: string; n: number }[];
  const F = followups.results as { id: number | null; title: string; name: string | null; business: string | null; stage: string | null; next_action_at: string; due_time: string | null; assignee: string | null }[];
  const P = pending.results as { name: string; email: string }[];

  if (!force && !L.length && !C.n && !F.length && !P.length) return { sent: false, skipped: 'nothing' };

  const src: Record<string, string> = { form: 'Formulário', chat: 'Ava', agent: 'Agente', manual: 'Manual' };
  const emailTotal = E.reduce((a, x) => a + x.n, 0);
  const ava = E.find((x) => x.source === 'ava')?.n || 0;
  const tile = (label: string, value: string) =>
    `<td style="padding:10px;border:1px solid #d5dbe3;border-radius:8px;width:25%"><div style="font-size:12px;color:#4a556b">${label}</div><div style="font-size:20px;font-weight:600">${value}</div></td>`;

  const body =
    `<p style="color:#4a556b;margin-top:0">Ontem, ${start.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}.</p>` +
    `<table cellspacing="6" style="width:100%;border-collapse:separate"><tr>${tile('Novos leads', String(L.length))}${tile('Conversas Ava', String(C.n))}${tile('E-mails enviados', String(emailTotal))}${tile('Tarefas', String(F.length))}</tr></table>` +
    (L.length
      ? `<h2 style="font-size:15px;margin:18px 0 6px">Novos leads</h2><ul style="padding-left:18px;margin:0">${L.map(
          (l) => `<li style="margin-bottom:6px"><a href="${ADMIN_URL}/#/leads/${l.id}" style="color:#10182b;font-weight:600">${escHtml(l.name || 'Sem nome')}</a>${l.business ? ` — ${escHtml(l.business)}` : ''} <span style="color:#4a556b">(${src[l.source] || l.source}${l.qualification ? ', ' + l.qualification : ''})</span><br><span style="color:#4a556b">${escHtml((l.summary || l.needs || '').slice(0, 160))}</span></li>`,
        ).join('')}</ul>`
      : '') +
    (F.length
      ? `<h2 style="font-size:15px;margin:18px 0 6px">Tarefas para hoje</h2><ul style="padding-left:18px;margin:0">${F.map(
          (f) => `<li style="margin-bottom:6px"><a href="${ADMIN_URL}/#/${f.id ? `leads/${f.id}` : 'tasks'}" style="color:#10182b;font-weight:600">${escHtml(f.title)}</a>${f.due_time ? ` às ${f.due_time}` : ''}${f.next_action_at < today ? ' <strong style="color:#b42318">(atrasada)</strong>' : ''}${f.id ? `<br><span style="color:#4a556b">${escHtml(f.name || f.business || 'Lead')}${f.stage ? ' · ' + STAGE_LABEL[f.stage] : ''}${f.assignee ? ' · ' + escHtml(f.assignee) : ''}</span>` : ''}</li>`,
        ).join('')}</ul>`
      : '') +
    (P.length ? `<h2 style="font-size:15px;margin:18px 0 6px">Cadastros à espera de aprovação</h2><p style="margin:0">${P.map((p) => `${escHtml(p.name)} (${escHtml(p.email)})`).join(', ')} — <a href="${ADMIN_URL}/#/users">aprovar</a></p>` : '') +
    `<h2 style="font-size:15px;margin:18px 0 6px">Este mês</h2><p style="margin:0">Receita: <strong>${moneyMulti(income.results as any)}</strong> · Despesas: <strong>${moneyMulti(expense.results as any)}</strong> · A receber: <strong>${moneyMulti(receivable.results as any)}</strong></p>` +
    `<p style="color:#4a556b;font-size:12px;margin-top:16px">Ava: ${C.m} mensagens, ${ava} e-mails enviados. Pode desligar este resumo em Integrações.</p>`;

  const sent = await sendMail(
    env,
    {
      to: notifyTo(env),
      from: FROM,
      subject: `Resumo do dia: ${L.length} lead${L.length === 1 ? '' : 's'}, ${C.n} conversa${C.n === 1 ? '' : 's'}${F.length ? `, ${F.length} tarefa${F.length === 1 ? '' : 's'}` : ''}`,
      text: `Novos leads: ${L.length}\nConversas da Ava: ${C.n}\nE-mails enviados: ${emailTotal}\nTarefas para hoje: ${F.length}\n\n${L.map((l) => `- ${l.name} (${src[l.source]}): ${ADMIN_URL}/#/leads/${l.id}`).join('\n')}\n\n${ADMIN_URL}`,
      html: emailLayout('Resumo do dia', body, { label: 'Abrir o painel', href: ADMIN_URL }),
    },
    { source: 'system', kind: 'digest' },
  );
  return { sent };
}
