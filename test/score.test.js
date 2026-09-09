import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAsk, draftComment, detectService, followUp } from "../src/pipeline/asks.js";
import { classify, pickContact, servicesFor } from "../src/pipeline/prospects.js";

const cfg = { businessName: "RC Pressure Washing TX", website: "rcpressurewashingtx.com" };
const ago = h => ({ timestamp: Math.floor((Date.now() - h * 36e5) / 1000) });

test("a neighbor asking scores through", () => {
  const r = scoreAsk({ postText: "Anyone know a good pressure washer? Driveway is green.", commentsCount: 1, ...ago(2) }, cfg);
  assert.equal(r.reject, null);
  assert.ok(r.score >= 50);
});

test("verb endings still match the trade words", () => {
  for (const text of ["pressure washing recommendations?", "who power washes houses", "need my siding washed"]) {
    const r = scoreAsk({ postText: text, ...ago(2) }, cfg);
    assert.notEqual(r.reject, "not about the work", `"${text}" should be recognised as the work`);
  }
});

test("a competitor advertising is rejected as an ad, not as off-topic", () => {
  const r = scoreAsk({ postText: "We offer pressure washing, licensed and insured, call us today!", ...ago(1) }, cfg);
  assert.equal(r.reject, "a competitor advertising");
});

test("a post already naming RC is kept as a second touch, not dropped", () => {
  const r = scoreAsk({ postText: "Need my driveway pressure washed, anyone used RC Pressure Washing TX?", commentsCount: 0, ...ago(1) }, cfg);
  assert.equal(r.already_tagged, 1);
  const fresh = scoreAsk({ postText: "Need my driveway pressure washed, any recommendations?", commentsCount: 0, ...ago(1) }, cfg);
  assert.equal(fresh.already_tagged, 0);
  assert.ok(fresh.score > r.score, "an untagged post must outrank the same post already tagged");
});

test("all four service lines from the job description are recognised", () => {
  assert.equal(detectService("need my windows cleaned on the storefront"), "Window cleaning");
  assert.equal(detectService("who cleans a small parking lot"), "Parking lot");
  assert.equal(detectService("looking for building washing for our unit"), "Building wash");
  assert.equal(detectService("driveway is filthy"), "Driveway & concrete");
});

test("every lead carries a follow-up action for the report", () => {
  const post = { postText: "Property manager here, need the storefront washed quarterly" };
  assert.match(followUp(post, { service: "Building wash", already_tagged: 0 }), /Commercial/);
  assert.match(followUp({ postText: "how much for a driveway?" }, { service: "Driveway & concrete", already_tagged: 0 }), /price/i);
  assert.ok(followUp({ postText: "fence needs a clean" }, { service: "Fence & deck", already_tagged: 0 }).length > 0);
});

test("the decision maker picked is the highest-ranked role available", () => {
  const c = pickContact({ contacts: [
    { name: "Front Desk", title: "Receptionist" },
    { name: "Ray B", title: "Owner / Operator" },
    { name: "Sam K", title: "Shift Manager" },
  ]});
  assert.equal(c.contact_name, "Ray B");
  assert.equal(c.contact_title, "Owner");
});

test("likely services follow the property type", () => {
  assert.match(servicesFor({ category: "Bank", name: "FCCU" }), /Window cleaning/);
  assert.match(servicesFor({ category: "Fast food restaurant", name: "Zaxby's" }), /Dumpster pad/);
});

test("an unrelated ask is off-topic", () => {
  assert.equal(scoreAsk({ postText: "Anyone know a good plumber?", ...ago(1) }, cfg).reject, "not about the work");
});

test("fresh posts outrank stale ones", () => {
  const text = "Looking for someone to wash my siding, recommendations?";
  assert.ok(scoreAsk({ postText: text, ...ago(2) }, cfg).score >
            scoreAsk({ postText: text, ...ago(100) }, cfg).score);
});

test("the draft mentions the page and matches the detected service", () => {
  const d = draftComment({ postText: "my driveway is filthy" }, cfg, "Driveway & concrete");
  assert.match(d, /@RC Pressure Washing TX/);
  assert.match(d, /driveway/i);
  assert.match(d, /rcpressurewashingtx\.com/);

  const w = draftComment({ postText: "need the storefront windows done" }, cfg, "Window cleaning");
  assert.match(w, /window/i);
});

test("Rudy's rule: a small Zaxby's is in, a Texas Children's offshoot is out", () => {
  assert.equal(classify({ name: "Zaxby's", category: "Fast food restaurant", reviewsCount: 220 }).excluded, null);
  assert.match(classify({ name: "Texas Children's Pediatrics Spring" }).excluded, /corporate/);
});

test("big footprints and high-traffic locations are dropped", () => {
  assert.match(classify({ name: "Willowbrook Mall" }).excluded, /too big/);
  assert.match(classify({ name: "Busy Diner", reviewsCount: 4000 }).excluded, /corporate-managed/);
});

test("a freestanding bank scores above a generic prospect", () => {
  const bank = classify({ name: "First Community Credit Union", category: "Bank", email: "a@b.c", website: "x", reviewsCount: 90 });
  const other = classify({ name: "Some Shop", category: "Retail", reviewsCount: 90 });
  assert.ok(bank.score > other.score);
});
