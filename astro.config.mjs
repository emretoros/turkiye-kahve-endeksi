import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] || '';
const isPages = Boolean(process.env.GITHUB_ACTIONS && repository);

export default defineConfig({
  site: process.env.SITE_URL || 'https://example.github.io',
  base: isPages ? `/${repository}` : '/',
  output: 'static',
  integrations: [sitemap()]
});
