// The owner's trade profile. Everything the old build hardcoded for pressure
// washing — services, words, places to look — is a row here instead.

import { all, one, run, tx, nowIso } from "../db/client.js";

export const PLATFORMS = ["facebook", "nextdoor"];
export const PURPOSES = ["lead", "signal", "competitor", "opportunity"];

const J = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// Query strings on a competitor's page carry share/tracking junk, not
// identity, and can include a fragment too (Facebook mobile share links).
function cleanPageUrl(url) {
  if (!url) return null;
  try { const u = new URL(String(url)); return u.origin + u.pathname; } catch { return null; }
}

export function normGroupUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`not a Facebook group URL: ${url}`); }
  const m = u.pathname.match(/^\/groups\/([^/]+)/);
  if (!/(^|\.)facebook\.com$/i.test(u.hostname) || !m) throw new Error(`not a Facebook group URL: ${url}`);
  return `https://www.facebook.com/groups/${m[1]}/`;
}

export function getProfile() {
  const p = one("SELECT * FROM profile WHERE id = 1");
  if (!p) return null;
  return {
    business_name: p.business_name,
    owner_name: p.owner_name,
    website: p.website,
    phone: p.phone,
    page_handle: p.page_handle,
    service_area: p.service_area,
    reply_voice: p.reply_voice,
    nextdoor_enabled: !!p.nextdoor_enabled,
    cadence: J(p.cadence, {}),
    signals: J(p.signals, []),
    updated_at: p.updated_at,
    services: all("SELECT name, kind, keywords FROM service ORDER BY kind DESC, name")
      .map(s => ({ name: s.name, kind: s.kind, keywords: J(s.keywords, []) })),
    groups: all("SELECT url, name, privacy, members, posts_per_day, active FROM source_group ORDER BY posts_per_day DESC, name")
      .map(g => ({ ...g, active: !!g.active })),
    terms: all("SELECT platform, term, purpose FROM search_term ORDER BY platform, purpose, term"),
    competitors: all("SELECT name, page_url, notes FROM competitor ORDER BY name"),
  };
}

export function saveProfile(input = {}) {
  const cur = getProfile();
  const pick = k => (input[k] !== undefined ? input[k] : (cur?.[k] ?? null));
  const business_name = pick("business_name");
  if (!business_name) throw new Error("business_name is required the first time the profile is saved");

  // Validate everything before writing anything.
  const services = input.services?.map(s => {
    if (!s?.name) throw new Error("every service needs a name");
    if (!["offered", "considering"].includes(s.kind))
      throw new Error(`service "${s.name}": kind must be "offered" or "considering"`);
    return { name: String(s.name).trim(), kind: s.kind,
             keywords: JSON.stringify((s.keywords || []).map(k => String(k).trim()).filter(Boolean)) };
  });
  const groups = input.groups?.map(g => ({
    url: normGroupUrl(g?.url),
    name: g.name || g.url,
    privacy: g.privacy ?? null,
    members: g.members != null ? String(g.members) : null,
    posts_per_day: g.posts_per_day != null ? Number(g.posts_per_day) : null,
    active: g.active === false ? 0 : 1,
  }));
  const terms = input.terms?.map(t => {
    if (!PLATFORMS.includes(t?.platform)) throw new Error(`term "${t?.term}": platform must be facebook or nextdoor`);
    if (!PURPOSES.includes(t.purpose)) throw new Error(`term "${t.term}": purpose must be one of ${PURPOSES.join(", ")}`);
    if (!String(t.term ?? "").trim()) throw new Error("every term needs text");
    return { platform: t.platform, term: String(t.term).trim(), purpose: t.purpose };
  });
  const competitors = input.competitors?.map(c => {
    if (!c?.name) throw new Error("every competitor needs a name");
    return { name: String(c.name).trim(), page_url: cleanPageUrl(c.page_url), notes: c.notes ?? null };
  });

  tx(() => {
    run(`INSERT INTO profile (id, business_name, owner_name, website, phone, page_handle, service_area,
                              reply_voice, nextdoor_enabled, cadence, signals, updated_at)
         VALUES (1, :business_name, :owner_name, :website, :phone, :page_handle, :service_area,
                 :reply_voice, :nextdoor_enabled, :cadence, :signals, :updated_at)
         ON CONFLICT(id) DO UPDATE SET
           business_name = excluded.business_name, owner_name = excluded.owner_name,
           website = excluded.website, phone = excluded.phone, page_handle = excluded.page_handle,
           service_area = excluded.service_area, reply_voice = excluded.reply_voice,
           nextdoor_enabled = excluded.nextdoor_enabled, cadence = excluded.cadence,
           signals = excluded.signals, updated_at = excluded.updated_at`, {
      business_name,
      owner_name: pick("owner_name"),
      website: pick("website"),
      phone: pick("phone"),
      page_handle: pick("page_handle"),
      service_area: pick("service_area"),
      reply_voice: pick("reply_voice"),
      nextdoor_enabled: (input.nextdoor_enabled ?? cur?.nextdoor_enabled ?? true) ? 1 : 0,
      cadence: JSON.stringify(input.cadence ?? cur?.cadence ?? {}),
      signals: JSON.stringify(input.signals ?? cur?.signals ?? []),
      updated_at: nowIso(),
    });
    if (services) {
      run("DELETE FROM service");
      for (const s of services) run("INSERT OR REPLACE INTO service (name, kind, keywords) VALUES (:name, :kind, :keywords)", s);
    }
    if (groups) {
      run("DELETE FROM source_group");
      for (const g of groups)
        run(`INSERT OR REPLACE INTO source_group (url, name, privacy, members, posts_per_day, active)
             VALUES (:url, :name, :privacy, :members, :posts_per_day, :active)`, g);
    }
    if (terms) {
      run("DELETE FROM search_term");
      for (const t of terms) run("INSERT OR REPLACE INTO search_term (platform, term, purpose) VALUES (:platform, :term, :purpose)", t);
    }
    if (competitors) {
      run("DELETE FROM competitor");
      for (const c of competitors) run("INSERT OR REPLACE INTO competitor (name, page_url, notes) VALUES (:name, :page_url, :notes)", c);
    }
  });
  return getProfile();
}

export function profileGaps(p = getProfile()) {
  if (!p) return ["no profile yet"];
  const gaps = [];
  if (!p.services.some(s => s.kind === "offered")) gaps.push("no services offered");
  if (!p.service_area) gaps.push("no service area");
  const fb = p.groups.some(g => g.active);
  if (!fb && !p.nextdoor_enabled) gaps.push("no sources: add Facebook groups or turn on Nextdoor");
  if (fb && !p.terms.some(t => t.platform === "facebook" && t.purpose === "lead")) gaps.push("no Facebook lead search terms");
  if (p.nextdoor_enabled && !p.terms.some(t => t.platform === "nextdoor" && t.purpose === "lead")) gaps.push("no Nextdoor lead search terms");
  if (!p.cadence?.daily && !p.cadence?.weekly) gaps.push("no schedule chosen");
  return gaps;
}
