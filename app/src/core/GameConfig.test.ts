import { describe, expect, it } from "vitest";
import {
  calculateBaseLapSeconds,
  calculatePerformanceDeltaSeconds,
  SIMULATION_CONFIG,
  TIER_CONFIG,
  type TierId,
} from "./GameConfig";

describe("document-backed tier configuration", () => {
  it("defines all six tiers with the documented budgets and pace factors", () => {
    const tiers: TierId[] = [1, 2, 3, 4, 5, 6];
    expect(tiers.map((tier) => TIER_CONFIG[tier].requiredBudget)).toEqual([
      248_000_000, 98_000_000, 38_000_000, 15_000_000, 6_000_000, 3_000_000,
    ]);
    expect(tiers.map((tier) => TIER_CONFIG[tier].paceFactor)).toEqual([1, 0.96, 0.9, 0.84, 0.7, 0.6]);
  });

  it("keeps tier-specific restrictions explicit", () => {
    expect(TIER_CONFIG[4].features.drs).toBe(false);
    expect(TIER_CONFIG[4].features.scheduledPitStop).toBe(false);
    expect(TIER_CONFIG[5].features.aero).toBe(false);
    expect(TIER_CONFIG[5].features.scheduledPitStop).toBe(false);
    expect(TIER_CONFIG[6].features.visibleInCareerDivisionPicker).toBe(false);
    expect(TIER_CONFIG[6].driverAge).toEqual({ min: 8, max: 11 });
  });
});

describe("lap time formula", () => {
  it("converts circuit estimate using the selected tier pace factor", () => {
    expect(calculateBaseLapSeconds(87.2, 1)).toBeCloseTo(87.2);
    expect(calculateBaseLapSeconds(87.2, 5)).toBeCloseTo(87.2 / 0.7);
  });

  it("returns zero performance delta when scores equal references", () => {
    const scores = { carScore: 50, driverScore: 60, setupScore: 70 };
    expect(calculatePerformanceDeltaSeconds(90, scores, scores)).toBe(0);
  });

  it("makes below-reference scores slower and scales by lap length", () => {
    const references = { carScore: 50, driverScore: 50, setupScore: 50 };
    const weakerScores = { carScore: 49, driverScore: 49, setupScore: 49 };
    expect(calculatePerformanceDeltaSeconds(90, weakerScores, references)).toBeCloseTo(0.115);
    expect(calculatePerformanceDeltaSeconds(180, weakerScores, references)).toBeCloseTo(0.23);
  });

  it("rejects invalid estimated circuit lap times", () => {
    expect(() => calculateBaseLapSeconds(0, 1)).toThrow(RangeError);
    expect(() => calculateBaseLapSeconds(Number.NaN, 1)).toThrow(RangeError);
    expect(() =>
      calculatePerformanceDeltaSeconds(-1, { carScore: 1, driverScore: 1, setupScore: 1 }, { carScore: 1, driverScore: 1, setupScore: 1 }),
    ).toThrow(RangeError);
  });

  it("keeps core simulation constants traceable to the specification", () => {
    expect(SIMULATION_CONFIG.minimumRaceLaps).toBe(8);
    expect(SIMULATION_CONFIG.referenceLapSeconds).toBe(90);
  });
});
