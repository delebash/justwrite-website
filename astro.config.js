import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const ROOT = dirname(fileURLToPath(import.meta.url));

// The docs sidebar is built from justwrite-app's docs/toc.json — the same file
// that drives the in-app Help viewer. scripts/sync-docs.js copies it here on
// predev/prebuild. It is gitignored and may be absent (fresh clone with no
// sibling repo and no release yet), so fall back to autogenerating the sidebar
// from whatever pages exist rather than failing the whole site build.
//
// The first two entries link back to the marketing pages: Starlight replaces
// the site chrome on its own routes, so without them the docs are a dead end.
function docsSidebar() {
  const siteLinks = [
    { label: '← Overview', link: '/justwrite-website/' },
    { label: '← Features', link: '/justwrite-website/features/' },
  ];
  try {
    const toc = JSON.parse(readFileSync(resolve(ROOT, 'src/data/docs-toc.json'), 'utf8'));
    return [
      ...siteLinks,
      { label: 'Start here', items: [{ slug: 'docs' }] },
      ...toc.map((group) => ({
        label: group.section,
        items: group.items.map((item) => ({ slug: `docs/${item.slug}` })),
      })),
    ];
  } catch {
    return [...siteLinks, { label: 'Docs', autogenerate: { directory: 'docs' } }];
  }
}

// Keeps the docs' light/dark choice in step with the marketing pages, which
// persist their own toggle under `jw-theme` (see Base.astro). Starlight writes
// `starlight-theme`; without this bridge, moving between / and /docs/ flips the
// theme back. Runs before paint, so there is no flash.
const THEME_BRIDGE = `
try {
  var jw = localStorage.getItem('jw-theme');
  var sl = localStorage.getItem('starlight-theme');
  if (jw && jw !== sl) { localStorage.setItem('starlight-theme', jw); document.documentElement.dataset.theme = jw; }
  else if (sl && !jw) { localStorage.setItem('jw-theme', sl); }
} catch (e) {}
`.trim();

// https://astro.build/config
export default defineConfig({
  // Update `site` to your final URL. If you deploy under a custom domain,
  // remove `base`. If you deploy at github.io/<repo>/, set base accordingly.
  site: 'https://delebash.github.io',
  base: '/justwrite-website',
  integrations: [
    starlight({
      title: 'JustWrite',
      description: 'JustWrite user documentation.',
      // Docs live under /docs/ so the marketing pages keep the site root:
      // Starlight serves whatever sync-docs writes into src/content/docs/docs/.
      customCss: ['./src/styles/starlight-brand.css'],
      sidebar: docsSidebar(),
      head: [{ tag: 'script', content: THEME_BRIDGE }],
      lastUpdated: false,
      credits: false,
    }),
  ],
  build: {
    inlineStylesheets: 'auto'
  },
  compressHTML: true,
  devToolbar: { enabled: false }
});
