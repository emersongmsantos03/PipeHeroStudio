export const DETAILING_SERVICES = ['Full detail', 'Interior detail', 'Paint correction', 'Ceramic coating', 'Paint protection film (PPF)'] as const;
export type DetailingService = typeof DETAILING_SERVICES[number];

/** Services that need an in-person inspection before the team can price the job. */
export const INSPECTION_SERVICES: readonly string[] = ['Paint correction', 'Ceramic coating', 'Paint protection film (PPF)'];

export type DetailingDraft = {
  car: string; service: string; notes: string;
  name: string; phone: string; email: string; emailSkipped: boolean; slot: string;
};
export const EMPTY_DRAFT: DetailingDraft = { car: '', service: '', notes: '', name: '', phone: '', email: '', emailSkipped: false, slot: '' };

export type Appointment = {
  id: string; slot: string; service: string; customer: string; car: string; phone: string;
  status: 'Confirmed' | 'Booked by Ava' | 'Rescheduled';
};

/** The fictional shop keeps its calendar in Central Time. */
export const SHOP_TZ = 'America/Chicago';
export const SLOT_TIMES = ['9:00 AM', '11:30 AM', '2:00 PM', '4:30 PM'] as const;
const SLOT_HOURS = [9, 11.5, 14, 16.5];
export const SCHEDULE_DAYS = 4;
export const SLOT_PATTERN = /^d[0-3]-[0-3]$/;

function shopNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: Date.UTC(+parts.year, +parts.month - 1, +parts.day), hour: +parts.hour + +parts.minute / 60 };
}

export function dayLabel(offset: number, now = new Date()) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const date = new Date(shopNow(now).date + offset * 86_400_000);
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

export function slotLabel(slot: string, now = new Date()) {
  const match = /^d(\d)-(\d)$/.exec(slot);
  if (!match) return '';
  return dayLabel(+match[1], now) + ' · ' + SLOT_TIMES[+match[2]];
}

/** Slots that are still ahead of the shop's current time and not taken. */
export function openSlots(taken: Iterable<string>, now = new Date()) {
  const busy = new Set(taken);
  const { hour } = shopNow(now);
  const open: string[] = [];
  for (let day = 0; day < SCHEDULE_DAYS; day++) {
    SLOT_HOURS.forEach((start, index) => {
      const id = `d${day}-${index}`;
      if (!busy.has(id) && !(day === 0 && start <= hour + 0.5)) open.push(id);
    });
  }
  return open;
}

export const SAMPLE_APPOINTMENTS: readonly Appointment[] = [
  { id: 'a1', slot: 'd0-0', service: 'Interior detail', customer: 'Maya Chen', car: '2021 Tesla Model 3', phone: '(512) 555-0141', status: 'Confirmed' },
  { id: 'a2', slot: 'd0-2', service: 'Full detail', customer: 'Luis Ortega', car: '2019 Ford F-150', phone: '(512) 555-0178', status: 'Confirmed' },
  { id: 'a3', slot: 'd1-2', service: 'Ceramic coating', customer: 'Priya Shah', car: '2023 BMW X3', phone: '(512) 555-0122', status: 'Confirmed' },
  { id: 'a4', slot: 'd2-1', service: 'Paint correction', customer: 'Jordan Blake', car: '2018 Audi A4', phone: '(512) 555-0190', status: 'Confirmed' },
  { id: 'a5', slot: 'd3-0', service: 'Interior detail', customer: 'Sam Rivera', car: '2020 Honda CR-V', phone: '(512) 555-0163', status: 'Confirmed' },
];

/** Completed jobs: [days ago, service, customer]. */
export const SAMPLE_HISTORY: readonly (readonly [number, DetailingService, string])[] = [
  [1, 'Full detail', 'Dana Price'], [2, 'Interior detail', 'Maya Chen'], [2, 'Ceramic coating', 'Owen Park'],
  [3, 'Full detail', 'Grace Kim'], [4, 'Paint correction', 'Ethan Cole'], [5, 'Interior detail', 'Nora Diaz'],
  [6, 'Full detail', 'Luis Ortega'], [8, 'Paint protection film (PPF)', 'Ravi Patel'], [9, 'Interior detail', 'Dana Price'],
  [11, 'Ceramic coating', 'Ethan Cole'], [12, 'Full detail', 'Hana Ito'], [14, 'Interior detail', 'Sam Rivera'],
  [16, 'Paint correction', 'Owen Park'], [18, 'Full detail', 'Maya Chen'], [20, 'Interior detail', 'Grace Kim'],
  [23, 'Ceramic coating', 'Priya Shah'], [25, 'Full detail', 'Nora Diaz'], [28, 'Interior detail', 'Luis Ortega'],
];

export function dayDate(offset: number, now = new Date()) {
  const date = new Date(shopNow(now).date + offset * 86_400_000);
  return { iso: date.toISOString().slice(0, 10), label: date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) };
}

export function historySummary(now = new Date()) {
  const count = (days: number) => Object.fromEntries(DETAILING_SERVICES.map((service) => [service,
    SAMPLE_HISTORY.filter(([ago, done]) => ago <= days && done === service).length]));
  const visits = new Map<string, number>();
  for (const [, , customer] of SAMPLE_HISTORY) visits.set(customer, (visits.get(customer) || 0) + 1);
  return {
    jobsLast7Days: SAMPLE_HISTORY.filter(([ago]) => ago <= 7).length,
    jobsLast30Days: SAMPLE_HISTORY.length,
    byServiceLast7Days: count(7),
    byServiceLast30Days: count(30),
    repeatCustomers: [...visits].filter(([, times]) => times > 1).map(([customer, times]) => ({ customer, visits: times })),
    today: dayDate(0, now),
    jobs: SAMPLE_HISTORY.map(([ago, service, customer]) => ({ date: dayDate(-ago, now).iso, day: dayDate(-ago, now).label, service, customer })),
  };
}
