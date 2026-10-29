#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// A family app's website: its user docs into Starlight's docs collection (src/content/docs/docs/, gitignored). The
// kit's (just-core/website/scripts/sync-docs.js) — every site copies it as it is (the family guard checks); the
// site's package.json `justSite` names its app: { appRepo: "owner/name", appDir: "../<app's folder>" }. From
// justwrite-website's scripts/sync-docs.mjs (MIT — the kit's NOTICE.md).
//
//   node scripts/sync-docs.js --from local
//     Copies <appDir>/docs (the app's repo beside the site). With --silent-if-missing, no such folder is no error.
//
//   node scripts/sync-docs.js --from release [--tag v0.2.0]
//     The docs of a release of the app (the latest by default; --tag pins one): its docs.tar.gz, which the app's
//     release attaches while the release is still a draft — or, for a release made before that, the same files from
//     the tag's source. The site serves the docs of the latest RELEASE, never the app's main branch — but for an app
//     with no release at all a site may opt in (`justSite.untilFirstRelease: "main"`, docgen's decision 2026-10-28) to
//     the docs on the app's main branch until its first release exists.
//
// Each page gets Starlight's frontmatter (its title from its first heading, its description from the doc's own
// front-matter `lede:` — its one-line summary, docgen's single source — or else the contents file's hint); the doc's
// front-matter block (the `front-matter` package, the kit's way — a site's dependency), a leading <!-- comment --> (an
// SPDX line) and the first heading go, and its links to sibling pages
// (`(foo.md)`) become the site's routes. The app's contents file (toc.json — its Help order) is copied to
// src/data/docs-toc.json for the site's sidebar; a group is `{ group | section, items: [{ slug, hint? }] }`.

import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import frontMatter from "front-matter";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = resolve(ROOT, "src/content/docs/docs");
const TOC_TARGET = resolve(ROOT, "src/data/docs-toc.json");
const site = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8")).justSite ?? {};
const APP_REPO = site.appRepo;
const LOCAL_APP = resolve(ROOT, site.appDir ?? "..", "docs");
if (!APP_REPO) {
  console.error('sync-docs: package.json has no justSite.appRepo ("owner/name" of the app whose docs this site shows)');
  process.exit(1);
}

// The links' absolute base: the Astro config's `base`. Relative forms break under GitHub Pages' trailing slashes
// (./slug from /docs/foo/ is /docs/foo/slug).
async function readDocsBase() {
  for (const name of ["astro.config.js", "astro.config.mjs"]) {
    try {
      const m = (await readFile(resolve(ROOT, name), "utf8")).match(/base:\s*['"]([^'"]+)['"]/);
      return `${(m ? m[1] : "").replace(/\/$/, "")}/docs`;
    } catch {}
  }
  return "/docs";
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
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const titleOf = (markdown, fallback) => markdown.match(/^#\s+(.+?)\s*$/m)?.[1] ?? fallback;
// enough for a double-quoted YAML string
const escapeYaml = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// [text](foo.md) → [text](<base>/docs/foo/), with its #anchor; README.md → the docs' index
function rewriteLinks(markdown, docsBase) {
  return markdown.replace(/\]\(([^)\s]+?)\.md(#[^)]*)?\)/g, (_, file, anchor = "") => {
    const slug = basename(file) === "README" ? "" : basename(file);
    return `](${docsBase}/${slug ? `${slug}/` : ""}${anchor})`;
  });
}

async function processFile(srcPath, docsBase, hints) {
  const fileName = basename(srcPath);
  const slug = fileName === "README.md" ? "index" : fileName.replace(/\.md$/, "");
  // a leading front-matter block (`lede:`, `hints:`) is the doc's data, never its page
  const { attributes, body: raw } = frontMatter(await readFile(srcPath, "utf8"));
  const title = titleOf(raw, slug);
  // the leading comment (an SPDX line) and the H1 go: Starlight renders the frontmatter's title. `[^\r\n]*`, not
  // `.+`: in a CRLF checkout `.` stops at the \r and the H1 stayed (justwrite-website's finding — every title twice)
  const stripped = raw.replace(/^<!--[^]*?-->\s*/, "").replace(/^#\s+[^\r\n]*\r?\n+/, "");
  const lede = typeof attributes.lede === "string" && attributes.lede.trim() ? attributes.lede.trim() : null;
  const hint = lede ?? hints.get(slug);
  const frontmatter = `---\ntitle: "${escapeYaml(title)}"\n${hint ? `description: "${escapeYaml(hint)}"\n` : ""}---\n\n`;
  await writeFile(join(TARGET, `${slug}.md`), frontmatter + rewriteLinks(stripped, docsBase));
  return slug;
}

// the contents file across, and slug → hint for the pages' descriptions
async function syncToc(dir) {
  const src = join(dir, "toc.json");
  if (!(await exists(src))) throw new Error(`no toc.json in ${dir} — the app's Help order, which the sidebar follows`);
  await mkdir(dirname(TOC_TARGET), { recursive: true });
  await cp(src, TOC_TARGET);
  const hints = new Map();
  for (const group of JSON.parse(await readFile(src, "utf8"))) for (const item of group.items) if (item.hint) hints.set(item.slug, item.hint);
  return hints;
}

async function syncFromDir(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  if (!files.length) throw new Error(`no .md files in ${dir}`);
  const hints = await syncToc(dir);
  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });
  const docsBase = await readDocsBase();
  const slugs = [];
  for (const f of files) slugs.push(await processFile(join(dir, f), docsBase, hints));
  return slugs;
}

async function fromLocal() {
  if (!(await exists(LOCAL_APP))) {
    if (SILENT_IF_MISSING) {
      console.log(`sync-docs: ${LOCAL_APP} not found — skipped (--silent-if-missing).`);
      return [];
    }
    throw new Error(`no app docs at ${LOCAL_APP}: clone ${APP_REPO} beside this repo, or use --from release`);
  }
  console.log(`sync-docs: copying from ${LOCAL_APP}`);
  return syncFromDir(LOCAL_APP);
}

// staged in the repo, not os.tmpdir(): on Windows that can carry a \\?\ prefix a spawned tar can't take as its cwd
// (justwrite-website's finding); .docs-cache is gitignored
const tmpDir = resolve(ROOT, ".docs-cache");
async function unpack(res) {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(join(tmpDir, "in.tar.gz"), Buffer.from(await res.arrayBuffer()));
  execFileSync("tar", ["-xzf", "in.tar.gz"], { cwd: tmpDir, stdio: "inherit" });
}

/** The docs in a GitHub source archive (`ref`: refs/tags/<tag> or refs/heads/main) — one folder, <repo>-<ref>. */
async function fromSource(ref) {
  const src = `https://codeload.github.com/${APP_REPO}/tar.gz/${ref}`;
  const res = await fetch(src);
  if (!res.ok) {
    if (SILENT_IF_MISSING && res.status === 404) {
      console.log(`sync-docs: no source at ${ref} — skipped (--silent-if-missing).`);
      return [];
    }
    throw new Error(`download failed: ${res.status} ${res.statusText} from ${src}`);
  }
  await unpack(res);
  const top = (await readdir(tmpDir, { withFileTypes: true })).find((d) => d.isDirectory());
  if (!top) throw new Error(`${src} held no folder`);
  return syncFromDir(join(tmpDir, top.name, "docs"));
}

async function fromRelease() {
  let tag = TAG;
  if (!tag) {
    console.log(`sync-docs: the latest release of ${APP_REPO}…`);
    const res = await fetch(`https://api.github.com/repos/${APP_REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) {
      if (res.status === 404 && site.untilFirstRelease === "main") {
        // the app has no release yet, and this site opted in: the docs on its main branch until the first one
        console.log(`sync-docs: ${APP_REPO} has no release yet — the docs on its main branch (justSite.untilFirstRelease)`);
        return fromSource("refs/heads/main");
      }
      if (SILENT_IF_MISSING && res.status === 404) {
        console.log("sync-docs: no release yet — skipped (--silent-if-missing).");
        return [];
      }
      throw new Error(`GitHub API ${res.status} ${res.statusText}`);
    }
    tag = (await res.json()).tag_name;
    if (!tag) throw new Error("the latest release has no tag_name");
  }

  const url = `https://github.com/${APP_REPO}/releases/download/${tag}/docs.tar.gz`;
  console.log(`sync-docs: docs.tar.gz from ${APP_REPO}@${tag}`);
  const res = await fetch(url);
  if (res.ok) {
    await unpack(res);
    return syncFromDir(join(tmpDir, "docs"));
  }
  if (res.status !== 404) throw new Error(`download failed: ${res.status} ${res.statusText} from ${url}`);
  // a release made before the app attached docs.tar.gz: the same docs from the release's own tagged source — still
  // the released docs, never the main branch's
  console.log(`sync-docs: ${tag} has no docs.tar.gz — its docs from the tag's source`);
  return fromSource(`refs/tags/${tag}`);
}

try {
  const slugs = FROM === "local" ? await fromLocal() : await fromRelease();
  if (slugs.length) console.log(`sync-docs: ${slugs.length} pages in src/content/docs/docs/ — ${slugs.join(", ")}`);
} catch (err) {
  console.error("sync-docs failed:", err.message);
  process.exit(1);
}
