import type { DatabaseValue, IDatabase } from "../storage/IDatabase";

export interface ColumnarSeedPayload {
  readonly schemaVersion: number;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export const CIRCUIT_SOURCE_COLUMNS = [
  "id", "name", "country", "type", "lengthKm", "standardLaps", "estimatedLapSeconds",
  "corners", "lowSpeedCorners", "mediumSpeedCorners", "highSpeedCorners", "hairpins",
  "chicanes", "elevationChange", "trackWidth", "longestStraight", "averageSpeed",
  "drsZones", "heavyBrakingZones", "grip", "abrasion", "tyreStress",
  "overtakingDifficulty", "pitLaneLength", "pitEntryDifficulty", "pitExitDifficulty",
  "safetyCarProbability", "weatherProfile", "rainProbability", "weightEngine", "weightAero",
  "weightHighSpeed", "weightMediumSpeed", "weightLowSpeed", "weightGrip", "weightTraction",
  "weightBraking",
] as const;

const CIRCUIT_DB_COLUMNS = [
  "circuit_id", "name", "country", "circuit_type", "length", "standard_laps",
  "estimated_lap_seconds", "corners", "low_speed_corners", "medium_speed_corners",
  "high_speed_corners", "hairpins", "chicanes", "elevation_change", "track_width",
  "longest_straight", "average_speed", "drs_zones", "heavy_braking_zones", "grip",
  "abrasion", "tyre_stress", "overtaking_difficulty", "pit_lane_length",
  "pit_entry_difficulty", "pit_exit_difficulty", "safety_car_probability", "weather_profile",
  "rain_probability", "weight_engine", "weight_aero", "weight_high_speed",
  "weight_medium_speed", "weight_low_speed", "weight_grip", "weight_traction", "weight_braking",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateCircuitSeed(payload: unknown): asserts payload is ColumnarSeedPayload {
  if (!isRecord(payload)) throw new Error("Format seed sirkuit tidak valid.");
  const schemaVersion = payload.schemaVersion;
  const columns = payload.columns;
  const rows = payload.rows;
  if (schemaVersion !== 1 || !Array.isArray(columns) || !Array.isArray(rows)) {
    throw new Error("Format seed sirkuit tidak valid atau versinya tidak didukung.");
  }
  if (columns.length !== CIRCUIT_SOURCE_COLUMNS.length ||
      !CIRCUIT_SOURCE_COLUMNS.every((column, index) => columns[index] === column)) {
    throw new Error("Kolom seed sirkuit tidak cocok dengan schema yang diharapkan.");
  }
  if (rows.length !== 30) throw new Error("Seed sirkuit harus berisi tepat 30 sirkuit.");

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [rowIndex, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== CIRCUIT_SOURCE_COLUMNS.length) {
      throw new Error(`Baris sirkuit ${rowIndex + 1} memiliki jumlah kolom yang salah.`);
    }
    const id = row[0];
    const name = row[1];
    if (typeof id !== "string" || !/^C\d{2}$/.test(id) || ids.has(id)) {
      throw new Error(`ID sirkuit tidak valid atau duplikat pada baris ${rowIndex + 1}.`);
    }
    if (typeof name !== "string" || name.trim().length === 0 || names.has(name)) {
      throw new Error(`Nama sirkuit kosong atau duplikat pada baris ${rowIndex + 1}.`);
    }
    ids.add(id);
    names.add(name);

    for (const index of [4, 6, 13, 14, 15, 16, 23, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36]) {
      if (!isFiniteNumber(row[index])) throw new Error(`Nilai numerik sirkuit tidak valid pada baris ${rowIndex + 1}.`);
    }
    if (!Number.isSafeInteger(row[5]) || Number(row[5]) <= 0 ||
        !Number.isSafeInteger(row[7]) || Number(row[7]) <= 0) {
      throw new Error(`Lap standar atau jumlah tikungan tidak valid pada ${id}.`);
    }
    for (const index of [19, 20, 21]) {
      const value = row[index];
      if (!isFiniteNumber(value) || value < 0 || value > 100 && index < 27) {
        throw new Error(`Atribut sirkuit di luar rentang pada ${id}.`);
      }
    }
    const probabilities = [26, 28];
    for (const index of probabilities) {
      const value = row[index];
      if (!isFiniteNumber(value) || value < 0 || value > 1) {
        throw new Error(`Probabilitas sirkuit tidak valid pada ${id}.`);
      }
    }
    const weights = row.slice(29, 37);
    if (!weights.every(isFiniteNumber) || Math.abs(weights.reduce((sum, value) => sum + Number(value), 0) - 1) > 0.001) {
      throw new Error(`Bobot atribut sirkuit tidak berjumlah 1.00 pada ${id}.`);
    }
  }
}

export async function loadCircuitSeed(database: IDatabase, payload: unknown): Promise<void> {
  validateCircuitSeed(payload);
  const columns = CIRCUIT_DB_COLUMNS.join(", ");
  const placeholders = CIRCUIT_DB_COLUMNS.map(() => "?").join(", ");
  await database.transaction(async () => {
    for (const row of payload.rows) {
      await database.run(
        `INSERT OR IGNORE INTO circuits (${columns}) VALUES (${placeholders});`,
        row as readonly DatabaseValue[],
      );
    }
  });
  const count = await database.query("SELECT COUNT(*) AS count FROM circuits;");
  if (Number(count[0]?.count ?? 0) < 30) {
    throw new Error("Import seed sirkuit tidak lengkap setelah transaksi.");
  }
}

export async function loadCircuitSeedFromPublic(
  database: IDatabase,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/seed/circuits.json");
  if (!response.ok) throw new Error(`Gagal memuat seed sirkuit: HTTP ${response.status}.`);
  await loadCircuitSeed(database, await response.json());
}
