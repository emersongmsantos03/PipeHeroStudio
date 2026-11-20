import { config, type Money } from '../config';

export const LANGS = ['pt', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

/** Código usado em lang= e hreflang. O inglês é neutro (preços em USD). */
export const LOCALE: Record<Lang, string> = { pt: 'pt-PT', en: 'en', es: 'es-ES' };
export const OG_LOCALE: Record<Lang, string> = { pt: 'pt_PT', en: 'en_US', es: 'es_ES' };
export const CURRENCY: Record<Lang, 'EUR' | 'USD'> = { pt: 'EUR', en: 'USD', es: 'EUR' };
export const DEFAULT_LANG: Lang = 'en';

/** Slugs traduzidos. A chave é a mesma página nos três idiomas. */
export const ROUTES = {
  home: { pt: '', en: '', es: '' },
  sites: { pt: 'sites', en: 'websites', es: 'webs' },
  clinics: { pt: 'assistente-clinicas', en: 'clinic-assistant', es: 'asistente-clinicas' },
  crm: { pt: 'automacao-crm', en: 'crm-automation', es: 'automatizacion-crm' },
  agents: { pt: 'agentes-ia', en: 'ai-agents', es: 'agentes-ia' },
  contact: { pt: 'contacto', en: 'contact', es: 'contacto' },
  privacy: { pt: 'privacidade', en: 'privacy', es: 'privacidad' },
  terms: { pt: 'termos', en: 'terms', es: 'terminos' },
  cookies: { pt: 'cookies', en: 'cookies', es: 'cookies' },
  notFound: { pt: '404', en: '404', es: '404' },
} as const;

export type PageKey = keyof typeof ROUTES;

export function href(lang: Lang, key: PageKey, hash = ''): string {
  const slug = ROUTES[key][lang];
  return `/${lang}/${slug ? slug + '/' : ''}${hash ? '#' + hash : ''}`;
}

export function absolute(path: string): string {
  return new URL(path, config.siteUrl).href;
}

export function formatMoney(lang: Lang, amount: number): string {
  const cur = CURRENCY[lang];
  return new Intl.NumberFormat(LOCALE[lang] === 'en' ? 'en-US' : LOCALE[lang], {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** "100 €", "$100", ou o texto de "sob consulta". */
export function price(lang: Lang, money: Money, onRequest: string): string {
  if (!money) return onRequest;
  return formatMoney(lang, money[CURRENCY[lang]]);
}

/** "A partir de 300 €" ou "Sob consulta". */
export function priceFrom(lang: Lang, money: Money, onRequest: string, fromLabel: string): string {
  if (!money) return onRequest;
  return `${fromLabel} ${formatMoney(lang, money[CURRENCY[lang]])}`;
}
