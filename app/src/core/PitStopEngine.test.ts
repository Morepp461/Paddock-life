import { describe, expect, it } from "vitest";
import { simulatePitStop } from "./PitStopEngine";

const base = {
  tier: 1,
  pitLaneLengthMeters: 420,
  pitLaneSpeedMetersPerSecond: 22.2,
  mechanicSkillAverage: 80,
  stationarySeconds: 2.4,
  stationaryJitterSeconds: 0.1,
  crewErrorProbability: 0.05,
  crewErrorJitterSeconds: 0.2,
  unsafeReleaseProbability: 0.02,
  unsafeReleaseDelaySeconds: 3,
  worldSeed: "season-seed",
  season: 1,
  round: 4,
  driverId: "driver-1",
  stopNumber: 1,
};

describe("pit stop loss model", () => {
  it("uses the configured pit lane speed instead of a hardcoded limiter", () => {
    const result = simulatePitStop(base);
    expect(result.pitLaneSeconds).toBeCloseTo(420 / 22.2);
    expect(simulatePitStop({ ...base, pitLaneSpeedMetersPerSecond: 21 }).pitLaneSeconds).toBeCloseTo(420 / 21);
    expect(result.stationarySeconds).toBeCloseTo(2.5);
    expect(result.totalLossSeconds).toBeCloseTo(
      result.pitLaneSeconds + result.stationarySeconds + result.crewErrorSeconds + result.unsafeReleaseDelaySeconds,
    );
  });

  it("returns the fixed 20-second pit stop in Tier 5 and disables Tier 6 pit stops", () => {
    const tier5 = simulatePitStop({ ...base, tier: 5, fixedTotalLossSeconds: 20 });
    expect(tier5.totalLossSeconds).toBe(20);
    expect(tier5.pitLaneSeconds).toBe(0);
    expect(simulatePitStop({ ...base, tier: 5, fixedTotalLossSeconds: 17.5 }).totalLossSeconds).toBe(17.5);
    expect(tier5.crewErrorOccurred).toBe(false);
    expect(() => simulatePitStop({ ...base, tier: 6 })).toThrow("tidak tersedia");
  });

  it("is deterministic for the same race event", () => {
    expect(simulatePitStop(base)).toEqual(simulatePitStop(base));
  });

  it("rejects invalid skill, probabilities, and negative resulting stationary time", () => {
    expect(() => simulatePitStop({ ...base, mechanicSkillAverage: 101 })).toThrow(RangeError);
    expect(() => simulatePitStop({ ...base, crewErrorProbability: 0.5 })).toThrow("2–10%");
    expect(() => simulatePitStop({ ...base, stationaryJitterSeconds: -3 })).toThrow("tidak boleh negatif");
  });
});
