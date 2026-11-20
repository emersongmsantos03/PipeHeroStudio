/** Moldes do mini-site: cores por tipo de negócio (partilhado entre o Astro e o JS do hero). */
export const BIZ_TYPES = ['restaurant', 'clinic', 'cleaning', 'garage', 'salon', 'other'] as const;
export type BizType = (typeof BIZ_TYPES)[number];

export interface Palette { bg: string; fg: string; muted: string; accent: string; on: string }

export const PALETTE: Record<BizType, Palette> = {
  restaurant: { bg: '#14261c', fg: '#f4efe4', muted: '#c9cfc3', accent: '#e9b44c', on: '#14261c' },
  clinic: { bg: '#f4f7f9', fg: '#12303f', muted: '#40596a', accent: '#1d6585', on: '#ffffff' },
  cleaning: { bg: '#edf7f2', fg: '#0f2e22', muted: '#3a594c', accent: '#146c4b', on: '#ffffff' },
  garage: { bg: '#17191d', fg: '#f1f2f4', muted: '#b9bec7', accent: '#f26b2a', on: '#17191d' },
  salon: { bg: '#f8eff4', fg: '#3a1528', muted: '#6a4456', accent: '#8b2d5c', on: '#ffffff' },
  other: { bg: '#ffffff', fg: '#10182b', muted: '#4a556b', accent: '#10182b', on: '#ffffff' },
};

export function isBizType(v: unknown): v is BizType {
  return typeof v === 'string' && (BIZ_TYPES as readonly string[]).includes(v);
}

export function paletteStyle(type: BizType): string {
  const p = PALETTE[type];
  return `--ms-bg:${p.bg};--ms-fg:${p.fg};--ms-muted:${p.muted};--ms-accent:${p.accent};--ms-on:${p.on}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÀ-Ý]/.test(w));
  const pick = (words.length ? words : [name.trim()]).slice(-2);
  return (pick.length > 1 ? pick[0][0] + pick[1][0] : (pick[0] || '?').slice(0, 2)).toUpperCase();
}

const TLD: Record<string, string> = { pt: '.pt', en: '.com', es: '.es' };

/** Domínio fictício a partir do nome: "Tasca do Largo" → "tascadolargo.pt". */
export function domainFor(name: string, lang: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'e')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  return (slug || 'oseunegocio') + (TLD[lang] || '.com');
}
