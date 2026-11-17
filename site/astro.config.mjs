import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

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
});
