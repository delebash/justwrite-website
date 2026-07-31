// Starlight's `docs` content collection. The pages themselves are generated
// into src/content/docs/docs/ by scripts/sync-docs.mjs (gitignored) — this file
// only declares the collection so Astro's Content Layer can load them.
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
