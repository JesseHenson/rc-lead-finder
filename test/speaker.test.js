// Who is speaking, independent of trade. Providers reuse customer vocabulary
// ("free quote", "if you need help"), so the gate decides who is talking before
// anything is treated as a lead. Real data behind every case below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { speakerGate, isAsk, detectService, leadCheck, normText } from "../src/watch/speaker.js";

// The pilot trade, expressed as profile data rather than code.
const SERVICES = [
  { name: "Pressure washing", kind: "offered", keywords: ["pressure wash", "power wash", "driveway", "concrete", "sidewalk", "patio"] },
  { name: "House wash", kind: "offered", keywords: ["house wash", "soft wash", "siding", "mildew", "algae"] },
  { name: "Window cleaning", kind: "considering", keywords: ["window clean", "window wash"] },
  { name: "Fence & deck", kind: "offered", keywords: ["fence", "deck"] },
];

const CUSTOMERS = [
  "Can anyone recommend a good pressure washing company in Spring? Our driveway is covered in mildew.",
  "Who do you use to power wash your house? HOA just sent us a letter about the siding.",
  "Looking for quotes to get our driveway and sidewalk pressure washed, any recommendations?",
  "How much should it cost to have a two story house soft washed?",
  "Our fence is green again. Anyone have a pressure washing guy they like?",
  "ISO recommendations for a pressure/power washing service in Klein",
  "ISO raves for house pressure washing!",
  "ISO- Pressure washing company, thank you!",
  "Any recs for someone to power wash our driveway?",
  "Anyone know a good pressure washer? Driveway is green.",
  "We need work done on our driveway before the party this weekend, any recommendations for pressure washing?",
  "Hi all, we need work done on the house - siding is covered in mildew. Anyone have a good soft wash company?",
  "We need work on our fence, it is green again, anyone have a pressure washing guy they like?",
];

for (const text of CUSTOMERS) {
  test(`customer is a lead: ${text.slice(0, 48)}…`, () => {
    const r = leadCheck(text, SERVICES);
    assert.equal(r.gate, null, `gate fired: ${r.gate?.reason}`);
    assert.equal(r.ask, true, "ask wording not recognised");
    assert.ok(r.service, "service not recognised");
  });
}

const PROVIDERS = {
  "a competitor ad with a phone number":
    ["Window cleaning, pressure washing, gutter cleaning services.  Fully insured, family/veteran owned and run.   Call or text 281-555-0142 or PM me for your free quote, no site visit needed!", "competitor"],
  "a teenager offering the service":
    ["Hi, I'm a local teenager looking to make some extra money this spring by helping out around the neighborhood. Services offer: Power Washing", "competitor"],
  "a dad offering to pick up work":
    ["Hey everyone, I’m a dad looking to pick up some work this week. I have a pickup truck, I’m dependable, hardworking, and not afraid to get my hands dirty. Pressure washing, yard work, hauling.", "competitor"],
  "an owner introducing their business":
    ["Hey everyone! My name is Jordan, and I’m the owner of Jordan’s Mobile Detailing. I bring professional mobile detailing right to your driveway.", "competitor"],
  "someone starting a business asking about equipment":
    ["Thinking about starting a pressure washing business on the side, what surface cleaner should I buy?", "noise"],
  "an operator asking how to price jobs":
    ["What do you guys charge per square foot for driveways? Just getting started and trying to price my first jobs.", "noise"],
  "an operator comparing rigs":
    ["Best pressure washer for a new business? Looking at a 4gpm vs 8gpm skid, any recommendations?", "noise"],
  "a business hiring a technician":
    ["NOW HIRING: Pressure Washing Technician. We are looking for a reliable technician to start ASAP, must have a valid license.", "noise"],
  "a homeowner shopping for equipment, not the service":
    ["ISO recommendations on a pressure washer to buy for home use", "noise"],
};

for (const [what, [text, becomes]] of Object.entries(PROVIDERS)) {
  test(`gate fires: ${what}`, () => {
    const g = speakerGate(text);
    assert.ok(g, `${what} must be gated`);
    assert.equal(g.becomes, becomes);
  });
}

test("a competitor ad with a phone number is a strong gate", () => {
  const g = speakerGate(PROVIDERS["a competitor ad with a phone number"][0]);
  assert.equal(g.strong, true);
});

test("an operator comparing rigs is a weak gate", () => {
  const g = speakerGate(PROVIDERS["an operator comparing rigs"][0]);
  assert.equal(g.strong, false);
});

test("a homeowner planning to hire is not mistaken for a hiring post", () => {
  assert.equal(speakerGate("Looking at hiring someone to wash my house, recommendations?"), null);
});

test("keywords match word starts and plurals, not mid-word", () => {
  assert.equal(detectService("need my driveways done", SERVICES)?.name, "Pressure washing");
  assert.equal(detectService("who power-washes houses", SERVICES)?.name, "Pressure washing");
  assert.equal(detectService("offence taken", SERVICES), null);
});

test("offered services win over considering ones in the same post", () => {
  assert.equal(detectService("window cleaning and a driveway wash", SERVICES)?.kind, "offered");
});

test("curly apostrophes are normalised", () => {
  assert.equal(normText("I’m  here"), "I'm here");
});

test("an off-topic ask has no service", () => {
  assert.equal(leadCheck("Anyone know a good plumber?", SERVICES).service, null);
});

test("an ad without ask wording is not an ask", () => {
  assert.equal(isAsk("Pressure washing driveways, call or text 281-555-0142"), false);
});

// Local-only, third-party, gitignored. Every item was labeled "reject".
const LABELED = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "labeled");
const corpora = existsSync(LABELED) ? readdirSync(LABELED).filter(f => f.endsWith(".json")) : [];

for (const file of corpora) {
  test(`real posts (${file}): none passes as a lead`, () => {
    const { items } = JSON.parse(readFileSync(join(LABELED, file), "utf8"));
    const wrongly = items.filter(i => {
      const r = leadCheck(i.postText || "", SERVICES);
      return !r.gate && r.ask && r.service;
    });
    assert.equal(wrongly.length, 0,
      "would pass:\n" + wrongly.map(w => "  " + (w.postText || "").replace(/\s+/g, " ").slice(0, 90)).join("\n"));
  });
}

if (!corpora.length) test("real posts", { skip: "no fixtures/labeled/*.json — local-only corpus" }, () => {});
