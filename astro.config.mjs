import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://pipeherostudio.digital',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
