// Depois do build: cria /en/404.html,
// que a Cloudflare serve (com estado 404) para endereços que não existem nesse idioma.
import { copyFileSync, existsSync, rmSync } from 'node:fs';

for (const lang of ['en']) {
  const src = `dist/${lang}/404/index.html`;
  if (!existsSync(src)) throw new Error(`Falta ${src}`);
  copyFileSync(src, `dist/${lang}/404.html`);
  rmSync(`dist/${lang}/404`, { recursive: true });
}
console.log('postbuild: páginas 404 por idioma prontas');
