import { describe, expect, it } from "vitest";
import { simulateRaceWeekend, type RaceWeekendDriver } from "./RaceWeekendEngine";

function drivers(count: number): RaceWeekendDriver[] {
  return Array.from({ length: count }, (_, index) => ({
    id: "D" + String(index + 1).padStart(2, "0"),
    name: "Driver " + String(index + 1).padStart(2, "0"),
    carScore: 70 - index * 0.2,
    driverScore: 72 - index * 0.3,
    qualifyingScore: 74 - index * 0.25,
    setupScore: 50,
    formModifier: 0,
    aggression: 50,
    tyreManagement: 60,
    mechanicalGrip: 70,
    compound: "medium",
    weatherAdaptation: 50,
  }));
}

describe("race weekend orchestration", () => {
  it("runs qualifying, sprint, and race reproducibly for a sprint tier", () => {
    const input = {
      worldSeed: "race-weekend-test",
      season: 1,
      round: 1,
      tier: 1 as const,
      estimatedCircuitLapSeconds: 90,
      totalLaps: 12,
      trackAbrasion: 50,
      trackTemperatureCelsius: 25,
      trackCondition: "dry" as const,
      referenceSetupScore: 50,
      hasSprint: true,
      drivers: drivers(24),
    };
    const first = simulateRaceWeekend(input);
    const second = simulateRaceWeekend(input);
    expect(first.qualifying.classification).toHaveLength(24);
    expect(first.qualifying.classification.map((row) => row.driverId)).toEqual(second.qualifying.classification.map((row) => row.driverId));
    expect(first.sprint?.totalLaps).toBe(8);
    expect(first.race.totalLaps).toBe(12);
    expect(first.race.classification.map((row) => row.driverId)).toEqual(second.race.classification.map((row) => row.driverId));
  });

  it("does not create a sprint session when the calendar round has no sprint", () => {
    const result = simulateRaceWeekend({
      worldSeed: "no-sprint-test",
      season: 1,
      round: 1,
      tier: 3,
      estimatedCircuitLapSeconds: 90,
      totalLaps: 8,
      trackAbrasion: 45,
      trackTemperatureCelsius: 24,
      trackCondition: "dry",
      referenceSetupScore: 50,
      hasSprint: false,
      drivers: drivers(24),
    });
    expect(result.sprint).toBeNull();
    expect(result.sprintLaps).toBeNull();
  });
});
