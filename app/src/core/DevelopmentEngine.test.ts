import { describe, expect, it } from "vitest";
import {
  calculateCancellationRefund,
  calculateDiminishingReturn,
  calculateEngineerMultiplier,
  DEVELOPMENT_PROJECT_CONFIG,
  DEVELOPMENT_SUCCESS_PROBABILITY,
  resolveDevelopmentProject,
} from "./DevelopmentEngine";

const base = {
  projectId: "E01",
  tier: 5 as const,
  size: "standard" as const,
  facilityLevel: 5,
  engineerSkill: 60,
  developmentEfficiency: 1,
  currentMainAttribute: 38,
  divisionMeanMainAttribute: 38,
  currentSecondaryAttribute: 38,
  divisionMeanSecondaryAttribute: 38,
  category: "engine" as const,
  worldSeed: "world-seed",
};

describe("development project model", () => {
  it("uses documented success chance, cost, nominal gains, and duration", () => {
    expect(DEVELOPMENT_SUCCESS_PROBABILITY).toBe(0.7);
    expect(DEVELOPMENT_PROJECT_CONFIG).toEqual({
      minor: { nominalGain: 0.8, durationRaces: 2, reliabilityGain: 2, reliabilityPenalty: 0 },
      standard: { nominalGain: 1.6, durationRaces: 3, reliabilityGain: 4, reliabilityPenalty: -1 },
      major: { nominalGain: 3.2, durationRaces: 5, reliabilityGain: 7, reliabilityPenalty: -3 },
    });
    const result = resolveDevelopmentProject(base);
    expect(result.cost).toBe(240_000);
    expect(result.successProbability).toBe(0.7);
    expect(result.effectiveDurationRaces).toBeCloseTo(3 * 0.85);
    if (result.success) {
      expect(result.mainAttributeGain).toBeGreaterThan(0);
      expect(result.secondaryAttributeGain).toBeCloseTo(result.mainAttributeGain * 0.5);
      expect(result.reliabilityPenalty).toBe(-1);
    } else {
      expect(result.mainAttributeGain).toBe(0);
      expect(result.secondaryAttributeGain).toBe(0);
      expect(result.reliabilityPenalty).toBe(0);
    }
  });

  it("is deterministic and keeps the documented 70/30 outcome ratio", () => {
    expect(resolveDevelopmentProject(base)).toEqual(resolveDevelopmentProject(base));
    let successes = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      if (resolveDevelopmentProject({ ...base, worldSeed: seed }).success) successes += 1;
    }
    expect(successes / 1000).toBeGreaterThan(0.66);
    expect(successes / 1000).toBeLessThan(0.74);
  });

  it("applies reliability project gains and cancellation refunds", () => {
    const reliability = resolveDevelopmentProject({ ...base, category: "reliability", size: "major" });
    if (reliability.success) {
      expect(reliability.reliabilityGain).toBe(7);
      expect(reliability.reliabilityPenalty).toBe(0);
    }
    expect(calculateCancellationRefund(240_000, 0)).toBe(120_000);
    expect(calculateCancellationRefund(240_000, 0.5)).toBe(60_000);
    expect(calculateCancellationRefund(240_000, 1)).toBe(0);
  });

  it("uses diminishing returns and engineer multipliers from source tables", () => {
    expect(calculateEngineerMultiplier(20)).toBe(0.92);
    expect(calculateEngineerMultiplier(60)).toBe(1.06);
    expect(calculateEngineerMultiplier(100)).toBe(1.2);
    expect(calculateDiminishingReturn(38, 38)).toBe(1);
    expect(calculateDiminishingReturn(98, 38)).toBe(0.4);
    expect(calculateDiminishingReturn(0, 100)).toBe(1.2);
  });

  it("rejects invalid facility levels, efficiencies, and mismatched secondary attributes", () => {
    expect(() => resolveDevelopmentProject({ ...base, facilityLevel: 11 })).toThrow(RangeError);
    expect(() => resolveDevelopmentProject({ ...base, developmentEfficiency: 0 })).toThrow(RangeError);
    expect(() => resolveDevelopmentProject({ ...base, currentSecondaryAttribute: undefined })).toThrow("bersama");
    expect(() => calculateCancellationRefund(100, 1.1)).toThrow(RangeError);
  });
});
