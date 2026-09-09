// Ingest tests. These run against synthetic rows always, and additionally
// against any real Apify datasets cached under fixtures/ — see
// scripts/fetch-fixtures.mjs. Real data is what caught the address_city bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestProspects, listProspects } from "../src/pipeline/prospects.js";
import { ingestAsks, listAsks } from "../src/pipeline/asks.js";
import { open } from "../src/db/client.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "fixtures");

const cfg = { businessName: "RC Pressure Washing TX", website: "rcpressurewashingtx.com", dailyCap: 10 };
const territory = { name: "Spring / Klein", fb_location: "Spring, Texas", maps_location: "Spring, TX" };

const reset = () => { const db = open(); db.exec("DELETE FROM prospect"); db.exec("DELETE FROM ask"); };

test("a prospect with an email is actually written to the table", () => {
  reset();
  const r = ingestProspects(cfg, { territory, items: [{
    placeId: "p1", name: "Louetta Automotive", address: "8331 Louetta Rd",
    category: "Auto repair shop", email: "ray@louettaauto.com", website: "louettaauto.com",
    city: "Spring", reviewsCount: 80, contactName: "Ray B", contactTitle: "Owner",
  }]});

  assert.equal(r.drafted, 1, "insert must succeed — this is the regression that broke commercial ingest");
  const rows = listProspects({ status: "drafted" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contact_title, "Owner");
  assert.match(rows[0].draft_email, /Ray B/);
  assert.match(rows[0].draft_email, /Spring/, "the city only feeds the draft, never the table");
});

test("a prospect without an email is stored with the reason, not dropped", () => {
  reset();
  const r = ingestProspects(cfg, { territory, items: [
    { placeId: "p2", name: "No Email Co", category: "Insurance agency" },
    { placeId: "p3", name: "Willowbrook Mall", category: "Shopping mall", email: "x@y.com" },
  ]});
  assert.equal(r.drafted, 0);
  assert.equal(r.excluded, 2);
  const all = listProspects({ status: "all", limit: 10 });
  assert.equal(all.length, 2, "excluded prospects are kept so a bad filter call is auditable");
  assert.ok(all.every(p => p.excluded));
});

test("ingesting the same place twice does not duplicate it", () => {
  reset();
  const item = { placeId: "p9", name: "Twice Co", category: "Bank", email: "a@b.co" };
  ingestProspects(cfg, { territory, items: [item] });
  const second = ingestProspects(cfg, { territory, items: [item] });
  assert.equal(second.drafted, 0);
  assert.equal(listProspects({ status: "all", limit: 10 }).length, 1);
});

// --- real cached datasets, when present -------------------------------------

const fixtures = existsSync(FIXTURES)
  ? readdirSync(FIXTURES).filter(f => f.endsWith(".json"))
  : [];

test("cached Apify datasets ingest without throwing", { skip: fixtures.length ? false : "no fixtures/ — run scripts/fetch-fixtures.mjs" }, () => {
  reset();
  let asks = 0, prospects = 0;

  for (const f of fixtures) {
    const fx = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
    if (fx.track === "commercial") {
      const r = ingestProspects(cfg, { territory, items: fx.items });
      prospects += r.found;
    } else {
      const r = ingestAsks(cfg, { territory, batches: [{ query: fx.run_id, items: fx.items }] });
      asks += r.found;
    }
  }

  assert.ok(asks + prospects > 0, "fixtures were present but nothing was read from them");
  // Every row that went in must be readable back out.
  assert.doesNotThrow(() => listProspects({ status: "all", limit: 500 }));
  assert.doesNotThrow(() => listAsks({ status: "all", limit: 500 }));
});
