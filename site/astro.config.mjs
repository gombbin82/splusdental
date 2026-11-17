import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import process from 'node:process';

export default defineConfig({
  site: 'https://splus.dental',
  trailingSlash: 'never',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      // Keep payment-return, staff, and error pages out of the sitemap.
      filter: (page) => !/^https?:\/\/[^/]+\/(thank-you|admin|404)(\/|$)/.test(page),
    }),
  ],
  // Local dev: forward /api to the API (`pnpm dev:api`). In prod Firebase rewrites it.
  vite: {
    server: { proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8080}` } },
  },
});
