// Rebuild the store from runs that already happened on Apify.
//
// The run ledger is local, so a fresh install starts with nothing to collect
// even though the datasets are still sitting on Apify, already paid for. This
// asks Apify what ran, rather than asking our own table.

import { one, run as exec, nowIso } from "../db/client.js";
import { ingestAsks } from "./asks.js";
import { ingestProspects } from "./prospects.js";

const BASE = "https://api.apify.com/v2";

export const ACTOR_TRACKS = {
  "scraper_one/facebook-posts-search": "asks",
  "scrapesage/google-maps-scraper": "commercial",
};

async function api(path, token) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apify ${path.split("?")[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function listRecentRuns(cfg, { limit = 50 } = {}) {
  const { data } = await api(`/actor-runs?desc=1&limit=${limit}`, cfg.apifyToken);
  const items = data?.items ?? [];

  // actorId is an id, not a name. Resolve each distinct one once.
  const names = {};
  for (const r of items) {
    if (names[r.actId] !== undefined) continue;
    try {
      const a = await api(`/acts/${r.actId}`, cfg.apifyToken);
      names[r.actId] = `${a.data.username}/${a.data.name}`;
    } catch { names[r.actId] = null; }
  }

  return items.map(r => ({
    id: r.id,
    actor: names[r.actId],
    track: ACTOR_TRACKS[names[r.actId]] ?? null,
    status: r.status,
    datasetId: r.defaultDatasetId ?? null,
    finishedAt: r.finishedAt ?? null,
  }));
}

// Pull finished runs off Apify and fold them into SQLite. Already-ingested runs
// are skipped, and every ingested run is recorded so this stays idempotent.
export async function importRuns(cfg, { territory, limit = 50, runIds = null, force = false } = {}) {
  if (!cfg.apifyToken) throw new Error("No Apify token configured. Add it in the extension settings.");

  let candidates;
  if (runIds?.length) {
    candidates = [];
    for (const id of runIds) {
      const { data } = await api(`/actor-runs/${id}`, cfg.apifyToken);
      let actor = null;
      try {
        const a = await api(`/acts/${data.actId}`, cfg.apifyToken);
        actor = `${a.data.username}/${a.data.name}`;
      } catch { /* fall through to the guess below */ }
      candidates.push({
        id: data.id, actor,
        track: ACTOR_TRACKS[actor] ?? null,
        status: data.status, datasetId: data.defaultDatasetId ?? null,
        finishedAt: data.finishedAt ?? null,
      });
    }
  } else {
    candidates = await listRecentRuns(cfg, { limit });
  }

  const usable = candidates.filter(r => r.track && r.status === "SUCCEEDED" && r.datasetId);
  const seenOnApify = candidates.length;

  const askBatches = [];
  const askRows = [];
  let commercial = null;
  const imported = [];
  const skipped = [];

  for (const r of usable) {
    if (!force && one("SELECT id FROM run WHERE id = :id AND ingested = 1", { id: r.id })) {
      skipped.push({ id: r.id, why: "already imported" });
      continue;
    }

    let items;
    try {
      items = await api(`/datasets/${r.datasetId}/items?clean=true&limit=1000`, cfg.apifyToken);
    } catch (err) {
      skipped.push({ id: r.id, why: err.message.slice(0, 120) });
      continue;
    }
    if (!Array.isArray(items) || !items.length) { skipped.push({ id: r.id, why: "empty dataset" }); continue; }

    recordRun(r, items.length);

    if (r.track === "asks") {
      askBatches.push({ query: `import ${r.id}`, items });
      askRows.push({ id: r.id, count: items.length });
    } else {
      const res = ingestProspects(cfg, { territory, items });
      commercial = commercial
        ? { found: commercial.found + res.found, drafted: commercial.drafted + res.drafted,
            excluded: commercial.excluded + res.excluded }
        : res;
      markImported(r.id);
    }
    imported.push({ id: r.id, track: r.track, items: items.length });
  }

  const out = { runs_on_apify: seenOnApify, usable: usable.length, imported, skipped };
  if (askBatches.length) {
    // Insert first, mark second — a throw must not retire a run whose rows
    // never landed.
    out.asks = ingestAsks(cfg, { territory, batches: askBatches });
    for (const { id } of askRows) markImported(id);
  }
  if (commercial) out.commercial = commercial;

  if (!imported.length) {
    out.note = usable.length
      ? "Everything found was already imported. Pass force: true to re-ingest."
      : "No finished runs on this Apify account matched the two actors this bundle uses.";
  }
  return out;
}

function recordRun(r, itemCount) {
  exec(`INSERT INTO run (id, actor, track, query, dataset_id, status, ingested,
                         item_count, error, started_at, finished_at)
        VALUES (:id, :actor, :track, 'imported', :dataset_id, :status, 0,
                :item_count, NULL, :now, :finished_at)
        ON CONFLICT(id) DO UPDATE SET item_count = :item_count, status = :status`, {
    id: r.id, actor: r.actor ?? "unknown", track: r.track,
    dataset_id: r.datasetId, status: r.status, item_count: itemCount,
    now: nowIso(), finished_at: r.finishedAt,
  });
}

function markImported(id) {
  exec(`UPDATE run SET ingested = 1 WHERE id = :id`, { id });
}
