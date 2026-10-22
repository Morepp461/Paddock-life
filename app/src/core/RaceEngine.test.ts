import { describe, expect, it } from "vitest";
import { hashSeed, sampleBoundedNormal } from "./RandomDistributions";
import { simulateRace, type RaceInput } from "./RaceEngine";
import { SeededRandom } from "./SeededRandom";

const raceInput: RaceInput = {
  worldSeed: "career-seed-001",
  season: 1,
  round: 1,
  tier: 1,
  estimatedCircuitLapSeconds: 90,
  totalLaps: 8,
  trackAbrasion: 50,
  trackTemperatureCelsius: 95,
  trackCondition: "dry",
  referenceSetupScore: 50,
  drivers: [
    {
      id: "drv-a", name: "Driver A", carScore: 74, driverScore: 76, setupScore: 50,
      formModifier: 0, aggression: 50, tyreManagement: 50, mechanicalGrip: 50,
      compound: "medium",
    },
    {
      id: "drv-b", name: "Driver B", carScore: 70, driverScore: 72, setupScore: 48,
      formModifier: 0.5, aggression: 60, tyreManagement: 60, mechanicalGrip: 55,
      compound: "medium",
    },
  ],
};

describe("seeded random helpers", () => {
  it("hashes the same inputs consistently and changes when a seed part changes", () => {
    expect(hashSeed(["world", 1, 2, "race", 3, "driver"])).toBe(hashSeed(["world", 1, 2, "race", 3, "driver"]));
    expect(hashSeed(["world", 1, 2, "race", 3, "driver"])).not.toBe(hashSeed(["world", 1, 2, "race", 4, "driver"]));
  });

  it("bounds normal samples to the documented sigma window", () => {
    const rng = new SeededRandom(42);
    for (let index = 0; index < 1000; index += 1) {
      const value = sampleBoundedNormal(rng, 0.15, 2.5);
      expect(value).toBeGreaterThanOrEqual(-0.375);
      expect(value).toBeLessThanOrEqual(0.375);
    }
    expect(sampleBoundedNormal(rng, 0)).toBe(0);
  });
});

describe("deterministic race kernel", () => {
  it("produces identical results for the same world, session, and driver inputs", () => {
    expect(simulateRace(raceInput)).toEqual(simulateRace(raceInput));
  });

  it("produces one classification per lap with ordered positions and nonnegative gaps", () => {
    const result = simulateRace(raceInput);
    expect(result.laps).toHaveLength(8);
    expect(result.classification).toHaveLength(2);
    expect(result.classification.map((driver) => driver.position)).toEqual([1, 2]);
    expect(result.classification[0].cumulativeTimeSeconds).toBeLessThanOrEqual(result.classification[1].cumulativeTimeSeconds);
    expect(result.classification[0].gapToLeaderSeconds).toBe(0);
    expect(result.classification[1].gapToLeaderSeconds).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid lap counts, duplicate IDs, and unusable wet-weather tyres", () => {
    expect(() => simulateRace({ ...raceInput, totalLaps: 7 })).toThrow(RangeError);
    expect(() => simulateRace({ ...raceInput, drivers: [raceInput.drivers[0], { ...raceInput.drivers[1], id: "drv-a" }] })).toThrow("ID driver duplikat");
    expect(() => simulateRace({
      ...raceInput,
      trackCondition: "heavy-wet",
      drivers: raceInput.drivers.map((driver) => ({ ...driver, compound: "soft" as const })),
    })).toThrow("tidak dapat dipakai");
  });
});
