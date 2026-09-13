import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getProfile, saveProfile, profileGaps, normGroupUrl } from "../src/watch/profile.js";
import { resetWatch } from "./helpers.js";
import { tx, run } from "../src/db/client.js";

beforeEach(() => resetWatch());

const FULL = {
  business_name: "RC Pressure Washing TX",
  owner_name: "Rudy",
  website: "rcpressurewashingtx.com",
  service_area: "Spring, Klein, The Woodlands",
  cadence: { daily: "7:00 AM", weekly: "Monday 7:00 AM" },
  signals: ["heavy rain", "HOA letters"],
  services: [
    { name: "Pressure washing", kind: "offered", keywords: ["driveway", "power wash"] },
    { name: "Window cleaning", kind: "considering", keywords: ["window cleaning"] },
  ],
  groups: [{ url: "https://www.facebook.com/groups/northsideneighbors/?ref=share", name: "Northside Neighbors", posts_per_day: 96 }],
  terms: [
    { platform: "facebook", term: "driveway", purpose: "lead" },
    { platform: "nextdoor", term: "power washing", purpose: "lead" },
  ],
  competitors: [{ name: "Bayou Clean Co" }],
};

test("there is no profile until one is saved", () => {
  assert.equal(getProfile(), null);
  assert.deepEqual(profileGaps(), ["no profile yet"]);
});

test("a full profile round-trips with lists and JSON fields intact", () => {
  const p = saveProfile(FULL);
  assert.equal(p.business_name, "RC Pressure Washing TX");
  assert.deepEqual(p.cadence, FULL.cadence);
  assert.equal(p.services.length, 2);
  assert.deepEqual(p.services.find(s => s.name === "Pressure washing").keywords, ["driveway", "power wash"]);
  assert.equal(p.groups[0].url, "https://www.facebook.com/groups/northsideneighbors/", "query string and extras stripped");
  assert.equal(p.groups[0].active, true);
  assert.equal(p.nextdoor_enabled, true);
  assert.deepEqual(profileGaps(p), []);
});

test("a partial save merges scalars and replaces only the lists it sends", () => {
  saveProfile(FULL);
  const p = saveProfile({ phone: "281-555-0100", terms: [{ platform: "facebook", term: "mildew", purpose: "signal" }] });
  assert.equal(p.business_name, "RC Pressure Washing TX", "scalar kept");
  assert.equal(p.phone, "281-555-0100");
  assert.equal(p.services.length, 2, "services untouched");
  assert.deepEqual(p.terms.map(t => t.term), ["mildew"], "terms replaced");
  assert.ok(profileGaps(p).includes("no Facebook lead search terms"));
});

test("business_name is required on the first save", () => {
  assert.throws(() => saveProfile({ owner_name: "Rudy" }), /business_name/);
});

test("invalid list entries are refused and nothing is written", () => {
  saveProfile(FULL);
  assert.throws(() => saveProfile({ services: [{ name: "Gutters", kind: "maybe" }] }), /offered.*considering/);
  assert.throws(() => saveProfile({ terms: [{ platform: "reddit", term: "x", purpose: "lead" }] }), /platform/);
  assert.throws(() => saveProfile({ groups: [{ url: "https://example.com/groups/x" }] }), /Facebook group/);
  assert.equal(getProfile().services.length, 2);
});

test("a competitor page URL drops the query string and hash", () => {
  saveProfile(FULL);
  const p = saveProfile({ competitors: [{ name: "Bayou", page_url: "https://www.facebook.com/bayoucleanco?mibextid=ZbWKwL#x" }] });
  assert.equal(p.competitors[0].page_url, "https://www.facebook.com/bayoucleanco");
});

test("an unparseable competitor page URL is stored as null", () => {
  saveProfile(FULL);
  const p = saveProfile({ competitors: [{ name: "Bayou", page_url: "not a url" }] });
  assert.equal(p.competitors[0].page_url, null);
});

test("group URLs normalise to one canonical form", () => {
  assert.equal(normGroupUrl("https://m.facebook.com/groups/1234567890123456/posts/1/"), "https://www.facebook.com/groups/1234567890123456/");
});

test("with no groups and Nextdoor off there are no sources", () => {
  const p = saveProfile({ ...FULL, groups: [], nextdoor_enabled: false });
  assert.ok(profileGaps(p).some(g => /no sources/.test(g)));
});

test("tx() rolls back partial writes on error", () => {
  saveProfile(FULL);
  assert.equal(getProfile().services.length, 2);
  assert.throws(() => tx(() => { run("DELETE FROM service"); throw new Error("boom"); }), /boom/);
  assert.equal(getProfile().services.length, 2, "delete was rolled back");
});

test("tx() returns the callback's value on success", () => {
  assert.equal(tx(() => 42), 42);
  assert.deepEqual(tx(() => ({ a: 1 })), { a: 1 });
});
