import { describe, expect, it } from "vitest";
import { SeededRandom } from "../core/SeededRandom";
import { deriveSeasonSeed, generateName, normalizeFullName, type NamePool } from "./NameGenerator";
import { validateNamePool } from "./NamePoolLoader";

function fixturePool(): NamePool {
  const countries = Array.from({ length: 199 }, (_, index) => ({
    countryCode: String.fromCharCode(65 + Math.floor(index / 676), 65 + Math.floor(index / 26) % 26, 65 + index % 26),
    countryName: `Country ${index}`,
    globalWeight: index === 0 ? 10 : 1,
    cultures: [{ cultureId: "test-culture", weight: 1 }],
  }));
  return {
    cultures: [{
      id: "test-culture",
      maleGivenNames: ["Ari", "Bima", "Cakra", "Dewa"],
      femaleGivenNames: ["Ayu", "Citra", "Dina", "Eka"],
      surnames: ["Wijaya", "Pratama", "Santoso", "Nugraha", "Hidayat"],
    }],
    countries,
    blockedFullNames: ["Ari Wijaya", "Max Verstappen"],
  };
}

describe("culture-aware deterministic name generator", () => {
  it("produces reproducible names and season seeds", () => {
    const pool = fixturePool();
    const left = generateName(pool, new SeededRandom(321), { role: "driver", tier: 6, baseCountryCode: "AAA" });
    const right = generateName(pool, new SeededRandom(321), { role: "driver", tier: 6, baseCountryCode: "AAA" });
    expect(left).toEqual(right);
    expect(deriveSeasonSeed("world-seed", 2)).toBe(deriveSeasonSeed("world-seed", 2));
    expect(deriveSeasonSeed("world-seed", 1)).not.toBe(deriveSeasonSeed("world-seed", 2));
  });

  it("avoids blocked real-driver names and duplicate names in the same save", () => {
    const pool = fixturePool();
    const existing = new Set(["Ayu Pratama"]);
    for (let seed = 1; seed <= 100; seed += 1) {
      const generated = generateName(pool, new SeededRandom(seed), {
        role: "driver", tier: 1, baseCountryCode: "X00", existingFullNames: existing,
      });
      expect(normalizeFullName(generated.fullName)).not.toBe("max verstappen");
      expect(normalizeFullName(generated.fullName)).not.toBe("ari wijaya");
      expect(normalizeFullName(generated.fullName)).not.toBe("ayu pratama");
      expect(generated.givenName).not.toBe(generated.surname);
    }
  });

  it("uses only the selected country's mapped culture", () => {
    const pool = fixturePool();
    const generated = generateName(pool, new SeededRandom(12), { role: "staff", baseCountryCode: "X00" });
    expect(pool.countries.some((country) => country.countryCode === generated.countryCode)).toBe(true);
    expect(generated.cultureId).toBe("test-culture");
  });

  it("validates 199 country mappings and rejects incomplete world coverage", () => {
    const pool = fixturePool();
    const payload = { schemaVersion: 1, ...pool };
    expect(() => validateNamePool(payload)).not.toThrow();
    expect(() => validateNamePool({ ...payload, countries: pool.countries.slice(1) })).toThrow("199 negara");
  });

  it("rejects empty name lists and invalid culture references", () => {
    const pool = fixturePool();
    expect(() => validateNamePool({
      schemaVersion: 1,
      ...pool,
      cultures: [{ ...pool.cultures[0], maleGivenNames: [] }],
    })).toThrow("Pool nama kosong");
    expect(() => validateNamePool({
      schemaVersion: 1,
      ...pool,
      countries: pool.countries.map((country, index) => index === 0
        ? { ...country, cultures: [{ cultureId: "missing", weight: 1 }] }
        : country),
    })).toThrow("Pemetaan budaya");
  });
});
