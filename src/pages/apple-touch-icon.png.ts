import type { APIRoute } from 'astro';
import { iconPng } from '../lib/og';

export const GET: APIRoute = () => new Response(iconPng(180) as BodyInit, { headers: { 'Content-Type': 'image/png' } });
