import { describe, expect, it } from "vitest";
import {
  calculateTemperatureWearFactor,
  calculateWearPerLap,
  calculateWearPenaltySeconds,
  getCompoundPaceResult,
  type TyreWearInput,
} from "./TyreEngine";

const baseline: TyreWearInput = {
  compound: "medium",
  trackAbrasion: 50,
  driverAggression: 50,
  trackTemperatureCelsius: 95,
  mechanicalGrip: 50,
  driverTyreManagement: 50,
  tierWearMultiplier: 1,
};

describe("tyre wear model", () => {
  it("matches the baseline Medium wear at documented reference conditions", () => {
    expect(calculateWearPerLap(baseline)).toBeCloseTo(2.4 * 1 * 1 * 1 * 1 * 0.95);
  });

  it("increases wear when temperature is outside the ideal window and caps at 1.6", () => {
    expect(calculateTemperatureWearFactor(95, { min: 85, max: 105 })).toBe(1);
    expect(calculateTemperatureWearFactor(115, { min: 85, max: 105 })).toBeCloseTo(1.2);
    expect(calculateTemperatureWearFactor(-100, { min: 85, max: 105 })).toBe(1.6);
  });

  it("applies the wear cliff at 60 and 80 percent", () => {
    expect(calculateWearPenaltySeconds(60)).toBe(0);
    expect(calculateWearPenaltySeconds(70)).toBeCloseTo(0.1);
    expect(calculateWearPenaltySeconds(80)).toBeCloseTo(0.2);
    expect(calculateWearPenaltySeconds(90)).toBeCloseTo(0.8);
    expect(calculateWearPenaltySeconds(100)).toBeCloseTo(1.4);
  });

  it("rejects out-of-range attributes and invalid tier multipliers", () => {
    expect(() => calculateWearPerLap({ ...baseline, driverAggression: 101 })).toThrow(RangeError);
    expect(() => calculateWearPerLap({ ...baseline, tierWearMultiplier: 0 })).toThrow(RangeError);
    expect(() => calculateWearPenaltySeconds(101)).toThrow(RangeError);
  });
});

describe("compound pace and usability", () => {
  it("uses the documented dry pace deltas", () => {
    expect(getCompoundPaceResult({ compound: "soft", trackCondition: "dry" }).deltaSecondsPerLap).toBe(-0.6);
    expect(getCompoundPaceResult({ compound: "hard", trackCondition: "dry" }).deltaSecondsPerLap).toBe(0.55);
    expect(getCompoundPaceResult({ compound: "wet", trackCondition: "dry" }).deltaSecondsPerLap).toBe(4);
  });

  it("marks slick tyres unusable in heavy wet conditions", () => {
    expect(getCompoundPaceResult({ compound: "medium", trackCondition: "heavy-wet" }).usable).toBe(false);
    expect(getCompoundPaceResult({ compound: "wet", trackCondition: "heavy-wet" })).toEqual({
      deltaSecondsPerLap: -3,
      usable: true,
    });
  });
});
