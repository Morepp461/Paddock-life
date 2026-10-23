import { describe, expect, it } from "vitest";
import { calculateMainRacePoints, calculateSprintRacePoints, simulateRaceWeekend, type RaceWeekendDriver } from "./RaceWeekendEngine";
import type { WeatherTransitionMatrix } from "./WeatherEngine";

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
    const nextSeason = simulateRaceWeekend({ ...input, season: 2 });
    expect(nextSeason.race.laps[0]?.[0]?.lapTimeSeconds).not.toBe(first.race.laps[0]?.[0]?.lapTimeSeconds);
  });

  it("applies configured weather transitions deterministically and preserves minimum rain duration", () => {
    const alwaysDry: WeatherTransitionMatrix = {
      dry: { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
      damp: { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
      wet: { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
      "heavy-wet": { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
    };
    const input = {
      worldSeed: "weather-weekend-test",
      season: 1,
      round: 2,
      tier: 1 as const,
      estimatedCircuitLapSeconds: 90,
      totalLaps: 12,
      trackAbrasion: 50,
      trackTemperatureCelsius: 25,
      trackCondition: "wet" as const,
      referenceSetupScore: 50,
      hasSprint: false,
      weatherTransitionMatrix: alwaysDry,
      drivers: drivers(24),
    };
    const first = simulateRaceWeekend(input);
    const second = simulateRaceWeekend(input);
    const conditions = first.race.laps.map((lap) => lap[0]!.trackCondition);
    expect(conditions.slice(0, 6).every((condition) => condition !== "dry")).toBe(true);
    expect(conditions).toEqual(second.race.laps.map((lap) => lap[0]!.trackCondition));
    expect(conditions[6]).toBe("dry");
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

describe("championship points", () => {
  it("awards fastest lap only to a top-ten finisher in Tiers 1–3", () => {
    expect(calculateMainRacePoints(1, 1, true)).toBe(26);
    expect(calculateMainRacePoints(3, 10, true)).toBe(2);
    expect(calculateMainRacePoints(3, 11, true)).toBe(0);
    expect(calculateMainRacePoints(4, 1, true)).toBe(25);
    expect(calculateMainRacePoints(5, 10, true)).toBe(1);
    expect(calculateMainRacePoints(2, 2, false)).toBe(18);
  });

  it("awards sprint points P1–P8 only without a fastest-lap bonus", () => {
    expect(Array.from({ length: 8 }, (_, index) => calculateSprintRacePoints(index + 1)))
      .toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(calculateSprintRacePoints(9)).toBe(0);
    expect(() => calculateSprintRacePoints(0)).toThrow("integer positif");
  });
});
