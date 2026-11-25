import type { APIRoute } from 'astro';
import { ROUTES, absolute, href, type PageKey } from '../i18n/routes';

export const GET: APIRoute = () => {
  const keys = (Object.keys(ROUTES) as PageKey[]).filter((key) => key !== 'notFound');
  const urls = keys.map((key) => `<url><loc>${absolute(href('en', key))}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
