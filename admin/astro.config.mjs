import { defineConfig } from 'astro/config';
import process from 'node:process';

// Staff admin, served at the root of its own host (admin.splus.dental). Always noindex.
export default defineConfig({
  site: 'https://admin.splus.dental',
  trailingSlash: 'never',
  build: { format: 'directory' },
  server: { port: 4322 },
  // Local dev: forward /api to the API (`pnpm dev:api`). Deployed, Firebase Hosting rewrites it.
  vite: {
    server: { proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8080}` } },
  },
});
