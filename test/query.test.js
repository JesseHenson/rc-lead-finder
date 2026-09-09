import { test, before } from "node:test";
import assert from "node:assert/strict";
import { querySql, schema } from "../src/pipeline/query.js";
import { ingestProspects } from "../src/pipeline/prospects.js";
import { open } from "../src/db/client.js";

const cfg = { businessName: "RC Pressure Washing TX", website: "x.com", dailyCap: 10 };
const territory = { name: "Spring / Klein", fb_location: "Spring, Texas", maps_location: "Spring, TX" };

before(() => {
  open().exec("DELETE FROM prospect");
  ingestProspects(cfg, { territory, items: [
    { placeId: "q1", name: "Alpha Bank", category: "Bank", email: "a@b.co", reviewsCount: 50 },
    { placeId: "q2", name: "Beta Dental", category: "Dentist", email: "c@d.co", reviewsCount: 40 },
    { placeId: "q3", name: "Gamma Shop", category: "Retail" },
  ]});
});

test("no query returns the schema and row counts", () => {
  const s = schema();
  assert.deepEqual(s.map(t => t.table).sort(), ["ask", "prospect", "run", "territory"]);
  assert.equal(s.find(t => t.table === "prospect").rows, 3);
  assert.ok(s.find(t => t.table === "prospect").columns.some(c => c.startsWith("place_id")));
});

test("a SELECT returns rows", () => {
  const r = querySql("SELECT name, status FROM prospect ORDER BY name");
  assert.equal(r.row_count, 3);
  assert.equal(r.rows[0].name, "Alpha Bank");
});

test("WITH is allowed", () => {
  const r = querySql("WITH d AS (SELECT * FROM prospect WHERE email IS NOT NULL) SELECT COUNT(*) n FROM d");
  assert.equal(r.rows[0].n, 2);
});

test("an unbounded query is capped rather than returning everything", () => {
  const r = querySql("SELECT * FROM prospect", { limit: 2 });
  assert.equal(r.row_count, 2);
  assert.equal(r.truncated, true);
});

test("an explicit LIMIT is respected and not reported as truncated", () => {
  const r = querySql("SELECT * FROM prospect LIMIT 1", { limit: 200 });
  assert.equal(r.row_count, 1);
  assert.equal(r.truncated, false);
});

test("writes are refused", () => {
  for (const sql of [
    "DELETE FROM prospect",
    "UPDATE prospect SET status = 'won'",
    "INSERT INTO prospect (place_id, name, status, found_at) VALUES ('x','y','new','z')",
    "DROP TABLE prospect",
    "ATTACH DATABASE '/tmp/evil.db' AS evil",
    "PRAGMA table_info(prospect)",
  ]) {
    assert.throws(() => querySql(sql), /read-only/i, `${sql} must be refused`);
  }
  assert.equal(querySql("SELECT COUNT(*) n FROM prospect").rows[0].n, 3, "nothing was changed");
});

test("a second statement smuggled in is refused", () => {
  assert.throws(() => querySql("SELECT 1; DELETE FROM prospect"), /semicolon/i);
  assert.equal(querySql("SELECT COUNT(*) n FROM prospect").rows[0].n, 3);
});

test("a trailing semicolon is tolerated", () => {
  assert.equal(querySql("SELECT COUNT(*) n FROM prospect;").rows[0].n, 3);
});
