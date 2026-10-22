import { describe, expect, it } from "vitest";
import { SeededRandom } from "./SeededRandom";
import {
  SPONSOR_OFFER_WEIGHTS,
  SPONSOR_TARGETS,
  evaluateSponsorTarget,
  isSponsorEligible,
  selectSponsorTier,
} from "./SponsorEngine";

describe("SponsorEngine", () => {
  it("keeps offer probabilities at 100% for every documented division", () => {
    for (const tier of [1, 2, 3, 4, 5] as const) {
      expect(SPONSOR_OFFER_WEIGHTS[tier].reduce((sum, choice) => sum + choice.weight, 0)).toBeCloseTo(1);
    }
    expect(SPONSOR_OFFER_WEIGHTS[6]).toEqual([]);
  });

  it("selects deterministic sponsor tiers from the supplied seed", () => {
    const first = Array.from({ length: 50 }, (_, i) => selectSponsorTier(new SeededRandom(i + 1), 1));
    const second = Array.from({ length: 50 }, (_, i) => selectSponsorTier(new SeededRandom(i + 1), 1));
    expect(first).toEqual(second);
    expect(first.every((tier) => [1, 2, 3].includes(tier))).toBe(true);
  });

  it("enforces reputation minimums exactly", () => {
    expect(isSponsorEligible(1, 6999)).toBe(false);
    expect(isSponsorEligible(1, 7000)).toBe(true);
    expect(isSponsorEligible(5, 0)).toBe(true);
    expect(() => isSponsorEligible(2, 10000)).toThrow(RangeError);
  });

  it("evaluates the points target over completed rounds", () => {
    const performance = {
      roundsWithPointsFinish: 8, roundsWithPodium: 3, roundsWon: 1,
      carStarts: 10, carFinishes: 9, leadDriverPopularity: 70,
    };
    expect(evaluateSponsorTarget(1, "points", performance, 10)).toEqual({
      focus: "points", required: SPONSOR_TARGETS[1].points, actual: 0.8, achieved: true,
    });
    expect(evaluateSponsorTarget(1, "podium", performance, 10).achieved).toBe(false);
    expect(evaluateSponsorTarget(2, "finish", performance, 10).achieved).toBe(true);
  });

  it("rejects impossible season statistics instead of silently normalizing them", () => {
    expect(() => evaluateSponsorTarget(3, "points", {
      roundsWithPointsFinish: 11, roundsWithPodium: 0, roundsWon: 0,
      carStarts: 0, carFinishes: 0, leadDriverPopularity: 50,
    }, 10)).toThrow(RangeError);
    expect(() => evaluateSponsorTarget(3, "finish", {
      roundsWithPointsFinish: 0, roundsWithPodium: 0, roundsWon: 0,
      carStarts: 2, carFinishes: 3, leadDriverPopularity: 50,
    }, 10)).toThrow(RangeError);
  });
});
