// A loopback HTTP server for the dashboard.
//
// The MCPB transport is stdio and cannot be anything else — but nothing stops
// this process from opening its own listener. Doing so buys the one thing the
// file:// snapshot cannot have: the page can fetch its own data, so it refreshes
// itself instead of being regenerated and reopened.
//
// Lifecycle is ours, not the host's. It lives as long as the MCP server process,
// which Claude Desktop restarts freely — so the file snapshot stays the durable
// artifact and this is the live view on top of it.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_PORT = 8765;
const MAX_TRIES = 12;

let server = null;
let url = null;
let starting = null;   // in-flight start, so two concurrent calls share one listener

function listen(port) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    // Loopback only. Never 0.0.0.0 — the page carries names, emails and drafts.
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

export function serverUrl() {
  return url;
}

export function isRunning() {
  return !!server;
}

export async function stopDashboardServer() {
  if (starting) { try { await starting; } catch { /* nothing to stop */ } }
  if (!server) return false;
  await new Promise(res => server.close(res));
  server = null; url = null;
  return true;
}

// buildData is injected so this module stays free of pipeline imports.
export async function startDashboardServer({ buildData, port = BASE_PORT } = {}) {
  if (server) return { url, port: server.address().port, reused: true };
  if (starting) return { ...(await starting), reused: true };
  starting = boot({ buildData, port }).finally(() => { starting = null; });
  return starting;
}

async function boot({ buildData, port }) {
  let bound = null, lastErr = null;
  for (let p = port; p < port + MAX_TRIES; p++) {
    try { bound = await listen(p); break; }
    catch (err) {
      lastErr = err;
      if (err.code !== "EADDRINUSE") throw err;
    }
  }
  if (!bound) throw new Error(`No free port in ${port}-${port + MAX_TRIES - 1}: ${lastErr?.message}`);

  const template = await readFile(join(HERE, "template.html"), "utf8");
  const live = template.replace("/*__DATA__*/", "/*__LIVE__*/");

  bound.on("request", async (req, res) => {
    const path = (req.url || "/").split("?")[0];
    try {
      if (path === "/data.json") {
        return send(res, 200, "application/json", JSON.stringify(buildData()));
      }
      if (path === "/health") {
        return send(res, 200, "application/json", JSON.stringify({ ok: true }));
      }
      if (path === "/" || path === "/index.html" || path === "/dashboard.html") {
        return send(res, 200, "text/html; charset=utf-8", live);
      }
      send(res, 404, "text/plain", "Not found");
    } catch (err) {
      send(res, 500, "text/plain", `Dashboard error: ${err.message}`);
    }
  });

  bound.on("error", () => { /* a dead socket must not take the MCP server down */ });
  bound.unref?.();

  server = bound;
  const actual = bound.address().port;
  url = `http://127.0.0.1:${actual}/`;
  return { url, port: actual, reused: false };
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(body);
}
