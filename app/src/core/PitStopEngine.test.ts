import { describe, expect, it } from "vitest";
import { simulatePitStop, type PitStopInput } from "./PitStopEngine";

const base: PitStopInput = {
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
  it("calculates pit lane time using the documented 22.2 m/s limiter", () => {
    const result = simulatePitStop(base);
    expect(result.pitLaneSeconds).toBeCloseTo(420 / 22.2);
    expect(result.stationarySeconds).toBeCloseTo(2.5);
    expect(result.totalLossSeconds).toBeCloseTo(
      result.pitLaneSeconds + result.stationarySeconds + result.crewErrorSeconds + result.unsafeReleaseDelaySeconds,
    );
  });

  it("returns the fixed 20-second pit stop in Tier 5 and disables Tier 6 pit stops", () => {
    const tier5 = simulatePitStop({ ...base, tier: 5 });
    expect(tier5.totalLossSeconds).toBe(20);
    expect(tier5.pitLaneSeconds).toBe(20);
    expect(tier5.crewErrorOccurred).toBe(false);
    expect(() => simulatePitStop({ ...base, tier: 6 })).toThrow("tidak tersedia");
    expect(simulatePitStop({
      tier: 5, pitLaneLengthMeters: 0, worldSeed: "seed", season: 1, round: 1, driverId: "tier5-driver", stopNumber: 1,
    }).totalLossSeconds).toBe(20);
    expect(() => simulatePitStop({
      tier: 1, pitLaneLengthMeters: 420, worldSeed: "seed", season: 1, round: 1, driverId: "missing-config", stopNumber: 1,
    })).toThrow("Konfigurasi pit wajib belum tersedia");
  });

  it("uses explicit pit-lane speed and applies SC/VSC pit-lane reductions only to lane time", () => {
    const normal = simulatePitStop({ ...base, pitLaneSpeedMetersPerSecond: 21 });
    const neutralized = simulatePitStop({ ...base, pitLaneTimeReduction: 0.4 });
    expect(normal.pitLaneSeconds).toBeCloseTo(420 / 21);
    expect(neutralized.pitLaneSeconds).toBeCloseTo((420 / 22.2) * 0.6);
    expect(neutralized.stationarySeconds).toBeCloseTo(base.stationarySeconds! + base.stationaryJitterSeconds!);
    expect(() => simulatePitStop({ ...base, pitLaneTimeReduction: 1.1 })).toThrow("rentang 0–1");
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
