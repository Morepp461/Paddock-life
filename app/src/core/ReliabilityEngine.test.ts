import { describe, expect, it } from "vitest";
import {
  BASE_FAILURE_RATE,
  calculateComponentFailureRisk,
  calculateStressFactor,
  simulateReliabilityForRace,
  type ComponentReliability,
} from "./ReliabilityEngine";

const components: ComponentReliability[] = [
  { component: "engine", reliability: 75, racesSinceReset: 0 },
  { component: "gearbox", reliability: 75, racesSinceReset: 2 },
  { component: "brake", reliability: 75, racesSinceReset: 5 },
  { component: "suspension", reliability: 75, racesSinceReset: 10 },
  { component: "electronics", reliability: 75, racesSinceReset: 20 },
];

describe("component reliability model", () => {
  it("uses the source base failure rates and stress formula", () => {
    expect(BASE_FAILURE_RATE).toEqual({ engine: 0.1, gearbox: 0.07, brake: 0.05, suspension: 0.05, electronics: 0.07 });
    expect(calculateStressFactor(50, 50)).toBeCloseTo(1.35);
    expect(calculateComponentFailureRisk({
      component: "engine", reliability: 75, racesSinceReset: 0,
      averageAggression: 50, trackAbrasion: 50, tier: 1,
    }).probability).toBeCloseTo(0.00875);
  });

  it("caps component age factor at 1.5 and scales risk by tier", () => {
    const old = calculateComponentFailureRisk({
      component: "engine", reliability: 0, racesSinceReset: 100,
      averageAggression: 100, trackAbrasion: 100, tier: 1,
    });
    const kart = calculateComponentFailureRisk({
      component: "engine", reliability: 0, racesSinceReset: 100,
      averageAggression: 100, trackAbrasion: 100, tier: 6,
    });
    expect(old.ageFactor).toBe(1.5);
    expect(old.probability).toBeCloseTo(0.255);
    expect(kart.probability).toBeCloseTo(old.probability * 0.3);
  });

  it("returns the same failures for the same race and component identity", () => {
    const input = {
      worldSeed: "season-1", season: 1, round: 3, componentInstanceId: "car-17",
      tier: 1 as const, averageAggression: 75, trackAbrasion: 80, components,
    };
    expect(simulateReliabilityForRace(input)).toEqual(simulateReliabilityForRace(input));
    expect(simulateReliabilityForRace({ ...input, componentInstanceId: "car-18" }).componentInstanceId).toBe("car-18");
  });

  it("rejects invalid reliability, race age, and duplicate components", () => {
    expect(() => calculateComponentFailureRisk({
      component: "engine", reliability: 101, racesSinceReset: 0,
      averageAggression: 50, trackAbrasion: 50, tier: 1,
    })).toThrow(RangeError);
    expect(() => calculateComponentFailureRisk({
      component: "engine", reliability: 50, racesSinceReset: -1,
      averageAggression: 50, trackAbrasion: 50, tier: 1,
    })).toThrow(RangeError);
    expect(() => simulateReliabilityForRace({
      worldSeed: 1, season: 1, round: 1, componentInstanceId: "car", tier: 1,
      averageAggression: 50, trackAbrasion: 50,
      components: [components[0], components[0]],
    })).toThrow("duplikat");
  });
});
