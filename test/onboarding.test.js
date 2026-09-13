import { test } from "node:test";
import assert from "node:assert/strict";
import { onboardingScript, scheduleSetup } from "../src/watch/onboarding.js";

const PROFILE = {
  business_name: "RC Pressure Washing TX", service_area: "Spring", nextdoor_enabled: true,
  cadence: { weekly: "Monday 7:00 AM" }, signals: [],
  services: [{ name: "Pressure washing", kind: "offered", keywords: ["driveway"] }],
  groups: [], competitors: [],
  terms: [{ platform: "nextdoor", term: "power washing", purpose: "lead" }],
};

test("first-time setup walks every step and uses the configured defaults", () => {
  const s = onboardingScript(null, { defaults: { business_name: "RC Pressure Washing TX", website: "rcpressurewashingtx.com" } });
  assert.match(s, /first-time setup/i);
  for (const h of ["The business", "Services", "Where to look", "Search words", "Competitors", "Signals", "replies", "How often", "Save", "schedule"])
    assert.match(s, new RegExp(`## \\d+\\. .*${h}`, "i"), `missing step: ${h}`);
  assert.match(s, /default: RC Pressure Washing TX/);
  assert.match(s, /save_profile/);
  assert.match(s, /setup_schedule/);
  assert.match(s, /Never join a group on your own/);
  assert.match(s, /posts per day/i);
  assert.match(s, /name the object or problem/i, "audience-first wording for Facebook");
  assert.match(s, /two liveliest groups/);
  assert.match(s, /stops at 30 searches/);
});

test("an existing profile gets an update script that names the gaps", () => {
  const s = onboardingScript(PROFILE);
  assert.match(s, /update the setup for RC Pressure Washing TX/);
  assert.match(s, /no schedule chosen|Still missing: nothing/);
  assert.match(s, /replace the saved list/);
});

test("schedule prompts follow the saved cadence and carry the rules", () => {
  const out = scheduleSetup(PROFILE);
  assert.equal(out.daily_prompt, null, "no daily cadence chosen");
  assert.match(out.weekly_prompt, /plan_sweep with mode "weekly"/);
  assert.match(out.weekly_prompt, /never post, comment, react, message, or join/i);
  assert.match(out.weekly_prompt, /Claude in Chrome/);
  assert.match(out.weekly_prompt, /login page/i);
  assert.match(out.steps, /Run now/);
  assert.match(out.steps, /Always allow/);
  assert.match(out.steps, /awake/);
  assert.match(out.steps, /only after the owner says yes/i);
});

test("with no cadence saved, both schedules are suggested", () => {
  const out = scheduleSetup({ ...PROFILE, cadence: {} });
  assert.ok(out.daily_prompt && out.weekly_prompt);
  assert.equal(out.cadence.daily, "7:00 AM");
  assert.equal(out.cadence.weekly, "Monday 8:00 AM");
  assert.match(out.steps, /at least an hour after the daily/);
});

test("scheduling needs a profile", () => {
  assert.throws(() => scheduleSetup(null), /start_onboarding/);
});
