/* Imagem Open Graph gerada no build: amarelo hero + a linha do pipeline. */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const font = (p: string) => readFileSync(require.resolve(p));

let fonts: { name: string; data: Buffer; weight: 500 | 800; style: 'normal' }[] | null = null;
function loadFonts() {
  if (!fonts) {
    fonts = [
      { name: 'Unbounded', data: font('@fontsource/unbounded/files/unbounded-latin-800-normal.woff'), weight: 800, style: 'normal' },
      { name: 'Geist Mono', data: font('@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff'), weight: 500, style: 'normal' },
    ];
  }
  return fonts;
}

type El = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (style: Record<string, unknown>, children?: unknown): El => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

const INK = '#10182B';
const HERO = '#FFC83D';

export async function ogPng(headline: string, label: string): Promise<Uint8Array> {
  const node = (x: number, y: number) =>
    h({ position: 'absolute', left: x - 17, top: y - 17, width: 34, height: 34, borderRadius: 17, background: HERO, border: `8px solid ${INK}` });
  const tree = h(
    { width: 1200, height: 630, background: HERO, position: 'relative', fontFamily: 'Geist Mono', color: INK },
    [
      // cano: desce à esquerda, cotovelo, atravessa e desce à direita
      h({ position: 'absolute', left: 80, top: 0, width: 12, height: 400, background: INK }),
      h({ position: 'absolute', left: 80, top: 380, width: 1000, height: 100, borderLeft: `12px solid ${INK}`, borderBottom: `12px solid ${INK}`, borderBottomLeftRadius: 44 }),
      h({ position: 'absolute', left: 1110, top: 516, width: 12, height: 114, background: INK }),
      h({ position: 'absolute', left: 1068, top: 468, width: 54, height: 50, borderTop: `12px solid ${INK}`, borderRight: `12px solid ${INK}`, borderTopRightRadius: 40 }),
      node(86, 140),
      node(86, 300),
      node(600, 474),
      h({ position: 'absolute', left: 870, top: 462, width: 14, height: 26, borderRadius: 6, background: '#FFFFFF', border: `3px solid ${INK}` }),
      h({ position: 'absolute', left: 150, top: 72, fontSize: 22, letterSpacing: 4 }, label),
      h({ position: 'absolute', left: 150, top: 118, width: 940, fontFamily: 'Unbounded', fontSize: 58, lineHeight: 1.08, letterSpacing: -2 }, headline),
      h({ position: 'absolute', left: 150, top: 540, fontSize: 26, letterSpacing: 1 }, 'pipeherostudio.digital'),
    ],
  );
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

export function iconPng(size: number): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#10182B"/><path d="M14 32 35 16" stroke="#EEF1F4" stroke-width="2.6" stroke-linecap="round"/><circle cx="14" cy="32" r="3.6" fill="#EEF1F4"/><circle cx="24.5" cy="24" r="3.4" fill="#EEF1F4"/><circle cx="35" cy="16" r="4.4" fill="#FFC83D"/></svg>`;
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}
