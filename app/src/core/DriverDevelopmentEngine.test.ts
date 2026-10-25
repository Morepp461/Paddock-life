import { describe, expect, it } from "vitest";
import {
  calculateDriverDevelopmentGain,
  calculateTrainingQuality,
  getDriverGrowthAgeFactor,
} from "./DriverDevelopmentEngine";

describe("source-backed driver development", () => {
  it("calculates TrainingQuality from the Training Facilities level", () => {
    expect(calculateTrainingQuality(1)).toBeCloseTo(0.65);
    expect(calculateTrainingQuality(5)).toBeCloseTo(0.85);
    expect(calculateTrainingQuality(10)).toBeCloseTo(1.1);
    expect(() => calculateTrainingQuality(0)).toThrow(/level harus integer 1–10/);
    expect(() => calculateTrainingQuality(11)).toThrow(/level harus integer 1–10/);
  });

  it("applies the documented growth equation and the full-season loan multiplier", () => {
    const result = calculateDriverDevelopmentGain({
      trainingFacilitiesLevel: 10,
      baseDevelopmentRate: 1,
      isLoanedForSeason: true,
      ageFactor: 1.6,
      potentialRemaining: 40,
    });
    expect(result.trainingQuality).toBeCloseTo(1.1);
    expect(result.effectiveDevelopmentRate).toBeCloseTo(1.15);
    expect(result.gain).toBeCloseTo(0.8096);
  });

  it("keeps negative late-career age factors rather than silently clamping retirement decline", () => {
    expect(calculateDriverDevelopmentGain({
      trainingFacilitiesLevel: 1,
      baseDevelopmentRate: 1,
      isLoanedForSeason: false,
      ageFactor: -0.3,
      potentialRemaining: 20,
    }).gain).toBeLessThan(0);
  });

  it("uses the exact age-factor bands from the simulation addendum", () => {
    expect(getDriverGrowthAgeFactor(8)).toBe(1.6);
    expect(getDriverGrowthAgeFactor(13)).toBe(1.6);
    expect(getDriverGrowthAgeFactor(14)).toBe(1.25);
    expect(getDriverGrowthAgeFactor(18)).toBe(1);
    expect(getDriverGrowthAgeFactor(24)).toBe(0.55);
    expect(getDriverGrowthAgeFactor(30)).toBe(0.15);
    expect(getDriverGrowthAgeFactor(34)).toBe(-0.3);
    expect(getDriverGrowthAgeFactor(39)).toBe(-0.7);
  });

  it("rejects invalid development inputs", () => {
    expect(() => calculateDriverDevelopmentGain({
      trainingFacilitiesLevel: 1, baseDevelopmentRate: -1, isLoanedForSeason: false,
      ageFactor: 1, potentialRemaining: 20,
    })).toThrow(/Development rate/);
    expect(() => calculateDriverDevelopmentGain({
      trainingFacilitiesLevel: 1, baseDevelopmentRate: 1, isLoanedForSeason: false,
      ageFactor: Number.NaN, potentialRemaining: 20,
    })).toThrow(/Age factor/);
    expect(() => calculateDriverDevelopmentGain({
      trainingFacilitiesLevel: 1, baseDevelopmentRate: 1, isLoanedForSeason: false,
      ageFactor: 1, potentialRemaining: 101,
    })).toThrow(/Potential remaining/);
  });
});
