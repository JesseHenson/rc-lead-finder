// Builds the dashboard payload from SQLite and rewrites dashboard.html.
// Every tool that changes what the page shows ends by calling writeSnapshot.

import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { all, one, dataDir } from "../db/client.js";
import { renderDashboard } from "../dashboard/render.js";
import { getProfile, profileGaps } from "../watch/profile.js";
import { listFindings } from "../watch/findings.js";
import { latestReport, recentSweeps } from "../watch/reports.js";

const WHEN = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
const local = iso => (iso ? new Date(iso).toLocaleString("en-US", WHEN) : null);
const ago = iso => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const daysAgo = d => new Date(Date.now() - d * 864e5).toISOString();
const count = (sql, params = {}) => one(sql, params)?.n ?? 0;

const card = f => ({
  key: f.key,
  source: f.source === "nextdoor" ? "Nextdoor" : "Facebook",
  place: f.place, author: f.author, excerpt: f.excerpt, link: f.link,
  posted: f.posted_label || local(f.posted_at),
  age: ago(f.posted_at || f.first_seen),
  service: f.service, topic: f.topic, note: f.note, downgraded: f.downgraded,
  draft: f.draft_reply, status: f.status,
});

export function buildData() {
  const profile = getProfile();
  const week = daysAgo(7);
  const month = daysAgo(30);
  const report = latestReport();
  const considering = new Set((profile?.services ?? [])
    .filter(s => s.kind === "considering").map(s => s.name.toLowerCase()));

  return {
    title: profile ? `${profile.business_name} — Market Watch` : "Market Watch",
    generated_at: new Date().toLocaleString("en-US", { weekday: "short", ...WHEN }),
    setup: { done: !!profile, gaps: profileGaps(profile) },
    stats: [
      { value: count("SELECT COUNT(*) n FROM finding WHERE kind = 'lead' AND status = 'new'"), label: "Leads waiting" },
      { value: count("SELECT COUNT(*) n FROM finding WHERE kind = 'lead' AND first_seen >= :s", { s: week }), label: "Leads this week" },
      { value: count("SELECT COUNT(*) n FROM finding WHERE kind = 'competitor' AND first_seen >= :s", { s: week }), label: "Competitor posts this week" },
      { value: count("SELECT COUNT(*) n FROM finding WHERE kind = 'opportunity' AND first_seen >= :s", { s: week }), label: "New-service asks this week" },
    ],
    today: {
      report: report ? { markdown: report.markdown, at: local(report.created_at) } : null,
      sweeps: recentSweeps(10).map(s => ({
        id: s.id, mode: s.mode, status: s.status, at: local(s.started_at), posts_seen: s.posts_seen, searches: s.searches,
      })),
    },
    leads: listFindings({ kind: "lead", days: 30, limit: 50 }).map(card),
    signals: listFindings({ kind: "signal", days: 30, limit: 50 }).map(card),
    competitors: {
      summary: all(`SELECT COALESCE(topic, author, 'Unnamed') AS name, COUNT(*) AS posts,
                           GROUP_CONCAT(DISTINCT source) AS sources, MAX(COALESCE(posted_at, first_seen)) AS last
                    FROM finding WHERE kind = 'competitor' AND first_seen >= :s
                    GROUP BY 1 ORDER BY posts DESC, last DESC LIMIT 25`, { s: month })
        .map(r => ({ name: r.name, posts: r.posts, sources: r.sources, last: ago(r.last) })),
      posts: listFindings({ kind: "competitor", days: 30, limit: 30 }).map(card),
    },
    opportunities: {
      summary: all(`SELECT COALESCE(service, topic, 'Unlabelled') AS service, COUNT(*) AS asks,
                           MAX(COALESCE(posted_at, first_seen)) AS last
                    FROM finding WHERE kind = 'opportunity' AND first_seen >= :s
                    GROUP BY 1 ORDER BY asks DESC, last DESC LIMIT 20`, { s: month })
        .map(r => ({ service: r.service, asks: r.asks, last: ago(r.last), considering: considering.has(String(r.service).toLowerCase()) })),
      posts: listFindings({ kind: "opportunity", days: 30, limit: 30 }).map(card),
    },
    footer: "Nothing here was posted. Reply yourself, then tell Claude what happened — for example, \"mark that lead contacted\".",
  };
}

export function dashboardPath() {
  return join(dataDir(), "dashboard.html");
}

export function dataPath() {
  return join(dataDir(), "data.json");
}

export async function writeSnapshot() {
  const data = buildData();
  await writeFile(dataPath(), JSON.stringify(data, null, 2), "utf8");
  return renderDashboard(data, dashboardPath());
}
