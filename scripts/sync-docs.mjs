#!/usr/bin/env node
// Pulls the JustWrite user documentation into src/pages/docs/ as Astro
// pages. Two modes:
//
//   node scripts/sync-docs.mjs --from local
//     Copies from ../justwrite-app/docs/ (sibling repo, for local dev).
//     If the sibling repo isn't checked out, exits quietly when given
//     --silent-if-missing.
//
//   node scripts/sync-docs.mjs --from release [--tag v0.2.0]
//     Downloads docs.tar.gz from a GitHub release of the app repo.
//     Default is the latest release; --tag pins a specific version.
//     This is the CI mode — the marketing site serves the latest
//     RELEASED docs, not the app's master branch.
//
// Generated pages land in src/pages/docs/ which is gitignored. Each
// .md gets prepended Astro frontmatter (layout + title) and intra-doc
// `(foo.md)` links are rewritten to Astro routes.

import { readFile, writeFile, mkdir, rm, readdir, cp, stat } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = resolve(ROOT, "src/pages/docs");
const TOC_TARGET = resolve(ROOT, "src/data/docs-toc.json");
const APP_REPO = "delebash/justwrite-app";
const LOCAL_APP = resolve(ROOT, "..", "justwrite-app", "docs");
const LAYOUT_PATH = "../../layouts/DocsLayout.astro";

// Absolute base for rewritten intra-doc links. Must match `base` in
// astro.config.mjs — relative `./slug` forms break under GitHub Pages'
// trailing-slash canonicalization (./slug from /docs/foo/ → /docs/foo/slug).
async function readDocsBase() {
  const conf = await readFile(resolve(ROOT, "astro.config.mjs"), "utf8");
  const m = conf.match(/base:\s*['"]([^'"]+)['"]/);
  const base = (m ? m[1] : "").replace(/\/$/, "");
  return `${base}/docs`;
}

function arg(name, hasValue = false) {
  const i = process.argv.indexOf(name);
  if (i < 0) return hasValue ? null : false;
  return hasValue ? process.argv[i + 1] : true;
}
const FROM = arg("--from", true);
const TAG = arg("--tag", true);
const SILENT_IF_MISSING = arg("--silent-if-missing");

if (FROM !== "local" && FROM !== "release") {
  console.error("Usage: sync-docs --from <local|release> [--tag v0.2.0] [--silent-if-missing]");
  process.exit(1);
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

function titleOf(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : fallback;
}

function escapeYaml(s) {
  // Just enough for a quoted YAML string — escape backslashes and quotes.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rewriteLinks(markdown, docsBase) {
  // [text](foo.md)         → [text](<base>/docs/foo/)
  // [text](foo.md#anchor)  → [text](<base>/docs/foo/#anchor)
  // [text](README.md)      → [text](<base>/docs/)
  // Absolute paths so the link resolves the same from /docs/ (the index)
  // and from /docs/<slug>/ (every other page) — relative forms only work
  // from one or the other given GitHub Pages adds trailing slashes.
  return markdown.replace(/\]\(([^)\s]+?)\.md(#[^)]*)?\)/g, (_, file, anchor = "") => {
    const slug = basename(file) === "README" ? "" : basename(file);
    return `](${docsBase}/${slug ? slug + "/" : ""}${anchor})`;
  });
}

async function processFile(srcPath, docsBase) {
  const fileName = basename(srcPath);
  const slug = fileName === "README.md" ? "index" : fileName.replace(/\.md$/, "");
  const raw = await readFile(srcPath, "utf8");
  const title = titleOf(raw, slug);
  // Strip the leading H1 — the layout's title bar renders it instead.
  const stripped = raw.replace(/^#\s+.+\n+/, "");
  const rewritten = rewriteLinks(stripped, docsBase);

  const frontmatter =
    `---\n` +
    `layout: ${LAYOUT_PATH}\n` +
    `title: "${escapeYaml(title)}"\n` +
    `slug: "${slug}"\n` +
    `---\n\n`;

  const dest = join(TARGET, `${slug}.md`);
  await writeFile(dest, frontmatter + rewritten);
  return slug;
}

async function syncToc(dir) {
  const src = join(dir, "toc.json");
  if (!(await exists(src))) {
    throw new Error(`Expected toc.json in ${dir} but none found. The docs source needs a toc.json — it's the single source of truth for the navigation order, shared with the in-app viewer.`);
  }
  await mkdir(dirname(TOC_TARGET), { recursive: true });
  await cp(src, TOC_TARGET);
}

async function syncFromDir(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  if (files.length === 0) throw new Error(`No .md files found in ${dir}`);

  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });

  const docsBase = await readDocsBase();
  const slugs = [];
  for (const f of files) slugs.push(await processFile(join(dir, f), docsBase));
  await syncToc(dir);
  return slugs;
}

async function fromLocal() {
  if (!(await exists(LOCAL_APP))) {
    if (SILENT_IF_MISSING) {
      console.log(`sync-docs: ${LOCAL_APP} not found — skipping (--silent-if-missing).`);
      return [];
    }
    throw new Error(`Local app docs not found at ${LOCAL_APP}. Clone delebash/justwrite-app as a sibling, or use --from release.`);
  }
  console.log(`sync-docs: copying from ${LOCAL_APP}`);
  return syncFromDir(LOCAL_APP);
}

async function fromRelease() {
  let tag = TAG;
  if (!tag) {
    console.log(`sync-docs: looking up latest release of ${APP_REPO}…`);
    const res = await fetch(`https://api.github.com/repos/${APP_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      if (SILENT_IF_MISSING && res.status === 404) {
        console.log("sync-docs: no releases yet — skipping (--silent-if-missing).");
        return [];
      }
      throw new Error(`GitHub API ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    tag = json.tag_name;
    if (!tag) throw new Error("No tag_name on latest release response.");
  }
  console.log(`sync-docs: fetching docs.tar.gz from ${APP_REPO}@${tag}`);

  const url = `https://github.com/${APP_REPO}/releases/download/${tag}/docs.tar.gz`;
  const res = await fetch(url);
  if (!res.ok) {
    if (SILENT_IF_MISSING && (res.status === 404)) {
      console.log(`sync-docs: ${tag} has no docs.tar.gz — skipping (--silent-if-missing).`);
      return [];
    }
    throw new Error(`Download failed: ${res.status} ${res.statusText} from ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Stage under the website root rather than os.tmpdir() — on Windows
  // the OS temp dir resolves with a `\\?\` extended-path prefix that
  // bash-spawned cmd.exe can't use as a cwd ("UNC paths are not
  // supported"). A repo-local cache dir sidesteps that and gets
  // .gitignored alongside generated docs.
  const tmpDir = resolve(ROOT, ".docs-cache");
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(join(tmpDir, "docs.tar.gz"), buf);
  // bsdtar/GNU tar handles -xzf on Windows 10+/macOS/Linux uniformly.
  execSync(`tar -xzf docs.tar.gz`, { cwd: tmpDir, stdio: "inherit" });
  const extracted = join(tmpDir, "docs");
  return syncFromDir(extracted);
}

try {
  const slugs = FROM === "local" ? await fromLocal() : await fromRelease();
  if (slugs.length) {
    console.log(`sync-docs: wrote ${slugs.length} pages to src/pages/docs/`);
    console.log(`  ${slugs.join(", ")}`);
  }
} catch (err) {
  console.error("sync-docs failed:", err.message);
  process.exit(1);
}
