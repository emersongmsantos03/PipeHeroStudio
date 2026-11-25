import type { APIRoute } from 'astro';
import { ogPng } from '../../lib/og';

export function getStaticPaths() {
  return [{ params: { lang: 'en' } }];
}

export const GET: APIRoute = async () => {
  const png = await ogPng('Websites & AI for auto detailers.', 'PIPE HERO STUDIO');
  return new Response(png as BodyInit, { headers: { 'Content-Type': 'image/png' } });
};
