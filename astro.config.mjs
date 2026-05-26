import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import { autoNewTabExternalLinks } from './src/autoNewTabExternalLinks';
import partytown from '@astrojs/partytown';
import { loadEnv } from 'vite';

const { SITE = 'http://localhost:4321' } = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
const isProductionBuild = (process.env.NODE_ENV || 'development') === 'production';
if (isProductionBuild && SITE === 'http://localhost:4321') {
  throw new Error(
    'SITE is still using the localhost default during a production build. Set SITE in your environment before deploying.'
  );
}

const siteDomain = (() => {
  try {
    return new URL(SITE).hostname;
  } catch {
    return 'localhost';
  }
})();

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [mdx(), sitemap(), tailwind(), partytown()],
  markdown: {
    extendDefaultPlugins: true,
    rehypePlugins: [[autoNewTabExternalLinks, { domain: siteDomain }]]
  }
});
