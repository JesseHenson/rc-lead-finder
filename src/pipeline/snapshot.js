// Generated from resources.yaml -> dashboard.panels
// Builds the data.json payload and rewrites dashboard.html.
// Every dashboard_affecting operation ends here.

import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { one } from "../db/client.js";
import { dataDir } from "../db/client.js";
import { renderDashboard } from "../dashboard/render.js";
import { listAsks, weekRollup } from "./asks.js";
import { listProspects } from "./prospects.js";
import { getTerritory } from "./territory.js";

const AGE = ts => {
  const h = (Date.now() - Date.parse(ts)) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const HOT = a =>
  /\bquotes?\b|\bhow much\b|\bprice\b/i.test(a.text) ? "asking for quotes"
  : /property manager|commercial|storefront|strip center/i.test(a.text) ? "commercial"
  : null;

const count = (sql, params = {}) => one(sql, params)?.n ?? 0;

export function buildData() {
  const territory = getTerritory();
  const today = new Date().toISOString().slice(0, 10);

  const stats = [
    { value: count("SELECT COUNT(*) n FROM ask WHERE substr(found_at,1,10) = :d", { d: today }), label: "Asks found today" },
    { value: count("SELECT COUNT(*) n FROM ask WHERE status = 'drafted'"),                        label: "Comments ready" },
    { value: count("SELECT COUNT(*) n FROM prospect WHERE excluded IS NULL"),                     label: "Commercial prospects" },
    { value: count("SELECT COUNT(*) n FROM prospect WHERE status = 'drafted'"),                   label: "Emails ready" },
  ];

  const secondTouch = count("SELECT COUNT(*) n FROM ask WHERE status = 'drafted' AND already_tagged = 1");

  return {
    generated_at: new Date().toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }),
    cap: Number(process.env.RC_DAILY_CAP || 10),
    commercial_area: territory?.maps_location ?? "target area",
    stats,
    asks: listAsks({ status: "drafted", limit: 25 }).map(a => ({
      source: "Facebook",
      area: a.area || territory?.name || "",
      age: AGE(a.posted_at || a.found_at),
      hot: HOT(a),
      excerpt: a.text.length > 320 ? a.text.slice(0, 317) + "…" : a.text,
      draft: a.draft_comment || "",
      url: a.url,
      who: a.author_name || null,
      service: a.service || null,
      second_touch: !!a.already_tagged,
      follow_up: a.follow_up || null,
    })),
    commercial: listProspects({ status: "drafted", limit: 40 }).map(p => ({
      name: p.name,
      address: p.address || "",
      building: p.building || "",
      contact: p.contact_name || "—",
      title: p.contact_title || "",
      services: p.services || "",
      email: p.email || "",
      draft_email: p.draft_email || "",
    })),
    second_touch: secondTouch,
    week: weekRollup(),
    footer: "Nothing here was posted or sent. Copy a draft, post it yourself, then tell Claude what happened.",
  };
}

export function dashboardPath() {
  return join(dataDir(), "dashboard.html");
}

export function dataPath() {
  return join(dataDir(), "data.json");
}

// SQLite is the store of record; these two are derived views of it, rewritten
// on every dashboard_affecting operation. data.json is written as well as
// inlined so the payload is inspectable without opening the HTML.
export async function writeSnapshot() {
  const data = buildData();
  await writeFile(dataPath(), JSON.stringify(data, null, 2), "utf8");
  return renderDashboard(data, dashboardPath());
}
