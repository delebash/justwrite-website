# justwrite-website

Landing site for **JustWrite** — a desktop writing app for novelists.

Built with [Astro](https://astro.build/). Designed as a typographic homage
to the works that take more than an afternoon: Fraunces display serif,
Spline Sans for UI, running heads and folios in the corners, scene-break
ornaments between sections, oxblood + gold accents.

The site is dark by default, with a light-mode toggle in the top-right
folio. Theme persists in `localStorage`.

## Develop

```bash
npm install
npm run dev
```

The dev server runs on the default Astro port (`4321`).

## Build

```bash
npm run build
```

Output lands in `dist/`.

## Deploy to GitHub Pages

1. Push to a new GitHub repo.
2. In **Settings → Pages**, set **Source** to *GitHub Actions*.
3. Edit `astro.config.mjs` — set `site` to your repo URL.
   - If deploying at `https://<user>.github.io/<repo>/`, uncomment `base`
     and set it to `'/<repo>'`.
   - If using a custom domain, leave `base` commented out and add a
     `CNAME` file to `public/`.
4. Push to `main` (or `master`) — the workflow in
   `.github/workflows/deploy.yml` will build and publish.

## Structure

```
src/
├─ pages/
│  └─ index.astro          # the single page, assembling sections
├─ layouts/
│  └─ Base.astro            # html shell, fonts, running head, folio, theme toggle
├─ components/
│  ├─ Hero.astro            # section I   — title + CTAs + mockup
│  ├─ Features.astro        # section II  — six rooms grid
│  ├─ ClaudeStory.astro     # section III — colophon
│  ├─ Footer.astro          # section IV  — CTA + page footer
│  └─ AppMockup.astro       # HTML/CSS mockup of the app, for the hero
└─ styles/
   └─ global.css            # design tokens + chrome
```
