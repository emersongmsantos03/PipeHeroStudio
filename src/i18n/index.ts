import pt, { type Dict } from './pt';
import en from './en';
import es from './es';
import type { Lang } from './routes';
import { config } from '../config';

const DICTS: Record<Lang, Dict> = { pt, en, es };

export function t(lang: Lang): Dict {
  return DICTS[lang];
}

/** Substitui {chave} pelos valores dados. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Escapa texto para usar dentro de set:html. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Linha com os dados legais do config (vazia se não estiverem preenchidos). */
export function legalLine(): string {
  const { entity, taxId, address } = config.legal;
  return [entity, taxId, address].filter(Boolean).map(esc).join(' · ');
}

export type { Dict };
