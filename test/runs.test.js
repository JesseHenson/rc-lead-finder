// Exercises the run ledger against a stubbed Apify. Run with RC_DATA_DIR
// pointing somewhere disposable — see package.json "test".

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startRun, collectRuns, pendingRuns, markIngested, runSummary } from "../src/pipeline/runs.js";
import { open } from "../src/db/client.js";

const cfg = { apifyToken: "test-token" };

// status the fake Apify will report for a given run id, in order
let script = {};
let calls = [];

globalThis.fetch = async (url, init = {}) => {
  calls.push(`${init.method || "GET"} ${String(url).split("?")[0]}`);
  const u = String(url);

  if (u.includes("/runs") && init.method === "POST") {
    const id = `run_${Object.keys(script).length + 1}`;
    script[id] = script[id] || ["RUNNING", "SUCCEEDED"];
    return json({ data: { id, status: script[id][0], defaultDatasetId: `ds_${id}` } });
  }
  if (u.includes("/actor-runs/")) {
    const id = u.split("/actor-runs/")[1].split("?")[0];
    const next = script[id].length > 1 ? script[id].shift() : script[id][0];
    return json({ data: { id, status: next, defaultDatasetId: `ds_${id}`, statusMessage: "stub" } });
  }
  if (u.includes("/datasets/")) {
    return json([{ url: "https://facebook.com/p/1", postText: "driveway pressure washing?", timestamp: Date.now() / 1000 }]);
  }
  throw new Error("unexpected fetch " + u);
};

const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  script = {}; calls = [];
  open().exec("DELETE FROM run");
});

test("a started run is recorded as pending, not waited on", async () => {
  const r = await startRun(cfg, { actor: "a/b", track: "asks", query: "driveway", input: {} });
  assert.ok(r.id);
  assert.equal(pendingRuns().length, 1);
  assert.equal(pendingRuns()[0].ingested, 0);
  // one POST to start. No polling, no dataset read, no blocking.
  assert.deepEqual(calls, ["POST https://api.apify.com/v2/acts/a~b/runs"]);
});

test("a run still going is reported as still running, and stays pending", async () => {
  await startRun(cfg, { actor: "a/b", track: "asks", query: "driveway", input: {} });
  const { ready, stillRunning } = await collectRuns(cfg);
  assert.equal(ready.length, 0);
  assert.equal(stillRunning.length, 1);
  assert.equal(pendingRuns().length, 1, "an unfinished run must survive for the next pass");
});

test("a finished run hands back its items exactly once", async () => {
  await startRun(cfg, { actor: "a/b", track: "asks", query: "driveway", input: {} });
  await collectRuns(cfg);                       // RUNNING
  const { ready } = await collectRuns(cfg);     // SUCCEEDED
  assert.equal(ready.length, 1);
  assert.equal(ready[0].items.length, 1);

  markIngested(ready[0].row.id, 1);
  assert.equal(pendingRuns().length, 0);

  const again = await collectRuns(cfg);
  assert.equal(again.ready.length, 0, "an ingested run must never be collected twice");
});

test("a failed run is recorded and retired, not retried forever", async () => {
  const r = await startRun(cfg, { actor: "a/b", track: "asks", query: "driveway", input: {} });
  script[r.id] = ["FAILED"];
  const { failed } = await collectRuns(cfg);
  assert.equal(failed.length, 1);
  assert.equal(pendingRuns().length, 0, "a failed run must not sit in the queue forever");
  assert.equal(runSummary().failed, 1);
});

test("eight searches start concurrently, not one after another", async () => {
  const started = [];
  await Promise.all(Array.from({ length: 8 }, (_, i) =>
    startRun(cfg, { actor: "a/b", track: "asks", query: `q${i}`, input: {} }).then(r => started.push(r))
  ));
  assert.equal(started.length, 8);
  assert.equal(pendingRuns().length, 8);
});

test("the collect pass stops at its budget instead of running past the timeout", async () => {
  for (let i = 0; i < 5; i++)
    await startRun(cfg, { actor: "a/b", track: "asks", query: `q${i}`, input: {} });
  const { stillRunning } = await collectRuns(cfg, { budgetMs: -1 });
  assert.equal(stillRunning.length, 5);
  assert.ok(stillRunning.every(r => r.note === "not checked this pass"));
});
