import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const encoded = readFileSync(new URL("../app/public/seed/sponsors.json.gz.b64", import.meta.url), "utf8").trim();
const payload = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
const columns = ["id", "name", "category", "tier", "origin", "baseValue", "durationSeasons", "focus", "minTeamReputation"];
if (payload.schemaVersion !== 1 || JSON.stringify(payload.columns) !== JSON.stringify(columns)) throw new Error("Sponsor seed schema mismatch.");
if (!Array.isArray(payload.rows) || payload.rows.length !== 100) throw new Error("Sponsor seed must contain exactly 100 entries.");
const expected = new Map([[1, 5], [2, 15], [3, 26], [4, 30], [5, 24]]);
const counts = new Map();
const ids = new Set();
const names = new Set();
for (const row of payload.rows) {
  if (!Array.isArray(row) || row.length !== columns.length) throw new Error("Invalid sponsor row width.");
  const [id, name, category, tier, origin, value, duration, focus, minRep] = row;
  if (typeof id !== "string" || !/^S\d{3}$/.test(id) || ids.has(id)) throw new Error("Invalid or duplicate sponsor ID.");
  if (typeof name !== "string" || !name.trim() || names.has(name)) throw new Error("Invalid or duplicate sponsor name.");
  if (typeof category !== "string" || !category.trim()) throw new Error("Sponsor category is empty.");
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new Error("Sponsor tier is invalid.");
  if (!["Global", "Indonesia"].includes(origin)) throw new Error("Sponsor origin is invalid.");
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Sponsor value is invalid.");
  if (!Number.isInteger(duration) || duration < 1 || duration > 5) throw new Error("Sponsor duration is invalid.");
  if (!["Poin", "Podium", "Menang", "Finish", "Popularitas"].includes(focus)) throw new Error("Sponsor focus is invalid.");
  if (!Number.isInteger(minRep) || minRep < 0 || minRep > 9999) throw new Error("Sponsor minimum reputation is invalid.");
  ids.add(id); names.add(name); counts.set(tier, (counts.get(tier) ?? 0) + 1);
}
for (const [tier, expectedCount] of expected) {
  if (counts.get(tier) !== expectedCount) throw new Error("Tier " + tier + " sponsor count mismatch.");
}
console.log("Validated 100 sponsor entries across the five source tiers.");
