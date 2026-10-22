import { SeededRandom } from "../core/SeededRandom";

export type NameGender = "male" | "female";
export type GeneratedPersonRole = "driver" | "manager" | "staff" | "scout";
export interface NameCulture {
  readonly id: string;
  readonly maleGivenNames: readonly string[];
  readonly femaleGivenNames: readonly string[];
  readonly surnames: readonly string[];
}
export interface CountryNameProfile {
  readonly countryCode: string;
  readonly countryName: string;
  readonly globalWeight: number;
  readonly cultures: readonly { readonly cultureId: string; readonly weight: number }[];
}
export interface GeneratedName {
  readonly fullName: string;
  readonly givenName: string;
  readonly surname: string;
  readonly gender: NameGender;
  readonly countryCode: string;
  readonly countryName: string;
  readonly cultureId: string;
}
export interface NamePool {
  readonly cultures: readonly NameCulture[];
  readonly countries: readonly CountryNameProfile[];
  readonly blockedFullNames: readonly string[];
}
export interface NameGenerationRequest {
  readonly role: GeneratedPersonRole;
  readonly tier?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly baseCountryCode?: string;
  readonly existingFullNames?: ReadonlySet<string>;
  readonly maxAttempts?: number;
}

export const NAME_GENERATION_CONFIG = {
  genderRatioFemale: {
    driver: { 1: 0.10, 2: 0.10, 3: 0.10, 4: 0.10, 5: 0.15, 6: 0.15 },
    manager: 0.15,
    staff: 0.30,
    scout: 0.30,
  },
  sameAsTeamBaseCountry: {
    driver: { 1: 0.35, 2: 0.40, 3: 0.45, 4: 0.55, 5: 0.65, 6: 0.65 },
    manager: 0.60,
    staff: 0.60,
    scout: 0.60,
  },
  maxAttempts: 500,
} as const;

export function normalizeFullName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function pick<T>(items: readonly T[], random: SeededRandom): T {
  if (items.length === 0) throw new Error("Pool nama kosong.");
  return items[Math.floor(random.next() * items.length)];
}

function weightedPick<T>(items: readonly T[], weightOf: (item: T) => number, random: SeededRandom): T {
  const valid = items.filter((item) => Number.isFinite(weightOf(item)) && weightOf(item) > 0);
  const total = valid.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) throw new Error("Bobot pilihan nama tidak valid.");
  let roll = random.next() * total;
  for (const item of valid) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return valid[valid.length - 1];
}

function countryByCode(pool: NamePool, code: string): CountryNameProfile | undefined {
  return pool.countries.find((country) => country.countryCode.toUpperCase() === code.toUpperCase());
}

function chooseCountry(pool: NamePool, request: NameGenerationRequest, random: SeededRandom): CountryNameProfile {
  const base = request.baseCountryCode ? countryByCode(pool, request.baseCountryCode) : undefined;
  const sameCountryChance = request.role === "driver"
    ? NAME_GENERATION_CONFIG.sameAsTeamBaseCountry.driver[request.tier ?? 1]
    : NAME_GENERATION_CONFIG.sameAsTeamBaseCountry[request.role];
  if (base && random.next() < sameCountryChance) return base;
  return weightedPick(pool.countries, (country) => country.globalWeight, random);
}

function chooseCulture(country: CountryNameProfile, pool: NamePool, random: SeededRandom): NameCulture {
  const profile = weightedPick(country.cultures, (entry) => entry.weight, random);
  const culture = pool.cultures.find((candidate) => candidate.id === profile.cultureId);
  if (!culture) throw new Error(`Budaya nama ${profile.cultureId} tidak tersedia untuk ${country.countryName}.`);
  return culture;
}

function femaleChance(role: GeneratedPersonRole, tier?: 1 | 2 | 3 | 4 | 5 | 6): number {
  if (role === "driver") return NAME_GENERATION_CONFIG.genderRatioFemale.driver[tier ?? 1];
  return NAME_GENERATION_CONFIG.genderRatioFemale[role];
}

export function generateName(
  pool: NamePool,
  random: SeededRandom,
  request: NameGenerationRequest,
): GeneratedName {
  if (pool.cultures.length === 0 || pool.countries.length === 0) throw new Error("Pool budaya atau kewarganegaraan kosong.");
  const blocked = new Set(pool.blockedFullNames.map(normalizeFullName));
  const existing = new Set([...(request.existingFullNames ?? [])].map(normalizeFullName));
  const maxAttempts = request.maxAttempts ?? NAME_GENERATION_CONFIG.maxAttempts;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("Batas percobaan harus integer positif.");

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const country = chooseCountry(pool, request, random);
    const culture = chooseCulture(country, pool, random);
    const gender: NameGender = random.next() < femaleChance(request.role, request.tier) ? "female" : "male";
    const givenName = pick(gender === "female" ? culture.femaleGivenNames : culture.maleGivenNames, random);
    const surname = pick(culture.surnames, random);
    if (normalizeFullName(givenName) === normalizeFullName(surname)) continue;
    const fullName = `${givenName} ${surname}`;
    const normalized = normalizeFullName(fullName);
    if (blocked.has(normalized) || existing.has(normalized)) continue;
    return { fullName, givenName, surname, gender, countryCode: country.countryCode, countryName: country.countryName, cultureId: culture.id };
  }
  throw new Error("Tidak dapat menghasilkan nama unik setelah batas percobaan; periksa ukuran pool nama.");
}

export function deriveSeasonSeed(worldSeed: string, season: number): number {
  if (!Number.isSafeInteger(season) || season < 1) throw new RangeError("Nomor season harus integer positif.");
  let hash = 2166136261;
  const value = `${worldSeed}:season:${season}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
