import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run, one } from "../src/db/client.js";
import { saveProfile } from "../src/watch/profile.js";
import { saveFindings, listFindings, markFinding, cleanLink, parsePosted, draftReply } from "../src/watch/findings.js";
import { saveReport, latestReport, recentSweeps } from "../src/watch/reports.js";
import { resetWatch } from "./helpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PROFILE = {
  business_name: "RC Pressure Washing TX", owner_name: "Rudy", website: "rcpressurewashingtx.com",
  service_area: "Spring", phone: "281-555-0100",
  services: [
    { name: "Pressure washing", kind: "offered", keywords: ["driveway", "power wash", "pressure wash"] },
    { name: "Window cleaning", kind: "considering", keywords: ["window clean"] },
  ],
};

beforeEach(() => { resetWatch(); saveProfile(PROFILE); });

const ask = (over = {}) => ({
  source: "nextdoor", kind: "lead", author: "Dana Reyes", place: "Northfield",
  text: "Looking for recommendations for power washing our driveway and sides of house",
  link: "https://nextdoor.com/p/abc123/?utm_source=share", posted_label: "15 Aug", ...over,
});

test("a batch is stored and counted by kind", () => {
  const r = saveFindings({ items: [
    ask(),
    { source: "facebook", kind: "signal", text: "HOA letters went out about mildew on driveways", topic: "HOA notices" },
    { source: "facebook", kind: "competitor", text: "Bayou Clean Co, 12 years in the area", author: "Bayou" },
  ] });
  assert.equal(r.saved, 3);
  assert.deepEqual(r.by_kind, { lead: 1, signal: 1, competitor: 1 });
  assert.equal(listFindings({ kind: "lead" }).length, 1);
});

test("an advertiser sent as a lead is downgraded to competitor, with the reason", () => {
  const r = saveFindings({ items: [ask({ text: "Fully insured, family owned. Driveway pressure washing, call 281-555-0142 for a free quote", link: null })] });
  assert.deepEqual(r.downgraded, [{ index: 0, reason: "a business advertising", now: "competitor" }]);
  assert.equal(listFindings({ kind: "lead" }).length, 0);
  assert.equal(listFindings({ kind: "competitor" })[0].downgraded, "a business advertising");
});

test("a real ask that only weakly resembles an advertiser stays a lead", () => {
  const texts = [
    "Can anyone recommend someone to pressure wash the front of my business?",
    "Looking for someone to pressure wash our company parking lot, any recommendations?",
    "Our team at church needs the parking lot pressure washed, anyone know a good company?",
    "ISO someone to pressure wash my trailer and driveway",
    "Getting the house ready to sell and trying to buy our next place, need the driveway pressure washed, any recs?",
    "Getting started on curb appeal before we list, anyone know a good pressure washing company?",
  ];
  for (const text of texts) {
    resetWatch();
    saveProfile(PROFILE);
    const r = saveFindings({ items: [ask({ text, link: null })] });
    assert.equal(r.by_kind.lead, 1, `expected a lead for: ${text}`);
    assert.equal(listFindings({ kind: "lead" }).length, 1, `expected to stay a lead for: ${text}`);
  }
});

test("a lead for a service only being considered becomes an opportunity", () => {
  const r = saveFindings({ items: [ask({ text: "Anyone recommend someone for window cleaning? Two story house.", link: null })] });
  assert.equal(r.by_kind.opportunity, 1);
  assert.equal(listFindings({ kind: "opportunity" })[0].service, "Window cleaning");
});

test("a lead without asking words is kept but flagged for review", () => {
  const r = saveFindings({ items: [ask({ text: "Our driveway is disgusting after the storm, power wash help", link: null })] });
  assert.equal(r.by_kind.lead, 1);
  assert.equal(r.needs_review.length, 1);
});

test("the same post twice is one finding — link query strings don't make it new", () => {
  saveFindings({ items: [ask()] });
  const r = saveFindings({ items: [ask({ link: "https://nextdoor.com/p/abc123/?other=1" })] });
  assert.equal(r.duplicates, 1);
  assert.equal(r.saved, 0);
});

test("without a link, author plus text is the identity", () => {
  saveFindings({ items: [ask({ link: null })] });
  assert.equal(saveFindings({ items: [ask({ link: null })] }).duplicates, 1);
});

test("a post saved without a link, then again with a link, is one finding whose link fills in", () => {
  saveFindings({ items: [ask({ link: null })] });
  const r = saveFindings({ items: [ask()] });
  assert.equal(r.duplicates, 1);
  assert.equal(r.saved, 0);
  const leads = listFindings({ kind: "lead" });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].link, "https://nextdoor.com/p/abc123/");
  const row = markFinding({ id: "https://nextdoor.com/p/abc123/", status: "contacted" });
  assert.ok(row, "the finding must be findable by its newly-added link");
  assert.equal(row.status, "contacted");
});

test("a finding table missing content_hash gets migrated on open", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-migrate-"));
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      import { join } from "node:path";
      const file = join(process.env.RC_DATA_DIR, "leads.db");
      const db = new DatabaseSync(file);
      db.exec(\`CREATE TABLE finding (
        key TEXT PRIMARY KEY, source TEXT NOT NULL, excerpt TEXT NOT NULL,
        kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', first_seen TEXT NOT NULL
      )\`);
      db.close();
    `], { env: { ...process.env, RC_DATA_DIR: dir } });

    const clientUrl = pathToFileURL(join(ROOT, "src", "db", "client.js")).href;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { open } from "${clientUrl}";
      const db = open();
      const cols = db.prepare("PRAGMA table_info(finding)").all().map(c => c.name);
      console.log(JSON.stringify(cols));
    `], { env: { ...process.env, RC_DATA_DIR: dir } }).toString();

    assert.match(out, /content_hash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("links keep origin and path only, and only for the right site", () => {
  assert.equal(cleanLink("/groups/1/posts/2/?__cft__=x", "facebook"), "https://www.facebook.com/groups/1/posts/2/");
  assert.equal(cleanLink("https://evil.example/groups/1/posts/2/", "facebook"), null);
  assert.equal(cleanLink("https://nextdoor.com/p/abc/?s=1", "nextdoor"), "https://nextdoor.com/p/abc/");
});

test("bad items are reported by index and good ones still land", () => {
  const r = saveFindings({ items: [ask({ source: "reddit" }), ask({ kind: "maybe" }), ask({ text: "  " }), ask()] });
  assert.equal(r.saved, 1);
  assert.deepEqual(r.invalid.map(i => i.index), [0, 1, 2]);
});

test("excerpts are capped at 400 characters", () => {
  saveFindings({ items: [ask({ text: "Looking for a power wash quote. " + "x".repeat(900), link: null })] });
  assert.equal(listFindings({ kind: "lead" })[0].excerpt.length, 400);
});

test("the drafted reply is first person, names the business, never tags", () => {
  const d = draftReply({ ...PROFILE }, { author: "Dana Reyes", service: "Pressure washing" });
  assert.match(d, /^Hi Dana, this is Rudy with RC Pressure Washing TX\./);
  assert.match(d, /pressure washing/);
  assert.match(d, /281-555-0100/);
  assert.doesNotMatch(d, /@/);
});

test("a reply Claude wrote in the owner's voice is kept as written", () => {
  saveFindings({ items: [ask({ draft_reply: "Hey Dana — Rudy here, happy to swing by Thursday." })] });
  assert.equal(listFindings({ kind: "lead" })[0].draft_reply, "Hey Dana — Rudy here, happy to swing by Thursday.");
});

test("posted dates parse from each site's format", () => {
  const fb = new Date(parsePosted("Friday, September 12, 2026 at 9:21 AM"));
  assert.deepEqual([fb.getFullYear(), fb.getMonth(), fb.getDate(), fb.getHours()], [2026, 8, 12, 9]);
  const nd = new Date(parsePosted("5 Sep"));
  assert.deepEqual([nd.getMonth(), nd.getDate()], [8, 5]);
  assert.ok(nd.getTime() <= Date.now() + 864e5, "a yearless date is never in the future");
  assert.ok(Math.abs(Date.parse(parsePosted("3h")) - (Date.now() - 3 * 36e5)) < 60e3);
  assert.equal(parsePosted("whenever"), null);
  assert.ok(parsePosted("September 12, 2026"));
  assert.ok(parsePosted("Sept 5"));
  assert.ok(parsePosted("2026-09-12T10:00:00Z"));
  for (const junk of ["Maybe later", "Mayor announced new rules", "Marvel fan club meeting",
                       "Janitor needed", "Marketplace", "June bug season"])
    assert.equal(parsePosted(junk), null, junk);
});

test("a lead is marked by its link, even with a query string", () => {
  saveFindings({ items: [ask()] });
  const row = markFinding({ id: "https://nextdoor.com/p/abc123/?x=1", status: "contacted" });
  assert.equal(row.status, "contacted");
  assert.ok(row.touched_at);
  assert.throws(() => markFinding({ id: "x", status: "posted" }), /status/);
  assert.equal(markFinding({ id: "https://nextdoor.com/p/nope/", status: "won" }), null);
});

test("saving a report closes its sweep", () => {
  run("INSERT INTO sweep (mode, sources, since, started_at) VALUES ('daily', '[]', '2026-09-01T00:00:00Z', '2026-09-13T12:00:00Z')");
  const id = one("SELECT MAX(id) id FROM sweep").id;
  saveReport({ sweep_id: id, markdown: "## 1 lead\nDana wants a driveway done.", posts_seen: 42 });
  assert.equal(latestReport().sweep_id, id);
  const s = recentSweeps(1)[0];
  assert.equal(s.status, "done");
  assert.equal(s.posts_seen, 42);
  assert.throws(() => saveReport({ sweep_id: 99999, markdown: "x" }), /No sweep/);
  assert.throws(() => saveReport({ markdown: "  " }), /markdown/);
});

test("findings can't be saved before onboarding", () => {
  resetWatch();
  assert.throws(() => saveFindings({ items: [ask()] }), /start_onboarding/);
});

test("saving findings against a sweep_id that doesn't exist is refused", () => {
  assert.throws(() => saveFindings({ sweep_id: 99999, items: [ask()] }), /No sweep 99999/);
});
