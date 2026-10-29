#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// `npm run deploy`: build and publish a family app's website — its own workflow (.github/workflows/deploy.yml), run
// when the user says so, never by another repository's workflow or by itself (the user, 2026-10-28: "each app
// website should run its own via something like npm run deploy other github workflows shouldnt be running other
// workflows"). The kit's (just-core/website/scripts/deploy.js) — every site copies it as it is; the site's
// package.json `justSite` names { appRepo, siteRepo } ("owner/name").
//
//   npm run deploy            # says which release's docs go live, asks, then starts the site's workflow
//   npm run deploy -- --yes   # no question (a scripted run)
//   npm run deploy -- --dry-run   # build and upload only: nothing goes live (the workflow's `publish: false`)
//
// The workflow builds the site with the docs of the app's latest release (scripts/sync-docs.js --from release) and
// publishes it on GitHub Pages. It needs the gh CLI signed in — the user's own login, no token in any repository.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).justSite ?? {};
const fail = (msg) => {
  console.error(`Deploy stopped: ${msg}`);
  process.exit(1);
};
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGh = (args) => {
  try {
    return gh(args);
  } catch {
    return null;
  }
};

if (!site.appRepo || !site.siteRepo) fail('package.json needs justSite { appRepo, siteRepo } — each "owner/name".');
if (tryGh(["--version"]) === null) fail("the gh CLI isn't installed (https://cli.github.com/), then run `gh auth login`.");
if (tryGh(["auth", "status"]) === null) fail("the gh CLI isn't signed in — run `gh auth login`.");

// which docs go live: the app's latest release, its docs.tar.gz or (a release made before it) the tag's source
const release = tryGh(["release", "view", "-R", site.appRepo, "--json", "tagName,assets"]);
let what;
if (release === null) {
  what =
    site.untilFirstRelease === "main"
      ? `the docs on ${site.appRepo}'s main branch — it has no release yet (justSite.untilFirstRelease)`
      : `no release of ${site.appRepo} yet — the site goes live with no docs pages`;
} else {
  const { tagName, assets } = JSON.parse(release);
  const attached = assets.some((a) => a.name === "docs.tar.gz");
  what = `${site.appRepo} ${tagName}'s docs (${attached ? "its docs.tar.gz" : "from the tag's source — the release has no docs.tar.gz"})`;
}
const dryRun = process.argv.includes("--dry-run");
console.log(`${dryRun ? "Dry run — build, never publish —" : "Deploy"} ${site.siteRepo} with ${what}.`);

if (!process.argv.includes("--yes") && !process.argv.includes("-y")) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(dryRun ? "Build it now (nothing is published)? [y/N] " : "Build and publish it now? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") fail("not confirmed — nothing started.");
}

try {
  const args = ["workflow", "run", "deploy.yml", "-R", site.siteRepo, "--ref", "main", ...(dryRun ? ["-f", "publish=false"] : [])];
  execFileSync("gh", args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
} catch {
  fail(`\`gh workflow run deploy.yml -R ${site.siteRepo}\` failed — is .github/workflows/deploy.yml on its main branch?`);
}
console.log(`Started: https://github.com/${site.siteRepo}/actions/workflows/deploy.yml`);
