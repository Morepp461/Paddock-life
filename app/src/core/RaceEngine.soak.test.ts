import { describe, expect, it } from "vitest";
import { simulateRace } from "./RaceEngine";
import type { RaceDriverInput } from "./RaceEngine";

function soakDrivers(): RaceDriverInput[] {
  return Array.from({ length: 24 }, (_, index) => ({
    id: "SOAK-" + String(index + 1).padStart(2, "0"),
    name: "Soak Driver " + String(index + 1).padStart(2, "0"),
    carScore: 58 + (index % 12) * 2,
    driverScore: 60 + (index % 10) * 2,
    setupScore: 45 + (index % 6) * 2,
    formModifier: ((index % 5) - 2) * 0.25,
    aggression: 35 + (index % 8) * 5,
    tyreManagement: 40 + (index % 7) * 6,
    mechanicalGrip: 50 + (index % 9) * 5,
    compound: "medium",
    weatherAdaptation: 30 + (index % 10) * 6,
  }));
}

describe("race engine soak validation", () => {
  it("completes 10,000 deterministic race simulations without invalid classifications", () => {
    const drivers = soakDrivers();
    for (let index = 0; index < 10_000; index += 1) {
      const result = simulateRace({
        worldSeed: "soak-seed-" + index,
        season: 1 + Math.floor(index / 500),
        round: (index % 24) + 1,
        tier: 1,
        estimatedCircuitLapSeconds: 90,
        totalLaps: 8,
        trackAbrasion: 50,
        trackTemperatureCelsius: 25,
        trackCondition: "dry",
        referenceSetupScore: 50,
        drivers,
      });
      expect(result.classification).toHaveLength(24);
      expect(result.laps).toHaveLength(8);
      const ids = new Set(result.classification.map((driver) => driver.driverId));
      expect(ids.size).toBe(24);
      for (const driver of result.classification) {
        expect(Number.isFinite(driver.cumulativeTimeSeconds)).toBe(true);
        expect(driver.cumulativeTimeSeconds).toBeGreaterThan(0);
        expect(Number.isFinite(driver.tyreWearPercent)).toBe(true);
      }
    }
  }, 120_000);
});
