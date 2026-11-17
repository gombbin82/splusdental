import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://splus.dental',
  trailingSlash: 'never',
  build: { format: 'directory' },
});
