import { describe, expect, it } from "vitest";
import { SeededRandom } from "./SeededRandom";
import {
  calculateInitialCash,
  DIFFICULTY_MULTIPLIERS,
  FINANCE_GRADE_MULTIPLIERS,
  generateDriverInitialProfile,
  INITIAL_DISTRIBUTIONS,
  sampleBoundedNormal,
} from "./InitialDistributions";
import type { TierId } from "./GameConfig";

describe("documented initial distributions", () => {
  it("preserves source tier means, age bands, staffing, and academy capacity", () => {
    const tiers: TierId[] = [1, 2, 3, 4, 5, 6];
    expect(tiers.map((tier) => INITIAL_DISTRIBUTIONS[tier].driverOverallMean)).toEqual([76, 68, 60, 52, 40, 32]);
    expect(tiers.map((tier) => [INITIAL_DISTRIBUTIONS[tier].minDriverAge, INITIAL_DISTRIBUTIONS[tier].maxDriverAge])).toEqual([
      [18, 45], [17, 25], [16, 19], [15, 18], [10, 14], [8, 11],
    ]);
    expect(tiers.map((tier) => INITIAL_DISTRIBUTIONS[tier].staffSlots)).toEqual([11, 11, 9, 7, 5, 3]);
    expect(tiers.map((tier) => INITIAL_DISTRIBUTIONS[tier].academySlots)).toEqual([2, 2, 2, 1, 1, 0]);
  });

  it("calculates initial cash using tier budget, finance grade, jitter, and difficulty", () => {
    expect(calculateInitialCash(5, "C", "normal", 0)).toBe(4_200_000);
    expect(calculateInitialCash(5, "C", "easy", 0)).toBe(5_460_000);
    expect(calculateInitialCash(1, "A", "hard", 0)).toBe(Math.round(248_000_000 * FINANCE_GRADE_MULTIPLIERS.A * DIFFICULTY_MULTIPLIERS.hard.initialCash));
    expect(() => calculateInitialCash(5, "C", "normal", 0.2)).toThrow(RangeError);
  });

  it("creates reproducible drivers whose ages and attributes remain within hard bounds", () => {
    for (const tier of [1, 2, 3, 4, 5, 6] as const) {
      const first = generateDriverInitialProfile(new SeededRandom(900 + tier), tier);
      const second = generateDriverInitialProfile(new SeededRandom(900 + tier), tier);
      expect(first).toEqual(second);
      expect(first.age).toBeGreaterThanOrEqual(INITIAL_DISTRIBUTIONS[tier].minDriverAge);
      expect(first.age).toBeLessThanOrEqual(INITIAL_DISTRIBUTIONS[tier].maxDriverAge);
      expect(first.overall).toBeGreaterThanOrEqual(15);
      expect(first.overall).toBeLessThanOrEqual(97);
      expect(first.potential).toBeGreaterThanOrEqual(first.overall);
      expect(first.potential).toBeLessThanOrEqual(99);
      for (const value of [first.pace, first.qualifying, first.racecraft, first.consistency, first.wetSkill, first.tyreManagement, first.overtaking, first.defending, first.starts, first.adaptability]) {
        expect(value).toBeGreaterThanOrEqual(5);
        expect(value).toBeLessThanOrEqual(99);
      }
      expect(first.developmentRate).toBeGreaterThanOrEqual(0.6);
      expect(first.developmentRate).toBeLessThanOrEqual(1.4);
      expect(first.injuryResistance).toBeGreaterThanOrEqual(30);
      expect(first.injuryResistance).toBeLessThanOrEqual(90);
    }
  });

  it("uses bounded normal sampling and rejects impossible ranges", () => {
    expect(sampleBoundedNormal(new SeededRandom(1), 50, 0, 0, 100)).toBe(50);
    expect(() => sampleBoundedNormal(new SeededRandom(1), 50, 1, 100, 0)).toThrow(RangeError);
  });
});
