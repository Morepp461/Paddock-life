import type { DatabaseValue, IDatabase } from "../storage/IDatabase";
import { decodeCompressedJson } from "./NamePoolLoader";

export interface SponsorPoolSeedPayload {
  readonly schemaVersion: number;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export const SPONSOR_SOURCE_COLUMNS = [
  "id", "name", "category", "tier", "origin", "baseValue",
  "durationSeasons", "focus", "minTeamReputation",
] as const;

const VALID_FOCI = new Set(["Poin", "Podium", "Menang", "Finish", "Popularitas"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateSponsorPoolSeed(payload: unknown): asserts payload is SponsorPoolSeedPayload {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
    throw new Error("Format seed sponsor tidak valid.");
  }
  if (payload.columns.length !== SPONSOR_SOURCE_COLUMNS.length ||
      !SPONSOR_SOURCE_COLUMNS.every((column, index) => payload.columns[index] === column)) {
    throw new Error("Kolom seed sponsor tidak cocok dengan schema yang diharapkan.");
  }
  if (payload.rows.length !== 100) throw new Error("Pool sponsor harus berisi tepat 100 sponsor.");

  const ids = new Set<string>();
  const names = new Set<string>();
  const tiers = new Map<number, number>();
  for (const [index, row] of payload.rows.entries()) {
    if (!Array.isArray(row) || row.length !== SPONSOR_SOURCE_COLUMNS.length) {
      throw new Error("Baris sponsor " + (index + 1) + " memiliki jumlah kolom yang salah.");
    }
    const [id, name, category, tier, origin, baseValue, durationSeasons, focus, minTeamReputation] = row;
    if (typeof id !== "string" || !/^S\d{3}$/.test(id) || ids.has(id)) throw new Error("ID sponsor tidak valid atau duplikat.");
    if (typeof name !== "string" || !name.trim() || names.has(name)) throw new Error("Nama sponsor kosong atau duplikat.");
    if (typeof category !== "string" || !category.trim()) throw new Error("Kategori sponsor kosong.");
    if (!Number.isInteger(tier) || Number(tier) < 1 || Number(tier) > 5) throw new Error("Tier sponsor tidak valid.");
    if (origin !== "Global" && origin !== "Indonesia") throw new Error("Asal sponsor tidak valid.");
    if (!Number.isSafeInteger(baseValue) || Number(baseValue) <= 0) throw new Error("Nilai sponsor tidak valid.");
    if (!Number.isInteger(durationSeasons) || Number(durationSeasons) < 1 || Number(durationSeasons) > 5) throw new Error("Durasi sponsor tidak valid.");
    if (typeof focus !== "string" || !VALID_FOCI.has(focus)) throw new Error("Fokus sponsor tidak valid.");
    if (!Number.isInteger(minTeamReputation) || Number(minTeamReputation) < 0 || Number(minTeamReputation) > 9999) throw new Error("Reputasi minimum sponsor tidak valid.");
    ids.add(id);
    names.add(name);
    tiers.set(Number(tier), (tiers.get(Number(tier)) ?? 0) + 1);
  }
  const expected = new Map([[1, 5], [2, 15], [3, 26], [4, 30], [5, 24]]);
  for (const [tier, count] of expected) {
    if (tiers.get(tier) !== count) throw new Error("Tier sponsor " + tier + " harus memiliki tepat " + count + " entri.");
  }
}

export async function loadSponsorPool(database: IDatabase, payload: unknown): Promise<void> {
  validateSponsorPoolSeed(payload);
  await database.transaction(async () => {
    for (const row of payload.rows) {
      await database.run(
        `INSERT OR IGNORE INTO sponsor_pool
          (sponsor_id, name, category, tier, origin, base_value, duration_seasons, focus, min_team_reputation)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        row as readonly DatabaseValue[],
      );
    }
  });
  const count = await database.query("SELECT COUNT(*) AS count FROM sponsor_pool;");
  if (Number(count[0]?.count ?? 0) < 100) throw new Error("Import pool sponsor tidak lengkap setelah transaksi.");
}

export async function loadSponsorPoolFromPublic(
  database: IDatabase,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/seed/sponsors.json.gz.b64");
  if (!response.ok) throw new Error("Gagal memuat seed sponsor: HTTP " + response.status + ".");
  const payload = await decodeCompressedJson([await response.text()]);
  await loadSponsorPool(database, payload);
}
