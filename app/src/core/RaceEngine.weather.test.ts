import { describe, expect, it } from "vitest";
import { simulateRace, type RaceInput } from "./RaceEngine";

const base: RaceInput = {
  worldSeed: "weather-test",
  season: 1,
  round: 2,
  tier: 1,
  estimatedCircuitLapSeconds: 90,
  totalLaps: 8,
  trackAbrasion: 50,
  trackTemperatureCelsius: 95,
  trackCondition: "dry",
  referenceSetupScore: 50,
  drivers: [
    { id: "a", name: "A", carScore: 74, driverScore: 76, setupScore: 50, formModifier: 0, aggression: 50, tyreManagement: 50, mechanicalGrip: 50, compound: "medium", weatherAdaptation: 0 },
    { id: "b", name: "B", carScore: 74, driverScore: 76, setupScore: 50, formModifier: 0, aggression: 50, tyreManagement: 50, mechanicalGrip: 50, compound: "medium", weatherAdaptation: 0 },
  ],
};

describe("race weather integration", () => {
  it("applies per-lap conditions and exposes them in lap results", () => {
    const weatherByLap = ["dry", "dry", "damp", "wet", "wet", "heavy-wet", "wet", "dry"] as const;
    const result = simulateRace({ ...base, drivers: base.drivers.map((driver) => ({ ...driver, compound: "wet" as const })), weatherByLap });
    expect(result.laps.map((lap) => lap[0].trackCondition)).toEqual(weatherByLap);
    expect(result.laps.every((lap) => lap.length === 2)).toBe(true);
  });

  it("adds the source weather delta to lap time without changing the random seed", () => {
    const dry = simulateRace(base);
    const wet = simulateRace({ ...base, weatherByLap: Array.from({ length: 8 }, () => "wet" as const) });
    expect(wet.laps[0][0].lapTimeSeconds - dry.laps[0][0].lapTimeSeconds).toBeCloseTo(1.2);
  });

  it("uses driver weather adaptation and rejects incomplete weather timelines", () => {
    const baseline = simulateRace({ ...base, weatherByLap: Array.from({ length: 8 }, () => "wet" as const) });
    const adapted = simulateRace({
      ...base,
      drivers: base.drivers.map((driver) => ({ ...driver, weatherAdaptation: 100 })),
      weatherByLap: Array.from({ length: 8 }, () => "wet" as const),
    });
    expect(adapted.laps[0][0].lapTimeSeconds).toBeCloseTo(baseline.laps[0][0].lapTimeSeconds - 2);
    expect(() => simulateRace({ ...base, weatherByLap: ["wet"] })).toThrow("satu kondisi untuk setiap lap");
  });
});
