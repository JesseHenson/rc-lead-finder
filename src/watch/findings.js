// What a sweep found. Claude reads the posts and says what each one is; this
// module stores it, refuses what is malformed, and overrides Claude only where
// the author is plainly not a customer.

import { createHash } from "node:crypto";
import { all, one, run, tx, nowIso } from "../db/client.js";
import { getProfile } from "./profile.js";
import { normText, leadCheck } from "./speaker.js";

export const KINDS = ["lead", "competitor", "signal", "opportunity", "noise"];
export const STATUSES = ["new", "contacted", "skipped", "won", "lost"];

const ORIGIN = { facebook: "https://www.facebook.com", nextdoor: "https://nextdoor.com" };
const HOST = { facebook: /(^|\.)facebook\.com$/i, nextdoor: /(^|\.)nextdoor\.com$/i };

// Origin and path only. Query strings on these sites carry session tokens.
export function cleanLink(link, source) {
  if (!link || !ORIGIN[source]) return null;
  let u;
  try { u = new URL(String(link), ORIGIN[source]); } catch { return null; }
  if (!HOST[source].test(u.hostname) || u.pathname === "/") return null;
  return ORIGIN[source] + u.pathname;
}

// Same identity whether or not a link is known, so a post saved first without
// a link and later with one still resolves to the same row (see saveFindings).
export function contentHash({ source, author, excerpt }) {
  const basis = [source, normText(author).toLowerCase(), normText(excerpt).toLowerCase().slice(0, 120)].join("|");
  return "h:" + createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

export function findingKey({ source, link, author, excerpt }) {
  if (link) return link;
  return contentHash({ source, author, excerpt });
}

const UNIT = { m: 6e4, min: 6e4, h: 36e5, hr: 36e5, d: 864e5, w: 6048e5 };

export function parsePosted(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return new Date(value > 1e11 ? value : value * 1000).toISOString();
  const s = String(value).trim();

  const rel = s.match(/^(\d+)\s*(min|hr|m|h|d|w)\b/i);
  if (rel) return new Date(Date.now() - Number(rel[1]) * UNIT[rel[2].toLowerCase()]).toISOString();

  // "Friday, September 12, 2026 at 9:21 AM" -> "September 12, 2026 9:21 AM"
  const cleaned = s.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/i, " ");
  // V8's fallback parser turns "whenever 2026" into Jan 1, and a loose month
  // regex turns "Maybe later" or "Marketplace" into a fabricated date (the
  // month name matched as a prefix of a longer word). Require a real date
  // shape: an ISO date, a digit alongside a whole-word month name, or m/d.
  const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
  const dateShaped = /^\d{4}-\d{2}-\d{2}/.test(cleaned)
    || (/\d/.test(cleaned) && MONTH.test(cleaned))
    || /\b\d{1,2}\/\d{1,2}\b/.test(cleaned);
  if (!dateShaped) return null;
  let ms;
  if (/\b(19|20)\d{2}\b/.test(cleaned)) {
    ms = Date.parse(cleaned);
  } else {
    // Nextdoor omits the year ("5 Sep"). V8 would read that as 2001.
    const year = new Date().getFullYear();
    ms = Date.parse(`${cleaned} ${year}`);
    if (Number.isFinite(ms) && ms > Date.now() + 864e5) ms = Date.parse(`${cleaned} ${year - 1}`);
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function draftReply(profile, { author, service }) {
  const first = normText(author).split(" ")[0] || "";
  const hi = /^[A-Za-z][A-Za-z'-]*$/.test(first) ? `Hi ${first}, ` : "Hi, ";
  const who = profile.owner_name ? `this is ${profile.owner_name} with ${profile.business_name}` : `this is ${profile.business_name}`;
  const what = service ? `We do ${String(service).toLowerCase()}` : "We do this kind of work";
  const where = profile.service_area ? ` around ${profile.service_area}` : " locally";
  const contact = [profile.phone, profile.website].filter(Boolean).join(" · ");
  return `${hi}${who}. ${what}${where} and would be glad to give you a quote.${contact ? ` ${contact}` : ""}`;
}

function problemWith(it) {
  if (!it || typeof it !== "object") return "not an object";
  if (!ORIGIN[it.source]) return "source must be facebook or nextdoor";
  if (!KINDS.includes(it.kind)) return `kind must be one of ${KINDS.join(", ")}`;
  if (!normText(it.text)) return "text is empty";
  return null;
}

export function saveFindings({ sweep_id = null, items } = {}) {
  const profile = getProfile();
  if (!profile) throw new Error("No profile yet. Run start_onboarding first.");
  if (!Array.isArray(items)) throw new Error("items must be an array");
  if (sweep_id != null && !one("SELECT id FROM sweep WHERE id = :id", { id: sweep_id }))
    throw new Error(`No sweep ${sweep_id}. Use the sweep_id that plan_sweep returned.`);

  const out = { received: items.length, saved: 0, duplicates: 0, invalid: [], downgraded: [], needs_review: [], by_kind: {} };
  const now = nowIso();

  tx(() => items.forEach((it, index) => {
    const problem = problemWith(it);
    if (problem) { out.invalid.push({ index, problem }); return; }

    const excerpt = normText(it.text).slice(0, 400);
    const link = cleanLink(it.link, it.source);
    const hash = contentHash({ source: it.source, author: it.author, excerpt });
    const key = link || hash;
    // A link arriving later must still land on the same row: match by key
    // (usually the link) or by content_hash (the link-independent identity).
    const existing = one("SELECT key, link FROM finding WHERE key = :key OR content_hash = :hash", { key, hash });
    if (existing) {
      out.duplicates++;
      if (!existing.link && link)
        run("UPDATE finding SET link = :link WHERE key = :existing_key", { link, existing_key: existing.key });
      return;
    }

    let kind = it.kind;
    let service = it.service ?? null;
    let downgraded = null;

    if (kind === "lead") {
      const check = leadCheck(it.text, profile.services);
      service = service ?? check.service?.name ?? null;
      const known = profile.services.find(s => s.name.toLowerCase() === String(service ?? "").toLowerCase());
      if (check.gate && (check.gate.strong || !check.ask)) {
        downgraded = check.gate.reason;
        kind = check.gate.becomes;
      } else if (check.gate) {
        // Weak gate, but the author is plainly asking — keep it, flag it.
        out.needs_review.push({ index, why: `looks like a customer ask, but mentions ${check.gate.reason}; kept as a lead` });
      } else if (known?.kind === "considering") {
        downgraded = "a service you're only considering";
        kind = "opportunity";
      } else if (!check.ask) {
        out.needs_review.push({ index, why: "no asking words found; kept as a lead on Claude's judgement" });
      }
      if (downgraded) out.downgraded.push({ index, reason: downgraded, now: kind });
    }

    const posted_label = it.posted_label ?? (typeof it.posted_at === "string" ? it.posted_at : null);
    run(`INSERT INTO finding (key, sweep_id, source, place, author, excerpt, link, posted_at, posted_label,
                              kind, service, topic, note, downgraded, draft_reply, content_hash, first_seen)
         VALUES (:key, :sweep_id, :source, :place, :author, :excerpt, :link, :posted_at, :posted_label,
                 :kind, :service, :topic, :note, :downgraded, :draft_reply, :content_hash, :first_seen)`, {
      key,
      sweep_id: sweep_id ?? null,
      source: it.source,
      place: it.place ?? null,
      author: it.author ? normText(it.author) : null,
      excerpt,
      link,
      posted_at: parsePosted(it.posted_at ?? it.posted_label),
      posted_label,
      kind,
      service,
      topic: it.topic ?? null,
      note: it.note ?? null,
      downgraded,
      draft_reply: kind === "lead" ? (normText(it.draft_reply) || draftReply(profile, { author: it.author, service })) : null,
      content_hash: hash,
      first_seen: now,
    });
    out.saved++;
    out.by_kind[kind] = (out.by_kind[kind] ?? 0) + 1;
  }));

  return out;
}

export function listFindings({ kind = null, status = null, days = 30, limit = 50 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return all(`SELECT * FROM finding
              WHERE (:kind IS NULL OR kind = :kind)
                AND (:status IS NULL OR status = :status)
                AND first_seen >= :since
              ORDER BY COALESCE(posted_at, first_seen) DESC
              LIMIT :limit`, { kind, status, since, limit });
}

export function markFinding({ id, status }) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  const ids = [id, cleanLink(id, "facebook"), cleanLink(id, "nextdoor")].filter(Boolean);
  const row = ids.map(x => one("SELECT key FROM finding WHERE key = :x OR link = :x", { x })).find(Boolean);
  if (!row) return null;
  run("UPDATE finding SET status = :status, touched_at = :now WHERE key = :key", { status, now: nowIso(), key: row.key });
  return one("SELECT * FROM finding WHERE key = :key", { key: row.key });
}
