#!/usr/bin/env node
// Generated from resources.yaml -> tools[]
// stdio only. There is no HTTP surface and there cannot be one; see spec.md.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { startAskRuns, ingestAsks, listAsks, markAsk } from "./pipeline/asks.js";
import { startProspectRuns, ingestProspects, listProspects, markProspect } from "./pipeline/prospects.js";
import { collectRuns, pendingRuns, markIngested, runSummary } from "./pipeline/runs.js";
import { getTerritory, setTerritory } from "./pipeline/territory.js";
import { writeSnapshot, dashboardPath, dataPath, buildData } from "./pipeline/snapshot.js";
import { startDashboardServer, stopDashboardServer, serverUrl, isRunning } from "./dashboard/serve.js";
import { importRuns, listRecentRuns } from "./pipeline/import.js";
import { querySql, schema } from "./pipeline/query.js";
import { dbPath, adoptedFrom } from "./db/client.js";

const cfg = {
  apifyToken: process.env.APIFY_TOKEN || "",
  businessName: process.env.RC_BUSINESS_NAME || "RC Pressure Washing TX",
  website: process.env.RC_WEBSITE || "rcpressurewashingtx.com",
  dailyCap: Number(process.env.RC_DAILY_CAP || 10),
};

const TOOLS = [
  {
    name: "find_leads",
    description:
      "Search for new leads across all four service lines — pressure washing, "
      + "house/building wash, window cleaning, parking lots — and draft what to say. "
      + "track 'asks' searches Facebook for people asking for the work (residential); "
      + "track 'commercial' searches for freestanding small businesses worth a cold email; "
      + "'both' does both. Drafts are capped per day so it stays human-scale. "
      + "Nothing is posted or sent — Rudy does that himself. "
      + "Searches run in the background: this returns as soon as they are started, "
      + "and reports anything that already finished. If it says some are still "
      + "running, call check_leads in a minute or two to collect the rest.",
    inputSchema: {
      type: "object",
      properties: {
        track: { type: "string", enum: ["asks", "commercial", "both"], default: "asks" },
        days: { type: "number", description: "How far back to search, for asks. Default 2.", default: 2 },
        limit: { type: "number", description: "Max results to pull. Default 60.", default: 60 },
      },
    },
  },
  {
    name: "show_leads",
    description:
      "Show leads already found: what's drafted and waiting, what's been posted or emailed. "
      + "Also returns the path to the dashboard page.",
    inputSchema: {
      type: "object",
      properties: {
        track: { type: "string", enum: ["asks", "commercial", "both"], default: "both" },
        status: {
          type: "string",
          enum: ["drafted", "posted", "emailed", "replied", "won", "skipped", "all"],
          default: "drafted",
        },
        limit: { type: "number", default: 25 },
      },
    },
  },
  {
    name: "check_leads",
    description:
      "Collect any searches that were still running when find_leads returned, store "
      + "what they found, and refresh the dashboard. Safe to call repeatedly — it only "
      + "picks up what has finished since last time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "import_past_runs",
    description:
      "Rebuild the lead store from searches that already ran on Apify. Use this after "
      + "reinstalling, or when the dashboard is empty but searches were run before — the "
      + "datasets are still on Apify and cost nothing to re-read. Imports the most recent "
      + "finished runs for this bundle's two actors; pass run_ids to import specific ones.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many recent Apify runs to look through. Default 50.", default: 50 },
        run_ids: { type: "array", items: { type: "string" }, description: "Specific Apify run ids, instead of scanning." },
        force: { type: "boolean", description: "Re-ingest runs already imported.", default: false },
        list_only: { type: "boolean", description: "Just list what's on Apify, import nothing.", default: false },
      },
    },
  },
  {
    name: "query_leads",
    description:
      "Run a read-only SQL query against the lead store. Tables: ask, prospect, run, "
      + "territory. Call with no query to see the schema and row counts. SELECT and WITH "
      + "only — this cannot change anything.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A SELECT or WITH query. Omit to get the schema instead." },
        limit: { type: "number", description: "Row cap when the query has no LIMIT. Default 200.", default: 200 },
      },
    },
  },
  {
    name: "serve_dashboard",
    description:
      "Open the lead dashboard on a local web address so it stays up to date on its own, "
      + "instead of being a file you have to reopen. Returns a http://127.0.0.1 URL. "
      + "The page refreshes itself every 15 seconds while this stays running. "
      + "Pass stop: true to shut it down.",
    inputSchema: {
      type: "object",
      properties: {
        stop: { type: "boolean", description: "Shut the local server down instead of starting it.", default: false },
        port: { type: "number", description: "Preferred port. Defaults to 8765, next free one if taken." },
      },
    },
  },
  {
    name: "mark_lead",
    description:
      "Record what happened to a lead. id is the post URL for an ask, or the place id "
      + "for a commercial prospect. outcome: posted, skipped, emailed, replied, won.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        outcome: {
          type: "string",
          enum: ["posted", "skipped", "emailed", "replied", "won", "drafted"],
        },
      },
      required: ["id", "outcome"],
    },
  },
  {
    name: "set_territory",
    description:
      "Set the service area every search is limited to. fb_location is a Facebook place "
      + "name like 'Spring, Texas'; maps_location is a Google Maps area like 'Spring, TX'.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        fb_location: { type: "string" },
        maps_location: { type: "string" },
        radius_note: { type: "string" },
      },
      required: ["name", "fb_location", "maps_location"],
    },
  },
];

const server = new Server(
  { name: "rc-lead-finder", version: "0.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Collect whatever has finished and fold it into SQLite. Bounded by budgetMs so
// the call always returns well inside the host's tool-call timeout.
async function collectAndIngest(territory, budgetMs, beat = async () => {}) {
  await beat("Checking searches…");
  const { ready, stillRunning, failed } = await collectRuns(cfg, { budgetMs, beat });

  const askBatches = [];
  const askRows = [];
  let commercial = null;

  // Mark a run ingested only once its items are actually in SQLite. Marking
  // first would retire the run on a failed insert and lose posts Apify has
  // already been paid for — they are not re-fetchable.
  for (const { row, items } of ready) {
    if (row.track === "asks") {
      askBatches.push({ query: row.query, items });
      askRows.push({ row, count: items.length });
      continue;
    }
    const r = ingestProspects(cfg, { territory, items });
    commercial = commercial
      ? { found: commercial.found + r.found, drafted: commercial.drafted + r.drafted,
          excluded: commercial.excluded + r.excluded }
      : r;
    markIngested(row.id, items.length);
    await beat(`Collected ${row.query || row.track} — ${items.length} results`);
  }

  const out = {};
  if (askBatches.length) {
    out.asks = ingestAsks(cfg, { territory, batches: askBatches });
    for (const { row, count } of askRows) markIngested(row.id, count);
    await beat(`Collected ${askRows.length} searches — ${out.asks.found} posts`);
  }
  if (commercial) out.commercial = commercial;
  if (failed.length) out.failed = failed;

  const waiting = stillRunning.length;
  out.still_running = waiting;
  out.next_step = waiting
    ? `${waiting} search${waiting === 1 ? "" : "es"} still running — call check_leads again in a minute.`
    : "Everything collected. Nothing left running.";
  return out;
}

const ok = payload => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
const fail = msg => ({ content: [{ type: "text", text: msg }], isError: true });

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;

  // Progress notifications are a free win where the host honours them (the MCP
  // SDK's resetTimeoutOnProgress restarts the countdown on each one) and a no-op
  // where it doesn't. They are never the load-bearing fix — the async run ledger
  // is. The host has to have sent a progressToken for these to be legal at all.
  const token = request.params?._meta?.progressToken;
  let ticks = 0;
  const beat = async message => {
    if (token == null || !extra?.sendNotification) return;
    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: ++ticks, message },
      });
    } catch { /* a host that refuses progress must not break the tool */ }
  };

  try {
    switch (name) {
      case "find_leads": {
        const territory = getTerritory();
        if (!territory) return fail("No service area set. Use set_territory first.");
        if (!cfg.apifyToken) return fail("No Apify token configured. Add it in the extension settings.");

        const track = args.track || "asks";
        const out = { territory: territory.name, started: {} };

        // Start everything first, then spend the remaining budget collecting.
        // waitForFinish lets a fast search land inside this same call.
        await beat("Starting searches…");
        if (track === "asks" || track === "both")
          out.started.asks = await startAskRuns(cfg, {
            territory, days: args.days ?? 2, limit: args.limit ?? 60, waitForFinish: 20,
          });
        if (track === "commercial" || track === "both")
          out.started.commercial = await startProspectRuns(cfg, {
            territory, limit: args.limit ?? 60, waitForFinish: 20,
          });

        Object.assign(out, await collectAndIngest(territory, 60_000, beat));
        out.dashboard = await writeSnapshot();
        return ok(out);
      }

      case "check_leads": {
        const territory = getTerritory();
        if (!territory) return fail("No service area set. Use set_territory first.");
        const out = await collectAndIngest(territory, 90_000, beat);
        out.dashboard = await writeSnapshot();
        return ok(out);
      }

      case "show_leads": {
        const track = args.track || "both";
        const status = args.status || "drafted";
        const limit = args.limit ?? 25;
        const out = {
          store: dbPath(),
          adopted_from: adoptedFrom(),
          dashboard: dashboardPath(),
          json: dataPath(),
          live: isRunning() ? serverUrl() : null,
          runs: runSummary(),
        };

        if (track === "asks" || track === "both") {
          const askStatus = ["posted", "skipped", "drafted", "all"].includes(status) ? status : "all";
          out.asks = listAsks({ status: askStatus, limit }).map(a => ({
            who: a.author_name, url: a.url, area: a.area, service: a.service,
            found_at: a.found_at, already_tagged: !!a.already_tagged,
            score: a.score, status: a.status, follow_up: a.follow_up,
            text: a.text.slice(0, 240), draft: a.draft_comment,
          }));
        }
        if (track === "commercial" || track === "both") {
          const pStatus = ["emailed", "replied", "won", "skipped", "drafted", "all"].includes(status) ? status : "all";
          out.commercial = listProspects({ status: pStatus, limit }).map(p => ({
            place_id: p.place_id, name: p.name, address: p.address,
            contact: p.contact_name, role: p.contact_title, services: p.services,
            email: p.email, status: p.status, touched_at: p.touched_at,
            score: p.lead_score, draft: p.draft_email,
          }));
        }
        return ok(out);
      }

      case "import_past_runs": {
        const territory = getTerritory();
        if (!territory) return fail("No service area set. Use set_territory first.");
        if (!cfg.apifyToken) return fail("No Apify token configured. Add it in the extension settings.");

        if (args.list_only) {
          const runs = await listRecentRuns(cfg, { limit: args.limit ?? 50 });
          return ok({ store: dbPath(), runs });
        }

        await beat("Asking Apify what has already run…");
        const out = await importRuns(cfg, {
          territory,
          limit: args.limit ?? 50,
          runIds: args.run_ids ?? null,
          force: !!args.force,
        });
        out.store = dbPath();
        out.dashboard = await writeSnapshot();
        return ok(out);
      }

      case "query_leads": {
        if (!args.sql) return ok({ store: dbPath(), schema: schema() });
        return ok({ store: dbPath(), ...querySql(args.sql, { limit: args.limit ?? 200 }) });
      }

      case "serve_dashboard": {
        if (args.stop) {
          const was = await stopDashboardServer();
          return ok({ stopped: was, note: was ? "Local dashboard server stopped." : "It wasn't running." });
        }
        await writeSnapshot();
        const { url, port, reused } = await startDashboardServer({
          buildData,
          port: args.port ?? 8765,
        });
        return ok({
          url, port, reused,
          mode: "live — the page polls every 15s and refreshes itself",
          scope: "Bound to 127.0.0.1 only. Nothing outside this machine can reach it.",
          lifetime: "Runs until Claude Desktop restarts the extension. The file copy below always survives.",
          file: dashboardPath(),
          json: dataPath(),
        });
      }

      case "mark_lead": {
        const isUrl = /^https?:\/\//.test(args.id);
        const row = isUrl ? markAsk({ url: args.id, outcome: args.outcome })
                          : markProspect({ place_id: args.id, outcome: args.outcome });
        if (!row) return fail(`No lead found for id ${args.id}`);
        await writeSnapshot();
        return ok({ updated: isUrl ? row.url : row.place_id, status: row.status });
      }

      case "set_territory": {
        const t = setTerritory(args);
        await writeSnapshot();
        return ok(t);
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return fail(`${name} failed: ${err.message}`);
  }
});

await server.connect(new StdioServerTransport());
