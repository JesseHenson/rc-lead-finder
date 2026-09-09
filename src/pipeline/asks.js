// Generated from resources.yaml -> resources[name: ask].operations
// Track A: local posts asking for the work. Find and draft only — Rudy posts.

import { all, one, run, nowIso } from "../db/client.js";
import { startRun } from "./runs.js";

const ACTOR = "scraper_one/facebook-posts-search";

// The job description lists four service lines, not one. Each is its own
// search and its own recognised service on the lead record.
export const SERVICES = [
  { key: "Driveway & concrete", query: "power wash driveway",           re: /\b(driveway|concrete|sidewalk|walkway|patio|oil stain)/i },
  { key: "House wash",          query: "house washing recommendations", re: /\b(house.?wash|soft.?wash|siding|exterior of my house|mildew|algae)/i },
  { key: "Window cleaning",     query: "window cleaning recommendation", re: /\b(window.?clean|window.?wash|windows? (?:cleaned|washed)|glass clean)/i },
  { key: "Parking lot",         query: "parking lot cleaning",          re: /\b(parking.?lot|parking area|drive.?thru lane|dumpster pad|trash corral)/i },
  { key: "Building wash",       query: "building washing commercial",   re: /\b(building.?wash|storefront|awning|exterior of (?:the|our) building|facade)/i },
  { key: "Fence & deck",        query: "fence cleaning recommendations", re: /\b(fence|deck|cedar|pergola)/i },
  { key: "Roof & gutter",       query: "roof and gutter cleaning",      re: /\b(roof.?wash|roof clean|gutter)/i },
  { key: "Pressure washing",    query: "pressure washing recommendation", re: /\b(pressure.?wash|power.?wash)/i },
];

export const QUERIES = SERVICES.map(s => s.query);

// Somebody asking for the work, not somebody selling it.
const ASKING = /\b(recommend|recommendation|anyone know|looking for|need|who does|suggestions?|any good|help me find|quotes?|referrals?)\b/i;
const SELLING = /\b(we offer|call us|book now|dm for|our team|licensed and insured|free estimates? today|now booking|call or text \d)\b/i;
const COMMERCIAL = /\b(property manager|strip center|storefront|commercial|our building|hoa|parking lot|tenants?|facilities)\b/i;

const hours = (a, b) => (a - b) / 36e5;

export function detectService(text) {
  return SERVICES.find(s => s.re.test(text))?.key ?? null;
}

export function scoreAsk(post, { businessName }) {
  const text = post.postText || "";
  const service = detectService(text);

  if (!service) return { score: 0, service: null, already_tagged: 0, reject: "not about the work" };
  if (SELLING.test(text))
    return { score: 0, service, already_tagged: 0, reject: "a competitor advertising" };

  // Already recommended is a fact about the post, not a reason to drop it. The
  // job description keeps these as an optional second touch for visibility, so
  // they stay eligible and simply rank below fresh ground.
  const already = businessName && text.toLowerCase().includes(businessName.toLowerCase()) ? 1 : 0;

  let score = 0;
  if (ASKING.test(text)) score += 50;
  if (text.includes("?")) score += 10;

  const age = hours(Date.now(), (post.timestamp || 0) * 1000);
  if (age < 6) score += 25;
  else if (age < 24) score += 15;
  else if (age < 72) score += 5;

  if ((post.commentsCount ?? 0) < 5) score += 10;   // not already answered to death
  if (COMMERCIAL.test(text)) score += 8;
  if (already) score -= 30;

  return {
    score,
    service,
    already_tagged: already,
    reject: score < 50 ? (already ? "second touch, below the bar today" : "weak signal") : null,
  };
}

// Step 11 of the job description: the report has to say what Rudy should do,
// not just what was found.
export function followUp(post, { service, already_tagged }) {
  const text = post.postText || "";
  if (COMMERCIAL.test(text)) return "Commercial — call, don't just comment";
  if (/\bquotes?\b|\bhow much\b|\bprice\b|\bcost\b/i.test(text)) return "Wants a price — message directly";
  if (already_tagged) return "Already recommended — second touch only if it's quiet";
  if (/\basap|urgent|this week|before .* (visit|party|event)\b/i.test(text)) return "Time pressure — reach out today";
  return `Comment, then watch for a reply — ${service?.toLowerCase() ?? "general"}`;
}

export function draftComment(post, { businessName, website }, service) {
  const text = (post.postText || "").toLowerCase();
  const handle = `@${businessName}`;

  const byService = {
    "Driveway & concrete": `${handle} does driveways and concrete all over this area — they'll get that lifted.`,
    "House wash":          `${handle} soft-washes siding, including two-story, without streaking.`,
    "Window cleaning":     `${handle} does window cleaning as well as the exterior wash — one trip for both.`,
    "Parking lot":         `${handle} cleans small lots and drive-thru lanes, usually before opening.`,
    "Building wash":       `${handle} does storefronts and building exteriors on a recurring schedule.`,
    "Fence & deck":        `${handle} cleans fences and decks — makes a big difference before staining.`,
    "Roof & gutter":       `${handle} handles roof and gutter washing too.`,
    "Pressure washing":    `${handle} handles this kind of work around here.`,
  };

  const opener = byService[service]
    || (COMMERCIAL.test(text) ? byService["Building wash"] : byService["Pressure washing"]);
  return website ? `${opener} ${website}` : opener;
}

// kind: sync, part 1 — start every search at once and return. Eight queries ran
// back to back before; started together they cost one round trip instead of
// eight, and none of them holds the tool call open.
export async function startAskRuns(cfg, { territory, days = 2, limit = 60, waitForFinish = 0 } = {}) {
  const startDate = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const perQuery = Math.max(5, Math.ceil(limit / QUERIES.length));

  const results = await Promise.allSettled(QUERIES.map(query =>
    startRun(cfg, {
      actor: ACTOR,
      track: "asks",
      query,
      waitForFinish,
      input: {
        query,
        resultsCount: perQuery,
        searchType: "latest",
        location: territory.fb_location,
        startDate,
      },
    })
  ));

  const started = results.filter(r => r.status === "fulfilled").length;
  const errors = results.filter(r => r.status === "rejected").map(r => r.reason.message);
  if (!started) throw new Error(errors[0] || "No searches could be started");
  return { started, errors };
}

// kind: sync, part 2 — score and store what came back. Batches are ranked
// together so the daily cap goes to the strongest leads of the pass.
export function ingestAsks(cfg, { territory, batches }) {
  const seen = new Map();
  for (const { query, items } of batches)
    for (const p of items) if (p?.url && !seen.has(p.url)) seen.set(p.url, { p, query });

  let room = Math.max(0, (cfg.dailyCap ?? 10) - countDraftedToday());
  let added = 0, skipped = 0, secondTouch = 0;

  const ranked = [...seen.values()]
    .map(({ p, query }) => ({ p, query, ...scoreAsk(p, cfg) }))
    .sort((a, b) => b.score - a.score);

  for (const r of ranked) {
    const { p, query, score, reject, service, already_tagged } = r;
    if (one("SELECT url FROM ask WHERE url = :url", { url: p.url })) continue;

    const keep = !reject && room > 0;
    if (keep) { room--; if (already_tagged) secondTouch++; } else skipped++;

    run(`INSERT INTO ask (url, post_id, source, author_name, author_url, area,
                          posted_at, text, reactions, matched_query, service,
                          already_tagged, follow_up, score, draft_comment, status, found_at)
         VALUES (:url, :post_id, 'facebook', :author_name, :author_url, :area,
                 :posted_at, :text, :reactions, :matched_query, :service,
                 :already_tagged, :follow_up, :score, :draft_comment, :status, :found_at)`, {
      url: p.url,
      post_id: p.postId ?? null,
      author_name: p.author?.name ?? null,
      author_url: p.author?.profileUrl ?? null,
      area: territory.name,
      posted_at: new Date((p.timestamp || 0) * 1000).toISOString(),
      text: p.postText || "",
      reactions: p.reactionsCount ?? null,
      matched_query: query,
      service,
      already_tagged,
      follow_up: keep ? followUp(p, r) : null,
      score,
      draft_comment: keep ? draftComment(p, cfg, service) : null,
      status: keep ? "drafted" : "skipped",
      found_at: nowIso(),
    });
    if (keep) added++;
  }

  return { found: seen.size, drafted: added, second_touch: secondTouch, skipped, cap_room_left: room };
}

function countDraftedToday() {
  const day = nowIso().slice(0, 10);
  return one(
    `SELECT COUNT(*) AS n FROM ask WHERE status = 'drafted' AND substr(found_at,1,10) = :day`,
    { day }
  )?.n ?? 0;
}

// kind: read
export function listAsks({ status = "drafted", limit = 25 } = {}) {
  const sql = status === "all"
    ? `SELECT * FROM ask ORDER BY score DESC, found_at DESC LIMIT :limit`
    : `SELECT * FROM ask WHERE status = :status ORDER BY score DESC, found_at DESC LIMIT :limit`;
  return all(sql, status === "all" ? { limit } : { status, limit });
}

// kind: write — local only. Nothing is written back to Facebook.
export function markAsk({ url, outcome }) {
  const valid = ["posted", "skipped", "drafted"];
  if (!valid.includes(outcome)) throw new Error(`outcome must be one of ${valid.join(", ")}`);
  run(`UPDATE ask SET status = :outcome, touched_at = :now WHERE url = :url`,
      { outcome, now: nowIso(), url });
  return one("SELECT * FROM ask WHERE url = :url", { url });
}

export function weekRollup() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const r = one(`SELECT
      COUNT(*) AS found,
      SUM(status = 'posted')  AS posted,
      SUM(status = 'drafted') AS waiting
    FROM ask WHERE found_at >= :since`, { since }) || {};
  return {
    "asks found": r.found ?? 0,
    "comments posted": r.posted ?? 0,
    "still waiting on you": r.waiting ?? 0,
  };
}
