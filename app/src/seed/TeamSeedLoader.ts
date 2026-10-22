import type { DatabaseValue, IDatabase } from "../storage/IDatabase";

export interface TeamPoolSeedPayload {
  readonly schemaVersion: number;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export const TEAM_POOL_SOURCE_COLUMNS = [
  "id", "name", "code", "country", "strength", "financeGrade",
  "performanceGrade", "personality", "character",
] as const;

const VALID_STRENGTHS = new Set(["Kuat", "Menengah", "Lemah"]);
const VALID_GRADES = new Set(["A", "B", "C", "D"]);
const VALID_PERSONALITIES = new Set(["Championship", "Aggressive", "Conservative", "Driver Development"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateTeamPoolSeed(payload: unknown): asserts payload is TeamPoolSeedPayload {
  if (!isRecord(payload)) throw new Error("Format seed tim tidak valid.");
  const { schemaVersion, columns, rows } = payload;
  if (schemaVersion !== 1 || !Array.isArray(columns) || !Array.isArray(rows)) {
    throw new Error("Format seed tim tidak valid atau versinya tidak didukung.");
  }
  if (columns.length !== TEAM_POOL_SOURCE_COLUMNS.length ||
      !TEAM_POOL_SOURCE_COLUMNS.every((column, index) => columns[index] === column)) {
    throw new Error("Kolom seed tim tidak cocok dengan schema yang diharapkan.");
  }
  if (rows.length !== 72) throw new Error("Pool tim harus berisi tepat 72 tim.");

  const ids = new Set<string>();
  const names = new Set<string>();
  const codes = new Set<string>();
  const tierCounts = new Map<number, number>();

  for (const [rowIndex, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== TEAM_POOL_SOURCE_COLUMNS.length) {
      throw new Error(`Baris tim ${rowIndex + 1} memiliki jumlah kolom yang salah.`);
    }
    const [id, name, code, country, strength, financeGrade, performanceGrade, personality, character] = row;
    if (typeof id !== "string" || !/^D[1-6]-(0[1-9]|1[0-2])$/.test(id) || ids.has(id)) {
      throw new Error(`ID tim tidak valid atau duplikat pada baris ${rowIndex + 1}.`);
    }
    if (typeof name !== "string" || !name.trim() || names.has(name)) throw new Error(`Nama tim kosong atau duplikat pada ${id}.`);
    if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code) || codes.has(code)) throw new Error(`Kode tim tidak valid atau duplikat pada ${id}.`);
    if (typeof country !== "string" || !country.trim()) throw new Error(`Negara tim kosong pada ${id}.`);
    if (typeof strength !== "string" || !VALID_STRENGTHS.has(strength)) throw new Error(`Kelas kekuatan tidak valid pada ${id}.`);
    if (typeof financeGrade !== "string" || !VALID_GRADES.has(financeGrade) ||
        typeof performanceGrade !== "string" || !VALID_GRADES.has(performanceGrade)) {
      throw new Error(`Rating tim tidak valid pada ${id}.`);
    }
    if (typeof personality !== "string" || !VALID_PERSONALITIES.has(personality)) throw new Error(`Personality tim tidak valid pada ${id}.`);
    if (typeof character !== "string" || !character.trim()) throw new Error(`Deskripsi karakter tim kosong pada ${id}.`);

    ids.add(id);
    names.add(name);
    codes.add(code);
    const tier = Number(id[1]);
    tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
  }

  for (let tier = 1; tier <= 6; tier += 1) {
    if (tierCounts.get(tier) !== 12) throw new Error(`Tier ${tier} harus memiliki tepat 12 tim.`);
  }
}

export async function loadTeamPoolSeed(database: IDatabase, payload: unknown): Promise<void> {
  validateTeamPoolSeed(payload);
  await database.transaction(async () => {
    for (const row of payload.rows) {
      const [id, name, code, country, strength, financeGrade, performanceGrade, personality, character] = row;
      await database.run(
        `INSERT OR IGNORE INTO team_pool
          (pool_team_id, tier, name, code, country, strength_class, finance_grade, performance_grade, personality, character)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [id, Number(String(id).slice(1, 2)), name, code, country, strength, financeGrade, performanceGrade, personality, character] as readonly DatabaseValue[],
      );
    }
  });
  const count = await database.query("SELECT COUNT(*) AS count FROM team_pool;");
  if (Number(count[0]?.count ?? 0) < 72) throw new Error("Import pool tim tidak lengkap setelah transaksi.");
}

export async function loadTeamPoolSeedFromPublic(
  database: IDatabase,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/seed/teams.json");
  if (!response.ok) throw new Error(`Gagal memuat seed tim: HTTP ${response.status}.`);
  await loadTeamPoolSeed(database, await response.json());
}
