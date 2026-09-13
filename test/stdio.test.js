// The bundle as Claude Desktop sees it: a child process on stdio.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = mkdtempSync(join(tmpdir(), "rc-stdio-"));
const client = new Client({ name: "stdio-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "src", "index.js")],
  env: { ...process.env, RC_DATA_DIR: DIR, RC_BUSINESS_NAME: "RC Pressure Washing TX", RC_WEBSITE: "rcpressurewashingtx.com" },
}));

after(async () => {
  await client.callTool({ name: "serve_dashboard", arguments: { stop: true } });
  await client.close();
  rmSync(DIR, { recursive: true, force: true });
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
  return r.content.map(c => c.text);
};
const last = texts => JSON.parse(texts[texts.length - 1]);

test("exactly the market watch tools are exposed", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), [
    "mark_lead", "plan_sweep", "query_data", "save_findings", "save_profile", "save_report",
    "serve_dashboard", "setup_schedule", "show_findings", "show_profile", "start_onboarding",
  ]);
});

test("onboarding to dashboard, end to end", async () => {
  const [script] = await call("start_onboarding");
  assert.match(script, /first-time setup/);
  assert.match(script, /default: RC Pressure Washing TX/);

  const initial = last(await call("show_profile"));
  assert.match(initial.next, /start_onboarding/);

  const saved = last(await call("save_profile", {
    business_name: "RC Pressure Washing TX", owner_name: "Rudy", service_area: "Spring",
    cadence: { weekly: "Monday 7:00 AM" },
    services: [{ name: "Pressure washing", kind: "offered", keywords: ["driveway", "power wash"] }],
    terms: [{ platform: "nextdoor", term: "power washing", purpose: "lead" }],
  }));
  assert.deepEqual(saved.gaps, []);

  const planTexts = await call("plan_sweep", { mode: "weekly" });
  assert.match(planTexts[0], /^# Sweep \d+/);
  const plan = last(planTexts);
  assert.equal(plan.searches.length, 1);

  const found = last(await call("save_findings", { sweep_id: plan.sweep_id, items: [
    { source: "nextdoor", kind: "lead", author: "Dana Reyes", text: "Any recs for someone to power wash our driveway?", link: "https://nextdoor.com/p/a1/?s=1" },
    { source: "nextdoor", kind: "lead", text: "Fully insured, call us for a free quote on driveway pressure washing" },
  ] }));
  assert.equal(found.saved, 2);
  assert.equal(found.downgraded.length, 1);

  last(await call("save_report", { sweep_id: plan.sweep_id, markdown: "## Today in one line\nOne lead.", posts_seen: 12 }));

  const leads = last(await call("show_findings", { kind: "lead" }));
  assert.equal(leads.findings.length, 1);
  assert.equal(leads.findings[0].link, "https://nextdoor.com/p/a1/");
  assert.match(leads.findings[0].draft_reply, /Rudy with RC Pressure Washing TX/);

  assert.equal(last(await call("mark_lead", { id: "https://nextdoor.com/p/a1/", status: "contacted" })).status, "contacted");

  const [steps] = await call("setup_schedule");
  assert.match(steps, /Run now/);

  const dash = last(await call("serve_dashboard", { port: 9400 }));
  const data = await (await fetch(dash.url + "data.json")).json();
  assert.equal(data.leads[0].status, "contacted");
  assert.match(data.today.report.markdown, /One lead/);

  assert.equal(last(await call("query_data", { sql: "SELECT COUNT(*) n FROM finding" })).rows[0].n, 2);
  const refused = await client.callTool({ name: "query_data", arguments: { sql: "DELETE FROM finding" } });
  assert.equal(refused.isError, true);
});

test("tools explain what's missing instead of crashing", async () => {
  const r = await client.callTool({ name: "save_findings", arguments: { items: "nope" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /items must be an array/);
});
