// Verifica links internos, âncoras e o seletor de idioma em todas as páginas de dist/.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.html')) files.push(p);
  }
})(DIST);

const ids = new Map();
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  ids.set(f, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}
const toFile = (path) => {
  const clean = path.split('#')[0].split('?')[0];
  if (clean.endsWith('/')) return join(DIST, clean, 'index.html');
  return join(DIST, clean);
};

let errors = 0, checked = 0, langLinks = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src|action)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|tel:|data:)/.test(url) || url.startsWith('/api/')) continue; // /api/* é o Worker
    checked++;
    if (url.startsWith('#')) {
      if (url.length > 1 && !ids.get(f).has(url.slice(1))) { console.log(`✗ ${f}: âncora ${url} não existe`); errors++; }
      continue;
    }
    if (!url.startsWith('/')) { console.log(`✗ ${f}: link relativo ${url}`); errors++; continue; }
    const target = toFile(url);
    if (!existsSync(target)) { console.log(`✗ ${f}: ${url} não existe`); errors++; continue; }
    const hash = url.split('#')[1];
    if (hash && target.endsWith('.html') && !ids.get(target)?.has(hash)) { console.log(`✗ ${f}: ${url} (âncora em falta)`); errors++; }
  }
  // seletor de idioma: 3 links, um por idioma, cada um para uma página existente
  const langs = [...html.matchAll(/<a [^>]*data-lang="(pt|en|es)"[^>]*>/g)];
  if (/\/(pt|en|es)\//.test(f) && !f.endsWith(`${DIST}/index.html`)) {
    const got = new Set(langs.map((l) => l[1]));
    if (got.size !== 3) { console.log(`✗ ${f}: seletor de idioma incompleto`); errors++; }
    langLinks += langs.length;
  }
}
console.log(`${files.length} páginas, ${checked} links internos, ${langLinks} links de idioma verificados. Erros: ${errors}`);
process.exit(errors ? 1 : 0);
