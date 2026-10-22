import { readFileSync } from "node:fs";

const path = new URL("../app/public/seed/circuits.json", import.meta.url);
const payload = JSON.parse(readFileSync(path, "utf8"));
const expectedColumns = [
  "id", "name", "country", "type", "lengthKm", "standardLaps", "estimatedLapSeconds",
  "corners", "lowSpeedCorners", "mediumSpeedCorners", "highSpeedCorners", "hairpins",
  "chicanes", "elevationChange", "trackWidth", "longestStraight", "averageSpeed",
  "drsZones", "heavyBrakingZones", "grip", "abrasion", "tyreStress",
  "overtakingDifficulty", "pitLaneLength", "pitEntryDifficulty", "pitExitDifficulty",
  "safetyCarProbability", "weatherProfile", "rainProbability", "weightEngine", "weightAero",
  "weightHighSpeed", "weightMediumSpeed", "weightLowSpeed", "weightGrip", "weightTraction",
  "weightBraking",
];

if (payload.schemaVersion !== 1) throw new Error("Unsupported circuit seed schema version.");
if (JSON.stringify(payload.columns) !== JSON.stringify(expectedColumns)) throw new Error("Circuit seed columns do not match the expected schema.");
if (!Array.isArray(payload.rows) || payload.rows.length !== 30) throw new Error("Circuit seed must contain exactly 30 rows.");

const ids = new Set();
const names = new Set();
for (const [rowIndex, row] of payload.rows.entries()) {
  if (!Array.isArray(row) || row.length !== expectedColumns.length) throw new Error(`Invalid circuit row width at row ${rowIndex + 1}.`);
  const [id, name] = row;
  if (typeof id !== "string" || !/^C\d{2}$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate circuit ID: ${id}`);
  if (typeof name !== "string" || !name.trim() || names.has(name)) throw new Error(`Invalid or duplicate circuit name: ${name}`);
  ids.add(id);
  names.add(name);

  for (const index of [4, 6, 13, 14, 15, 16, 23, 26, 28, ...Array.from({ length: 8 }, (_, i) => i + 29)]) {
    if (typeof row[index] !== "number" || !Number.isFinite(row[index])) throw new Error(`Invalid numeric field at ${id}, column ${expectedColumns[index]}.`);
  }
  if (row[4] <= 0 || row[5] <= 0 || row[6] <= 0 || row[7] <= 0) throw new Error(`Invalid length, lap time, or corner count at ${id}.`);
  for (const index of [19, 20, 21]) {
    if (row[index] < 0 || row[index] > 100) throw new Error(`Circuit score out of range at ${id}, column ${expectedColumns[index]}.`);
  }
  for (const index of [26, 28]) {
    if (row[index] < 0 || row[index] > 1) throw new Error(`Circuit probability out of range at ${id}, column ${expectedColumns[index]}.`);
  }
  const weightSum = row.slice(29, 37).reduce((sum, value) => sum + value, 0);
  if (Math.abs(weightSum - 1) > 0.001) throw new Error(`Circuit weights do not sum to 1.00 at ${id}: ${weightSum}`);
}

console.log(`Validated ${payload.rows.length} circuits, unique IDs/names, numeric ranges, and weight sums.`);
