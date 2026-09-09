import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = "rc-lead-finder";

// The store must NOT live inside the installed extension directory. Claude
// Desktop installs each version into its own folder, so a bundle that keeps its
// database under __dirname loses every lead on the next version bump. That is
// exactly what happened. This is a stable per-user location instead.
export function dataDir() {
  const d = process.env.RC_DATA_DIR || platformDir();
  mkdirSync(d, { recursive: true });
  return d;
}

function platformDir() {
  const home = homedir();
  if (process.platform === "darwin")
    return join(home, "Library", "Application Support", APP);
  if (process.platform === "win32")
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), APP);
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), APP);
}

// One-time rescue for anyone who ran a build that stored inside the bundle.
function adoptLegacy(target) {
  if (existsSync(target)) return null;
  const legacy = join(HERE, "..", "..", ".data", "leads.db");
  if (!existsSync(legacy)) return null;
  try { copyFileSync(legacy, target); return legacy; } catch { return null; }
}

let db;
let adopted = null;

export function open() {
  if (db) return db;
  const file = join(dataDir(), "leads.db");
  adopted = adoptLegacy(file);
  db = new DatabaseSync(file);
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf8"));
  return db;
}

export function dbPath() {
  return join(dataDir(), "leads.db");
}

export function adoptedFrom() {
  return adopted;
}

export function all(sql, params = {}) {
  return open().prepare(sql).all(params);
}

export function one(sql, params = {}) {
  return open().prepare(sql).get(params) ?? null;
}

export function run(sql, params = {}) {
  return open().prepare(sql).run(params);
}

export const nowIso = () => new Date().toISOString();
