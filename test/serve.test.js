import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startDashboardServer, stopDashboardServer, isRunning, serverUrl } from "../src/dashboard/serve.js";

const fake = { generated_at: "now", stats: [{ value: 3, label: "Asks found today" }], asks: [], commercial: [], week: {} };
let calls = 0;
const buildData = () => { calls++; return { ...fake, calls }; };

after(() => stopDashboardServer());

test("the server binds loopback and serves the page", async () => {
  const { url, port } = await startDashboardServer({ buildData, port: 8899 + 100 });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.ok(port > 0);
  assert.ok(isRunning());

  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);

  const html = await res.text();
  assert.match(html, /__LIVE__/, "served HTML must keep the marker so the page polls instead of using a snapshot");
  assert.doesNotMatch(html, /"generated_at":"now"/, "served HTML must not have data baked in");
});

test("a request with a foreign Host header is refused (DNS rebinding guard)", async () => {
  const http = await import("node:http");
  const u = new URL(serverUrl());
  const res = await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: "/", headers: { Host: "evil.example" } },
      resolve);
    req.on("error", reject);
    req.end();
  });
  assert.equal(res.statusCode, 403);
});

test("data.json is rebuilt from the store on every request", async () => {
  const url = serverUrl();
  const a = await (await fetch(url + "data.json")).json();
  const b = await (await fetch(url + "data.json")).json();
  assert.ok(b.calls > a.calls, "each request must read fresh state, not a cached payload");
});

test("starting twice reuses the same listener", async () => {
  const again = await startDashboardServer({ buildData });
  assert.equal(again.reused, true);
  assert.equal(again.url, serverUrl());
});

test("an unknown path 404s rather than leaking the filesystem", async () => {
  const res = await fetch(serverUrl() + "../../etc/passwd");
  assert.equal(res.status, 404);
});

test("it steps to the next port when the preferred one is taken", async () => {
  const first = serverUrl();
  await stopDashboardServer();

  const blocker = (await import("node:http")).createServer();
  await new Promise(r => blocker.listen(9100, "127.0.0.1", r));

  const { port } = await startDashboardServer({ buildData, port: 9100 });
  assert.notEqual(port, 9100);
  assert.ok(port > 9100);

  await new Promise(r => blocker.close(r));
  assert.ok(first);
});

test("two concurrent starts share one listener", async () => {
  await stopDashboardServer();
  const [a, b] = await Promise.all([
    startDashboardServer({ buildData, port: 9200 }),
    startDashboardServer({ buildData, port: 9200 }),
  ]);
  assert.equal(a.port, b.port, "a race must not leave a second listener orphaned");
  assert.equal(await stopDashboardServer(), true);
  assert.equal(isRunning(), false);
});

test("stopping is idempotent", async () => {
  await startDashboardServer({ buildData, port: 9300 });
  assert.equal(await stopDashboardServer(), true);
  assert.equal(await stopDashboardServer(), false);
  assert.equal(isRunning(), false);
});
