// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The production URL: canonical, OG and sitemap depend on it.
export default defineConfig({
  site: 'https://linercode.dev',
  integrations: [sitemap()],
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  vite: {
    // The Auto section imports engine/src/route.ts from the app itself.
    server: { fs: { allow: ['..'] } },
  },
});
