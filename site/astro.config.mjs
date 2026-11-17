import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://splus.dental',
  trailingSlash: 'never',
  build: { format: 'directory' },
  // Local dev: forward /api to the API (`pnpm dev:api`, port 8080). In prod Firebase rewrites it.
  vite: {
    server: { proxy: { '/api': 'http://localhost:8080' } },
  },
});
