// Generated from resources.yaml -> resources[name: prospect].operations
// Track B: freestanding small commercial. Find, filter, draft. Rudy sends.

import { all, one, run, nowIso } from "../db/client.js";
import { startRun } from "./runs.js";

const ACTOR = "scrapesage/google-maps-scraper";

// What Rudy actually sells to: building wash, window cleaning, small lots.
export const CATEGORIES = [
  "bank", "credit union", "dentist", "veterinarian", "auto repair shop",
  "day care center", "medical clinic", "funeral home", "insurance agency",
  "fast food restaurant", "coffee shop", "car wash", "storage facility",
];

// Rudy's rule, in his words: a small Zaxby's works, a Texas Children's offshoot
// doesn't. The line isn't "chain" — it's whether the person who decides is on
// site or in a corporate facilities office three cities away.
const CORPORATE = new RegExp([
  "texas children", "memorial hermann", "houston methodist", "kelsey.?seybold",
  "cvs", "walgreens", "walmart", "target", "sam.?s club", "costco", "h.?e.?b",
  "kroger", "home depot", "lowe.?s", "best buy", "chase bank", "wells fargo",
  "bank of america", "u\\.?s\\.? bank", "school district", "isd\\b", "university",
  "hospital", "medical center", "city of ", "county of ",
].join("|"), "i");

const BIG_FOOTPRINT = /\b(mall|supercenter|shopping center|plaza|hospital|campus|terminal|stadium)\b/i;

export function classify(place) {
  const name = place.name || place.title || "";
  const cat = (place.category || place.categoryName || "").toLowerCase();

  if (CORPORATE.test(name)) return { excluded: "corporate — decision maker is off site" };
  if (BIG_FOOTPRINT.test(name) || BIG_FOOTPRINT.test(cat))
    return { excluded: "too big — not a one-visit job" };
  if ((place.reviewsCount ?? place.reviewCount ?? 0) > 1500)
    return { excluded: "high traffic — likely corporate-managed" };

  let score = 40;
  if (place.email || place.emails?.length) score += 25;
  if (place.website) score += 10;
  if (/bank|credit union/i.test(cat + name)) score += 15;   // he already does these
  if ((place.reviewsCount ?? 0) < 300) score += 10;
  if (place.leadScore) score = Math.max(score, Number(place.leadScore));

  return { excluded: null, score, building: "Freestanding, own lot" };
}

// The job description names the roles worth finding. Enriched contact data is
// noisy, so pick the closest match rather than taking whatever came back first.
const ROLES = [
  [/\bowner|principal|proprietor\b/i,                 "Owner"],
  [/\bgeneral manager|\bgm\b/i,                       "General manager"],
  [/\bfacilit/i,                                       "Facilities manager"],
  [/\bproperty manager|\bpm\b/i,                      "Property manager"],
  [/\boperations?|\bops\b/i,                          "Operations manager"],
  [/\bfranchisee?\b/i,                                "Franchise owner"],
  [/\bmanager\b/i,                                    "Manager"],
];

export function pickContact(place) {
  const cands = place.contacts?.length ? place.contacts
    : [{ name: place.contactName, title: place.contactTitle }];
  let best = null, bestRank = ROLES.length;
  for (const c of cands) {
    if (!c?.name && !c?.title) continue;
    const rank = ROLES.findIndex(([re]) => re.test(c.title || ""));
    const r = rank === -1 ? ROLES.length : rank;
    if (r < bestRank) { best = c; bestRank = r; }
  }
  if (!best) return { contact_name: null, contact_title: null };
  return {
    contact_name: best.name ?? null,
    contact_title: bestRank < ROLES.length ? ROLES[bestRank][1] : (best.title ?? null),
  };
}

// What this building most likely needs, in Rudy's four service lines.
export function servicesFor(place) {
  const c = `${place.category || place.categoryName || ""} ${place.name || place.title || ""}`.toLowerCase();
  const out = ["Building wash"];
  if (/bank|credit union|dentist|clinic|medical|insurance|office/.test(c)) out.push("Window cleaning");
  if (/bank|credit union|restaurant|coffee|food|car wash|auto|storage/.test(c)) out.push("Parking lot");
  if (/restaurant|coffee|food/.test(c)) out.push("Dumpster pad");
  return out.join(", ");
}

export function draftEmail(p, { businessName, website }) {
  const who = p.contact_name ? `${p.contact_name} — ` : "";
  const spot = /bank|credit union/i.test(p.category || "")
    ? "the drive-thru canopy and entry walk"
    : /auto|car wash/i.test(p.category || "")
      ? "the apron out front, where the oil tracks toward the street"
      : /restaurant|coffee|food/i.test(p.category || "")
        ? "the trash corral and the entry walk"
        : "the entry walk and the parking stalls nearest the building";

  const lines = (p.services || "Building wash").toLowerCase();

  return [
    `${who}I do ${lines} for a few freestanding businesses around ${p.address_city || "this area"}.`,
    `Looking at your building, ${spot} would clean up well in a single early-morning visit,`,
    `before you open. No disruption to your day.`,
    ``,
    `Worth a quick number?`,
    ``,
    `Rudy Colunga`,
    `${businessName}${website ? ` · ${website}` : ""}`,
  ].join("\n");
}

// kind: sync, part 1 — start the search, don't wait for it.
export async function startProspectRuns(cfg, { territory, categories, limit = 60, waitForFinish = 0 } = {}) {
  const r = await startRun(cfg, {
    actor: ACTOR,
    track: "commercial",
    query: territory.maps_location,
    waitForFinish,
    input: {
      searchQueries: categories?.length ? categories : CATEGORIES,
      locationQuery: territory.maps_location,
      maxResults: limit,
      enrichContacts: true,
      skipClosedPlaces: true,
    },
  });
  return { started: 1, run_id: r.id };
}

// kind: sync, part 2 — filter, draft and store what came back.
export function ingestProspects(cfg, { territory, items }) {
  let added = 0, excluded = 0;

  for (const place of items) {
    const id = place?.placeId || place?.place_id || place?.url;
    if (!id) continue;
    if (one("SELECT place_id FROM prospect WHERE place_id = :id", { id })) continue;

    const verdict = classify(place);
    const email = place.email || place.emails?.[0] || null;

    // Fields that only feed the draft, never the table.
    const city = place.city || territory.maps_location;

    const row = {
      place_id: id,
      name: place.name || place.title || "(unnamed)",
      address: place.address || place.fullAddress || null,
      category: place.category || place.categoryName || null,
      building: verdict.building ?? null,
      website: place.website || null,
      phone: place.phone || null,
      email,
      ...pickContact(place),
      services: servicesFor(place),
      lead_score: verdict.score ?? null,
      excluded: verdict.excluded,
    };

    const keep = !verdict.excluded && !!email;
    row.draft_email = keep ? draftEmail({ ...row, address_city: city }, cfg) : null;
    row.status = keep ? "drafted" : "skipped";
    if (!keep && !verdict.excluded) row.excluded = "no email found";
    row.found_at = nowIso();

    // Named parameters are listed explicitly. Spreading a working object into
    // the statement is what broke this: node:sqlite rejects any key the SQL
    // does not name, and `address_city: undefined` does not remove the key.
    run(`INSERT INTO prospect (place_id, name, address, category, building, website,
                               phone, email, contact_name, contact_title, services,
                               lead_score, excluded, draft_email, status, found_at)
         VALUES (:place_id, :name, :address, :category, :building, :website,
                 :phone, :email, :contact_name, :contact_title, :services,
                 :lead_score, :excluded, :draft_email, :status, :found_at)`, {
      place_id: row.place_id, name: row.name, address: row.address,
      category: row.category, building: row.building, website: row.website,
      phone: row.phone, email: row.email,
      contact_name: row.contact_name, contact_title: row.contact_title,
      services: row.services, lead_score: row.lead_score,
      excluded: row.excluded, draft_email: row.draft_email,
      status: row.status, found_at: row.found_at,
    });

    if (keep) added++; else excluded++;
  }

  return { found: items.length, drafted: added, excluded };
}

// kind: read
export function listProspects({ status = "drafted", limit = 25 } = {}) {
  const sql = status === "all"
    ? `SELECT * FROM prospect ORDER BY lead_score DESC LIMIT :limit`
    : `SELECT * FROM prospect WHERE status = :status ORDER BY lead_score DESC LIMIT :limit`;
  return all(sql, status === "all" ? { limit } : { status, limit });
}

// kind: write — local only. No mail is sent by the bundle.
export function markProspect({ place_id, outcome }) {
  const valid = ["emailed", "replied", "won", "skipped", "drafted"];
  if (!valid.includes(outcome)) throw new Error(`outcome must be one of ${valid.join(", ")}`);
  run(`UPDATE prospect SET status = :outcome, touched_at = :now WHERE place_id = :place_id`,
      { outcome, now: nowIso(), place_id });
  return one("SELECT * FROM prospect WHERE place_id = :place_id", { place_id });
}
