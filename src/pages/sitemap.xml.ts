import type { APIRoute } from 'astro';
import { LANGS, LOCALE, ROUTES, absolute, href, type PageKey } from '../i18n/routes';

export const GET: APIRoute = () => {
  const keys = (Object.keys(ROUTES) as PageKey[]).filter((k) => k !== 'notFound');
  const urls = keys.flatMap((key) =>
    LANGS.map((lang) => {
      const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${LOCALE[l]}" href="${absolute(href(l, key))}"/>`).join('\n');
      return `  <url>\n    <loc>${absolute(href(lang, key))}</loc>\n${alts}\n    <xhtml:link rel="alternate" hreflang="x-default" href="${absolute(href('en', key))}"/>\n  </url>`;
    }),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
