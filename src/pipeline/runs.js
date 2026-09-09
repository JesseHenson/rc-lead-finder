// Generated from resources.yaml -> resources[name: run].operations
//
// The run ledger. Every Apify search is started, recorded here, and collected
// later — so no tool call ever has to sit and wait for a scraper.

import { all, one, run as exec, nowIso } from "../db/client.js";
import { startActor, getRun, getDatasetItems, isDone } from "./apify.js";

// kind: write — start one actor run and record it.
export async function startRun(cfg, { actor, track, query, input, waitForFinish = 0 }) {
  const r = await startActor(actor, input, { token: cfg.apifyToken, waitForFinish });
  exec(`INSERT INTO run (id, actor, track, query, dataset_id, status, ingested,
                         item_count, error, started_at, finished_at)
        VALUES (:id, :actor, :track, :query, :dataset_id, :status, 0,
                NULL, NULL, :started_at, :finished_at)
        ON CONFLICT(id) DO UPDATE SET status = :status, finished_at = :finished_at`, {
    id: r.id, actor, track, query: query ?? null,
    dataset_id: r.datasetId ?? null, status: r.status,
    started_at: nowIso(), finished_at: r.finishedAt,
  });
  return r;
}

// kind: read
export function pendingRuns() {
  return all(`SELECT * FROM run WHERE ingested = 0 ORDER BY started_at`);
}

export function runsFor(track) {
  return all(`SELECT * FROM run WHERE track = :track AND ingested = 0`, { track });
}

export function markIngested(id, itemCount) {
  exec(`UPDATE run SET ingested = 1, item_count = :n, finished_at = COALESCE(finished_at, :now)
        WHERE id = :id`, { id, n: itemCount, now: nowIso() });
}

export function markFailed(id, status, error) {
  exec(`UPDATE run SET ingested = 1, status = :status, error = :error, finished_at = :now
        WHERE id = :id`, { id, status, error: String(error).slice(0, 500), now: nowIso() });
}

// kind: sync — refresh the status of everything outstanding, and hand back the
// items for any run that has finished so the caller can ingest them.
// `budgetMs` keeps this well inside the host's tool-call timeout.
export async function collectRuns(cfg, { budgetMs = 90_000, beat = async () => {} } = {}) {
  const deadline = Date.now() + budgetMs;
  const ready = [];
  const stillRunning = [];
  const failed = [];

  for (const row of pendingRuns()) {
    if (Date.now() > deadline) { stillRunning.push({ ...row, note: "not checked this pass" }); continue; }

    let live;
    try {
      live = await getRun(row.id, { token: cfg.apifyToken });
    } catch (err) {
      stillRunning.push({ ...row, note: err.message });
      continue;
    }

    exec(`UPDATE run SET status = :status, dataset_id = COALESCE(:ds, dataset_id) WHERE id = :id`,
         { status: live.status, ds: live.datasetId ?? null, id: row.id });

    await beat(`${row.query || row.track}: ${live.status.toLowerCase()}`);

    if (!isDone(live.status)) { stillRunning.push({ ...row, status: live.status }); continue; }

    if (live.status !== "SUCCEEDED") {
      markFailed(row.id, live.status, live.message || live.status);
      failed.push({ query: row.query, track: row.track, status: live.status });
      continue;
    }

    try {
      const items = await getDatasetItems(live.datasetId || row.dataset_id, { token: cfg.apifyToken });
      ready.push({ row, items });
    } catch (err) {
      markFailed(row.id, "FAILED", err.message);
      failed.push({ query: row.query, track: row.track, status: "dataset unreadable" });
    }
  }

  return { ready, stillRunning, failed };
}

export function runSummary() {
  const r = one(`SELECT
      SUM(ingested = 0) AS waiting,
      SUM(ingested = 1 AND error IS NOT NULL) AS failed
    FROM run`) || {};
  return { waiting: r.waiting ?? 0, failed: r.failed ?? 0 };
}
