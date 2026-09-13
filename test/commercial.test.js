import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, pickContact, servicesFor } from "../src/pipeline/prospects.js";

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
