import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { run, one } from "../src/db/client.js";
import { saveProfile } from "../src/watch/profile.js";
import { saveFindings } from "../src/watch/findings.js";
import { saveReport } from "../src/watch/reports.js";
import { buildData, writeSnapshot } from "../src/pipeline/snapshot.js";
import { resetWatch } from "./helpers.js";

beforeEach(() => resetWatch());

test("before onboarding the page says how to start", () => {
  const d = buildData();
  assert.equal(d.title, "Market Watch");
  assert.deepEqual(d.setup, { done: false, gaps: ["no profile yet"] });
  assert.deepEqual(d.leads, []);
  assert.equal(d.today.report, null);
});

test("every tab is fed from the store", () => {
  saveProfile({
    business_name: "RC Pressure Washing TX", service_area: "Spring",
    services: [{ name: "Pressure washing", kind: "offered", keywords: ["driveway"] },
               { name: "Window cleaning", kind: "considering", keywords: ["window cleaning"] }],
  });
  run("INSERT INTO sweep (mode, since, started_at) VALUES ('weekly', '2026-09-01T00:00:00Z', :now)", { now: new Date().toISOString() });
  const sweep_id = one("SELECT MAX(id) id FROM sweep").id;
  saveFindings({ sweep_id, items: [
    { source: "nextdoor", kind: "lead", author: "Dana Reyes", text: "Any recs for someone to power wash our driveway?", link: "https://nextdoor.com/p/a1/" },
    { source: "facebook", kind: "competitor", topic: "Bayou Clean Co", text: "Bayou Clean Co, driveways $99 this week" },
    { source: "nextdoor", kind: "competitor", topic: "Bayou Clean Co", text: "Bayou again: fall special on house washing" },
    { source: "facebook", kind: "opportunity", service: "Window cleaning", text: "Who does window cleaning for a two story?" },
    { source: "facebook", kind: "signal", topic: "HOA notices", text: "HOA letters about mildew went out today" },
  ] });
  saveReport({ sweep_id, markdown: "## Today in one line\nOne lead, Bayou is discounting.", posts_seen: 80 });

  const d = buildData();
  assert.equal(d.title, "RC Pressure Washing TX — Market Watch");
  assert.equal(d.stats.find(s => s.label === "Leads waiting").value, 1);
  assert.equal(d.leads[0].source, "Nextdoor");
  assert.match(d.leads[0].draft, /RC Pressure Washing TX/);
  assert.equal(d.signals[0].topic, "HOA notices");
  assert.deepEqual(d.competitors.summary.map(c => [c.name, c.posts]), [["Bayou Clean Co", 2]]);
  assert.equal(d.competitors.summary[0].sources.split(",").sort().join(","), "facebook,nextdoor");
  assert.deepEqual(d.opportunities.summary.map(o => [o.service, o.asks, o.considering]), [["Window cleaning", 1, true]]);
  assert.match(d.today.report.markdown, /Bayou is discounting/);
  assert.equal(d.today.sweeps[0].posts_seen, 80);
});

test("the snapshot inlines the data safely and has all five tabs", async () => {
  saveProfile({ business_name: "RC Pressure Washing TX", services: [{ name: "Pressure washing", kind: "offered", keywords: [] }] });
  saveFindings({ items: [{ source: "facebook", kind: "signal", text: "</script><b>storm</b> tonight" }] });
  const html = await readFile(await writeSnapshot(), "utf8");
  for (const tab of ["Today", "Leads", "Signals", "Competitors", "Opportunities"]) assert.match(html, new RegExp(`data-tab="${tab.toLowerCase()}"[^>]*>${tab}[ <]`));
  assert.match(html, /RC Pressure Washing TX — Market Watch/);
  assert.doesNotMatch(html, /<\/script><b>storm/, "post text must not break out of the script tag");
});
