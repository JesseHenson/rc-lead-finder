// Thin Apify REST client. No SDK, so nothing to vendor.
// Actor full names use "/" in the docs and "~" in the API path.
//
// Deliberately async. The synchronous run-sync-get-dataset-items endpoint 408s
// once a run passes 300 seconds, and Claude Desktop kills a tool call at about
// four minutes with no way to raise it. Both ceilings are escaped by starting
// runs and collecting them on a later call.

const BASE = "https://api.apify.com/v2";

export class ApifyError extends Error {}

export const TERMINAL = ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"];
export const isDone = status => TERMINAL.includes(status);

async function req(url, init, what) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApifyError(`${what} failed (${res.status}). ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Starts a run and returns as soon as Apify accepts it. waitForFinish is capped
// at 60s by the API; a short wait lets fast runs finish inside the first call.
export async function startActor(actor, input, { token, waitForFinish = 0, runTimeoutSecs = 900 } = {}) {
  if (!token) throw new ApifyError("No Apify token. Set it in the extension settings.");

  const path = actor.replace("/", "~");
  const url = `${BASE}/acts/${path}/runs`
    + `?token=${encodeURIComponent(token)}`
    + `&waitForFinish=${Math.min(60, Math.max(0, waitForFinish))}`
    + `&timeout=${runTimeoutSecs}`;

  const { data } = await req(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }, `Starting ${actor}`);

  return {
    id: data.id,
    status: data.status,
    datasetId: data.defaultDatasetId,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt ?? null,
  };
}

export async function getRun(runId, { token, waitForFinish = 0 } = {}) {
  const url = `${BASE}/actor-runs/${runId}`
    + `?token=${encodeURIComponent(token)}`
    + `&waitForFinish=${Math.min(60, Math.max(0, waitForFinish))}`;
  const { data } = await req(url, {}, `Checking run ${runId}`);
  return {
    id: data.id,
    status: data.status,
    datasetId: data.defaultDatasetId,
    finishedAt: data.finishedAt ?? null,
    exitCode: data.exitCode ?? null,
    message: data.statusMessage ?? null,
  };
}

export async function getDatasetItems(datasetId, { token, limit = 1000 } = {}) {
  const url = `${BASE}/datasets/${datasetId}/items`
    + `?token=${encodeURIComponent(token)}&clean=true&limit=${limit}`;
  const items = await req(url, {}, `Reading dataset ${datasetId}`);
  return Array.isArray(items) ? items : [];
}

export async function abortRun(runId, { token } = {}) {
  const url = `${BASE}/actor-runs/${runId}/abort?token=${encodeURIComponent(token)}`;
  await req(url, { method: "POST" }, `Aborting run ${runId}`);
}
