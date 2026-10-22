import { describe, expect, it } from "vitest";
import { generateSeasonCalendar, type CalendarCircuit } from "./SeasonCalendar";
import type { TierId } from "./GameConfig";

const circuits: CalendarCircuit[] = Array.from({ length: 30 }, (_, index) => ({
  id: `C${String(index + 1).padStart(2, "0")}`,
  name: `Circuit ${index + 1}`,
  lengthKm: 4.5 + index * 0.1,
  estimatedLapSeconds: 90 + index,
  rainProbability: (index % 10) / 10,
  safetyCarProbability: (index % 5) / 10,
}));

describe("season calendar generation", () => {
  it("creates a reproducible, no-repeat schedule for every tier", () => {
    for (const tier of [1, 2, 3, 4, 5, 6] as const satisfies readonly TierId[]) {
      const first = generateSeasonCalendar({ worldSeed: "world-123", season: 1, tier, circuits });
      const second = generateSeasonCalendar({ worldSeed: "world-123", season: 1, tier, circuits });
      expect(first).toEqual(second);
      expect(first).toHaveLength(({ 1: 24, 2: 24, 3: 18, 4: 12, 5: 10, 6: 8 } as const)[tier]);
      expect(new Set(first.map((race) => race.circuitId)).size).toBe(first.length);
      expect(first.map((race) => race.round)).toEqual(first.map((_, index) => index + 1));
      expect(first.every((race) => race.totalLaps >= 8)).toBe(true);
    }
  });

  it("uses documented sprint counts only for tiers that have sprint races", () => {
    expect(generateSeasonCalendar({ worldSeed: 9, season: 1, tier: 1, circuits }).filter((race) => race.hasSprint)).toHaveLength(8);
    expect(generateSeasonCalendar({ worldSeed: 9, season: 1, tier: 2, circuits }).filter((race) => race.hasSprint)).toHaveLength(6);
    for (const tier of [3, 4, 5, 6] as const) {
      expect(generateSeasonCalendar({ worldSeed: 9, season: 1, tier, circuits }).some((race) => race.hasSprint)).toBe(false);
    }
  });

  it("changes the schedule across seasons and rejects invalid source pools", () => {
    const first = generateSeasonCalendar({ worldSeed: 123, season: 1, tier: 5, circuits });
    const second = generateSeasonCalendar({ worldSeed: 123, season: 2, tier: 5, circuits });
    expect(first.map((race) => race.circuitId)).not.toEqual(second.map((race) => race.circuitId));
    expect(() => generateSeasonCalendar({ worldSeed: 1, season: 1, tier: 1, circuits: circuits.slice(0, 20) })).toThrow("tidak cukup");
    expect(() => generateSeasonCalendar({ worldSeed: 1, season: 0, tier: 5, circuits })).toThrow("Season");
    expect(() => generateSeasonCalendar({ worldSeed: 1, season: 1, tier: 5, circuits: [circuits[0], circuits[0]] })).toThrow("duplikat");
  });
});
