// Claude's written analysis of a sweep. Saving it is what closes the sweep, so
// the next plan knows where to start.

import { all, one, run, tx, nowIso } from "../db/client.js";

export function saveReport({ sweep_id = null, markdown, posts_seen = null } = {}) {
  const text = String(markdown ?? "").trim();
  if (!text) throw new Error("markdown is required");
  if (sweep_id != null && !one("SELECT id FROM sweep WHERE id = :id", { id: sweep_id }))
    throw new Error(`No sweep ${sweep_id}. Use the sweep_id that plan_sweep returned.`);

  const now = nowIso();
  tx(() => {
    run("INSERT INTO report (sweep_id, markdown, created_at) VALUES (:sweep_id, :markdown, :now)",
        { sweep_id, markdown: text, now });
    if (sweep_id != null)
      run(`UPDATE sweep SET status = 'done', finished_at = :now,
             posts_seen = COALESCE(:posts_seen, posts_seen)
           WHERE id = :sweep_id`, { now, posts_seen, sweep_id });
  });
  return latestReport();
}

export const latestReport = () => one("SELECT * FROM report ORDER BY id DESC LIMIT 1");

export const recentSweeps = (limit = 10) => all("SELECT * FROM sweep ORDER BY id DESC LIMIT :limit", { limit });
