import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Update `site` to your final URL. If you deploy under a custom domain,
  // remove `base`. If you deploy at github.io/<repo>/, set base accordingly.
  site: 'https://delebash.github.io/justwrite-website',
  build: {
    inlineStylesheets: 'auto'
  },
  compressHTML: true
});
