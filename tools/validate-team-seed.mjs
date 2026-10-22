import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(new URL("../app/public/seed/teams.json", import.meta.url), "utf8"));
const expectedColumns = ["id", "name", "code", "country", "strength", "financeGrade", "performanceGrade", "personality", "character"];
const strengths = new Set(["Kuat", "Menengah", "Lemah"]);
const grades = new Set(["A", "B", "C", "D"]);
const personalities = new Set(["Championship", "Aggressive", "Conservative", "Driver Development"]);

if (payload.schemaVersion !== 1) throw new Error("Unsupported team pool seed schema version.");
if (JSON.stringify(payload.columns) !== JSON.stringify(expectedColumns)) throw new Error("Team pool seed columns do not match expected schema.");
if (!Array.isArray(payload.rows) || payload.rows.length !== 72) throw new Error("Team pool must contain exactly 72 records.");

const ids = new Set();
const names = new Set();
const codes = new Set();
const tierCounts = new Map();
for (const [index, row] of payload.rows.entries()) {
  if (!Array.isArray(row) || row.length !== expectedColumns.length) throw new Error(`Invalid team row width at row ${index + 1}.`);
  const [id, name, code, country, strength, finance, performance, personality, character] = row;
  if (typeof id !== "string" || !/^D[1-6]-(0[1-9]|1[0-2])$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate team ID: ${id}`);
  if (typeof name !== "string" || !name.trim() || names.has(name)) throw new Error(`Invalid or duplicate team name: ${name}`);
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code) || codes.has(code)) throw new Error(`Invalid or duplicate team code: ${code}`);
  if (typeof country !== "string" || !country.trim()) throw new Error(`Missing country on ${id}`);
  if (!strengths.has(strength)) throw new Error(`Invalid strength class on ${id}`);
  if (!grades.has(finance) || !grades.has(performance)) throw new Error(`Invalid grade on ${id}`);
  if (!personalities.has(personality)) throw new Error(`Invalid personality on ${id}`);
  if (typeof character !== "string" || !character.trim()) throw new Error(`Missing character description on ${id}`);
  ids.add(id); names.add(name); codes.add(code);
  const tier = Number(id[1]);
  tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
}
for (let tier = 1; tier <= 6; tier += 1) {
  if (tierCounts.get(tier) !== 12) throw new Error(`Tier ${tier} must contain exactly 12 teams.`);
}
console.log(`Validated ${payload.rows.length} teams, six tiers, unique IDs/names/codes, and source classifications.`);
