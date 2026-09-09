// Generated from resources.yaml -> resources[name: territory].operations

import { one, run } from "../db/client.js";

export function getTerritory() {
  return one("SELECT * FROM territory WHERE active = 1 LIMIT 1");
}

export function setTerritory({ name, fb_location, maps_location, radius_note = null }) {
  if (!name || !fb_location || !maps_location)
    throw new Error("name, fb_location and maps_location are all required");
  run("UPDATE territory SET active = 0");
  run(`INSERT INTO territory (name, fb_location, maps_location, radius_note, active)
       VALUES (:name, :fb_location, :maps_location, :radius_note, 1)
       ON CONFLICT(name) DO UPDATE SET
         fb_location = :fb_location, maps_location = :maps_location,
         radius_note = :radius_note, active = 1`,
      { name, fb_location, maps_location, radius_note });
  return getTerritory();
}
