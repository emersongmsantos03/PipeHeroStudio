/**
 * Agenda de chamadas: regras de disponibilidade (guardadas em settings.booking) e cálculo dos horários livres.
 * Os horários são definidos no horário de Brasília (UTC-3, sem horário de verão desde 2019).
 */
export type BookingRules = {
  days: number[];          // 0 = domingo … 6 = sábado
  start: string;           // "08:00" (Brasília)
  end: string;             // "23:00" (Brasília): a última chamada termina até aqui
  minutes: number;         // duração da chamada
  step: number;            // de quanto em quanto tempo há um horário (ex.: 30 min)
  noticeHours: number;     // antecedência mínima
  maxDays: number;         // até quantos dias à frente
  blocked: string[];       // datas bloqueadas (YYYY-MM-DD, Brasília)
  meetingLink: string;     // link fixo da videochamada (Google Meet, Zoom…); vazio = enviado por e-mail
};

export const BRT_OFFSET_MIN = -180;
export const DEFAULT_RULES: BookingRules = {
  days: [1, 2, 3, 4, 5], start: '08:00', end: '23:00', minutes: 15, step: 30, noticeHours: 3, maxDays: 21, blocked: [], meetingLink: '',
};

const hm = (s: string) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export function normalizeRules(r: Partial<BookingRules> | null | undefined): BookingRules {
  const x = { ...DEFAULT_RULES, ...(r || {}) };
  const t = (v: unknown, d: string) => (/^\d{1,2}:\d{2}$/.test(String(v)) ? String(v).padStart(5, '0') : d);
  return {
    days: Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : DEFAULT_RULES.days,
    start: t(x.start, DEFAULT_RULES.start),
    end: t(x.end, DEFAULT_RULES.end),
    minutes: Math.min(Math.max(Number(x.minutes) || 15, 10), 120),
    step: Math.min(Math.max(Number(x.step) || 30, 10), 240),
    noticeHours: Math.min(Math.max(Number(x.noticeHours) || 0, 0), 168),
    maxDays: Math.min(Math.max(Number(x.maxDays) || 21, 1), 90),
    blocked: Array.isArray(x.blocked) ? x.blocked.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).slice(0, 200) : [],
    meetingLink: /^https:\/\/\S{4,300}$/.test(String(x.meetingLink || '')) ? String(x.meetingLink) : '',
  };
}

export async function loadRules(db: D1Database): Promise<BookingRules> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'booking'`).first<{ value: string }>().catch(() => null);
  try { return normalizeRules(row ? JSON.parse(row.value) : null); } catch { return normalizeRules(null); }
}

/** Todos os inícios possíveis (UTC, ISO) segundo as regras, sem olhar para as marcações. */
export function candidateSlots(rules: BookingRules, nowMs = Date.now()): string[] {
  const out: string[] = [];
  const minStart = nowMs + rules.noticeHours * 3600e3;
  const s = hm(rules.start), e = hm(rules.end);
  // dia de hoje em Brasília
  const brtNow = new Date(nowMs + BRT_OFFSET_MIN * 60e3);
  for (let i = 0; i <= rules.maxDays; i++) {
    const day = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate() + i));
    const ymd = day.toISOString().slice(0, 10);
    if (!rules.days.includes(day.getUTCDay()) || rules.blocked.includes(ymd)) continue;
    for (let m = s; m + rules.minutes <= e; m += rules.step) {
      const utc = day.getTime() + (m - BRT_OFFSET_MIN) * 60e3;
      if (utc >= minStart) out.push(new Date(utc).toISOString());
    }
  }
  return out;
}

export async function freeSlots(db: D1Database, rules: BookingRules, nowMs = Date.now()): Promise<string[]> {
  const cands = candidateSlots(rules, nowMs);
  if (!cands.length) return [];
  const { results } = await db
    .prepare(`SELECT start_at, minutes FROM bookings WHERE status = 'confirmed' AND start_at >= ? AND start_at <= ?`)
    .bind(new Date(Date.parse(cands[0]) - 4 * 3600e3).toISOString(), cands[cands.length - 1])
    .all<{ start_at: string; minutes: number }>();
  const busy = (results || []).map((b) => [Date.parse(b.start_at), Date.parse(b.start_at) + (b.minutes || 15) * 60e3]);
  return cands.filter((c) => {
    const a = Date.parse(c), z = a + rules.minutes * 60e3;
    return !busy.some(([b0, b1]) => a < b1 && z > b0);
  });
}

/** Data e hora em Brasília, para tarefas e avisos. */
export function brt(iso: string) {
  const d = new Date(Date.parse(iso) + BRT_OFFSET_MIN * 60e3).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
