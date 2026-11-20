import type { APIRoute } from 'astro';
import { LANGS, type Lang } from '../../i18n/routes';
import { t } from '../../i18n';
import { ogPng } from '../../lib/og';

export function getStaticPaths() {
  return LANGS.map((lang) => ({ params: { lang } }));
}

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang as Lang;
  const png = await ogPng(t(lang).brandLine, 'PIPE HERO STUDIO  ·  01 SITE  ·  02 CHAT  ·  03 CRM  ·  04 IA');
  return new Response(png as BodyInit, { headers: { 'Content-Type': 'image/png' } });
};
