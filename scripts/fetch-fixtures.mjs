#!/usr/bin/env node
// Pull the datasets from runs that already happened and save them under
// fixtures/. Those runs are already paid for; testing against them costs
// nothing and, unlike a live scrape, gives the same answer twice.
//
//   APIFY_TOKEN=... node scripts/fetch-fixtures.mjs [limit]
//
// Then `npm test` picks them up automatically — see test/fixtures.test.js.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures");
const token = process.env.APIFY_TOKEN;
const limit = Number(process.argv[2] || 25);

if (!token) {
  console.error("Set APIFY_TOKEN first. Same token the extension uses.");
  process.exit(1);
}

const ACTORS = {
  "scraper_one/facebook-posts-search": "asks",
  "scrapesage/google-maps-scraper": "commercial",
};

const api = async path => {
  const res = await fetch(`https://api.apify.com/v2${path}${path.includes("?") ? "&" : "?"}token=${token}`);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const runs = (await api(`/actor-runs?desc=1&limit=${limit}`)).data?.items ?? [];
if (!runs.length) {
  console.error("No runs found on this account.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// actorId is an id, not a name, so resolve names once and match on those.
const names = {};
for (const r of runs) {
  if (names[r.actId] !== undefined) continue;
  try {
    const a = await api(`/acts/${r.actId}`);
    names[r.actId] = `${a.data.username}/${a.data.name}`;
  } catch { names[r.actId] = null; }
}

let saved = 0, skipped = 0;

for (const r of runs) {
  const name = names[r.actId];
  const track = ACTORS[name];
  if (!track) { skipped++; continue; }
  if (r.status !== "SUCCEEDED" || !r.defaultDatasetId) { skipped++; continue; }

  let items;
  try {
    items = await api(`/datasets/${r.defaultDatasetId}/items?clean=true&limit=1000`);
  } catch (err) {
    console.warn(`  ${r.id}: ${err.message.slice(0, 80)}`);
    skipped++;
    continue;
  }
  if (!Array.isArray(items) || !items.length) { skipped++; continue; }

  const file = join(OUT, `${track}-${r.id}.json`);
  writeFileSync(file, JSON.stringify({
    run_id: r.id,
    actor: name,
    track,
    finished_at: r.finishedAt,
    item_count: items.length,
    items,
  }, null, 2));
  console.log(`  saved ${track}-${r.id}.json — ${items.length} items`);
  saved++;
}

console.log(`\n${saved} fixture${saved === 1 ? "" : "s"} saved to fixtures/, ${skipped} run${skipped === 1 ? "" : "s"} skipped.`);
if (!saved) console.log("Nothing matched. Check the runs belong to the two actors this bundle uses.");
