import type { DatabaseValue, IDatabase } from "../storage/IDatabase";
import type { NamePool } from "./NameGenerator";

export interface NamePoolPayload extends NamePool {
  readonly schemaVersion: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateNamePool(payload: unknown): asserts payload is NamePoolPayload {
  if (!isRecord(payload) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.cultures) || !Array.isArray(payload.countries) ||
      !Array.isArray(payload.blockedFullNames)) {
    throw new Error("Format seed nama tidak valid atau versinya tidak didukung.");
  }
  const cultureIds = new Set<string>();
  for (const culture of payload.cultures) {
    if (!isRecord(culture) || typeof culture.id !== "string" || !culture.id.trim() || cultureIds.has(culture.id) ||
        !Array.isArray(culture.maleGivenNames) || !Array.isArray(culture.femaleGivenNames) || !Array.isArray(culture.surnames)) {
      throw new Error("Definisi budaya nama tidak valid atau duplikat.");
    }
    if (![culture.maleGivenNames, culture.femaleGivenNames, culture.surnames].every(
      (names) => names.length > 0 && names.every((name) => typeof name === "string" && name.trim().length > 0),
    )) throw new Error(`Pool nama kosong atau berisi nilai invalid pada budaya ${culture.id}.`);
    cultureIds.add(culture.id);
  }
  const countryCodes = new Set<string>();
  for (const country of payload.countries) {
    if (!isRecord(country) || typeof country.countryCode !== "string" ||
        !/^[A-Z]{2,3}$/.test(country.countryCode) || countryCodes.has(country.countryCode) ||
        typeof country.countryName !== "string" || !country.countryName.trim() ||
        typeof country.globalWeight !== "number" || !Number.isFinite(country.globalWeight) || country.globalWeight < 0 ||
        !Array.isArray(country.cultures) || country.cultures.length === 0) {
      throw new Error("Profil kewarganegaraan nama tidak valid atau duplikat.");
    }
    for (const entry of country.cultures) {
      if (!isRecord(entry) || typeof entry.cultureId !== "string" || !cultureIds.has(entry.cultureId) ||
          typeof entry.weight !== "number" || !Number.isFinite(entry.weight) || entry.weight <= 0) {
        throw new Error(`Pemetaan budaya nama tidak valid pada ${country.countryCode}.`);
      }
    }
    countryCodes.add(country.countryCode);
  }
  if (payload.countries.length !== 199) throw new Error("Pool kewarganegaraan harus mencakup tepat 199 negara.");
  const blocked = new Set<string>();
  for (const name of payload.blockedFullNames) {
    if (typeof name !== "string" || !name.trim() || blocked.has(name.trim().toLowerCase())) {
      throw new Error("Daftar blokir nama berisi nilai kosong atau duplikat.");
    }
    blocked.add(name.trim().toLowerCase());
  }
}

export async function loadNamePool(database: IDatabase, input: unknown): Promise<void> {
  validateNamePool(input);
  const payload = input as NamePoolPayload;
  await database.transaction(async () => {
    for (const culture of payload.cultures) {
      for (const [gender, names] of [
        ["male", culture.maleGivenNames],
        ["female", culture.femaleGivenNames],
        ["surname", culture.surnames],
      ] as const) {
        for (const name of names) {
          await database.run(
            "INSERT OR IGNORE INTO name_culture_pool (culture_id, gender, name) VALUES (?, ?, ?);",
            [culture.id, gender, name] as readonly DatabaseValue[],
          );
        }
      }
    }
    for (const country of payload.countries) {
      await database.run(
        "INSERT OR IGNORE INTO nationality_name_cultures (country_code, country_name, global_weight, culture_weights_json) VALUES (?, ?, ?, ?);",
        [country.countryCode, country.countryName, country.globalWeight, JSON.stringify(country.cultures)] as readonly DatabaseValue[],
      );
    }
    for (const name of payload.blockedFullNames) {
      const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
      await database.run(
        "INSERT OR IGNORE INTO blocked_names (normalized_full_name, display_name) VALUES (?, ?);",
        [normalized, name] as readonly DatabaseValue[],
      );
    }
  });
  const [cultures, countries, blocked] = await Promise.all([
    database.query("SELECT COUNT(DISTINCT culture_id) AS count FROM name_culture_pool;"),
    database.query("SELECT COUNT(*) AS count FROM nationality_name_cultures;"),
    database.query("SELECT COUNT(*) AS count FROM blocked_names;"),
  ]);
  if (Number(cultures[0]?.count ?? 0) !== payload.cultures.length ||
      Number(countries[0]?.count ?? 0) !== 199 ||
      Number(blocked[0]?.count ?? 0) < payload.blockedFullNames.length) {
    throw new Error("Import pool nama tidak lengkap setelah transaksi.");
  }
}

export async function loadNamePoolFromPublic(
  database: IDatabase,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/seed/name-pool.json");
  if (!response.ok) throw new Error(`Gagal memuat pool nama: HTTP ${response.status}.`);
  await loadNamePool(database, await response.json());
}
