// One-off screenshot harness. Boots the JustWrite renderer in browser
// mode (npm run dev:vite at justwrite-app, port 5173), injects the
// user's real project snapshot into IndexedDB, navigates to each target
// view, and saves a PNG into public/screenshots/.
//
// Run with: node scripts/capture.mjs

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../public/screenshots");
const APP_URL = "http://localhost:5173/";

// Latest "The Cartographer's Daughter" autosave from AppData.
const PROJECT_FILE =
  "C:/Users/danel/AppData/Roaming/com.justwrite.app/projects/prj_mpy7cngm_x7ru.autosave.json";

const project = JSON.parse(fs.readFileSync(PROJECT_FILE, "utf8"));

const VIEWPORT = { width: 1920, height: 1180 };
const DEVICE_SCALE_FACTOR = 1;

const TARGETS = [
  { name: "home-real",         hash: "#/",            wait: 1500 },
  { name: "analysis",          hash: "#/analysis",    wait: 2500 },
  { name: "plotboard",         hash: "#/plot",        wait: 2000 },
  { name: "worldbuilding",     hash: "#/worldbuilding", wait: 1500 },
  { name: "timeline",          hash: "#/timeline",    wait: 1500 },
  { name: "settings-ai",       hash: "#/settings/audio",     wait: 1500, seedAi: true },
  { name: "studio",            hash: "#/studio",      wait: 2000, seedAi: true },
  { name: "ask-the-book",      hash: "#/",            wait: 1500, openChat: true },
];

async function setIDB(page, key, value) {
  await page.evaluate(
    async ({ k, v }) => {
      // Mirror idb-keyval's store: database "justwrite", object store "kv".
      const req = indexedDB.open("justwrite", 1);
      await new Promise((res, rej) => {
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      });
      const db = req.result;
      await new Promise((res, rej) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(v, k);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { k: key, v: value },
  );
}

async function main() {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  const page = await ctx.newPage();

  // First load — let the app boot once and set up IDB stores.
  console.log("→ first load");
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Seed the project snapshot.
  console.log("→ seeding project:", project?.project?.title || "(unknown)");
  await setIDB(page, "justwrite:project", project);

  // Seed minimal AI provider state so Settings/AI and Studio render
  // something. Two providers — one local Ollama, one OpenAI — purely
  // for visual realism; the values mirror what the AI store expects.
  const aiSeed = {
    providers: [
      {
        id: "ollama-local",
        name: "Ollama (local)",
        kind: "llm",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "",
        defaultModel: "llama3.1:8b",
        models: ["llama3.1:8b", "qwen2.5:14b", "mistral:7b"],
      },
      {
        id: "openai-cloud",
        name: "OpenAI",
        kind: "llm",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-••••••••••••",
        defaultModel: "gpt-4o-mini",
        models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
      },
      {
        id: "tts-elevenlabs",
        name: "ElevenLabs",
        kind: "tts",
        baseUrl: "https://api.elevenlabs.io/v1",
        apiKey: "sk-••••••••••••",
        voices: [],
      },
    ],
    defaults: {
      llm: "ollama-local",
      tts: "tts-elevenlabs",
      embedding: "ollama-local",
    },
  };
  await setIDB(page, "justwrite:ai", aiSeed);

  // Capture each target.
  for (const t of TARGETS) {
    console.log(`→ ${t.name}`);
    await page.goto(APP_URL + t.hash, { waitUntil: "domcontentloaded" });
    if (t.openChat) {
      await page.waitForTimeout(800);
      // Open chat panel via the keyboard shortcut.
      await page.keyboard.press("Meta+J");
      await page.waitForTimeout(400);
      // macOS Meta=Win key here, but if app uses Ctrl+J fall back:
      await page.keyboard.press("Control+J");
    }
    await page.waitForTimeout(t.wait);
    const file = path.join(outDir, `${t.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`   saved ${file}`);
  }

  await browser.close();
  console.log("done.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
