import { describe, expect, it } from "vitest";
import { calculateBaseLapSeconds, calculatePerformanceDeltaSeconds, TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed, sampleBoundedNormal } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";
import { calculateMainRacePoints, calculateSprintRacePoints, calculateStartingGrid, simulateRaceWeekend, type RaceWeekendDriver } from "./RaceWeekendEngine";
import type { WeatherTransitionMatrix } from "./WeatherEngine";
import { planMandatoryDryTwoCompoundStrategy } from "./MandatoryDryTyreStrategy";

function drivers(count: number, compound: RaceWeekendDriver["compound"] = "medium"): RaceWeekendDriver[] {
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
    compound,
    weatherAdaptation: 50,
    starts: 50,
    racecraft: 60,
    overtakingSkill: 55,
    defendingSkill: 55,
  }));
}

describe("race weekend orchestration", () => {
  it("uses the source-defined starts attribute to adjust the qualifying grid by up to three places", () => {
    const roster = drivers(24).map((driver, index) => ({ ...driver, starts: index === 23 ? 100 : 0 }));
    const result = simulateRaceWeekend({
      worldSeed: "start-delta-test", season: 1, round: 1, tier: 1,
      estimatedCircuitLapSeconds: 90, totalLaps: 8, trackAbrasion: 50,
      trackTemperatureCelsius: 25, trackCondition: "dry", referenceSetupScore: 50,
      hasSprint: false, drivers: roster,
    });
    const qualifyingGrid = new Map(result.qualifying.classification.map((row) => [row.driverId, row.gridPosition]));
    const adjustedGrid = calculateStartingGrid({
      worldSeed: "start-delta-test", season: 1, round: 1, session: "race",
      qualifying: result.qualifying, drivers: roster,
    });
    const highStartsDriver = adjustedGrid.indexOf("D24") + 1;
    expect(highStartsDriver).toBeLessThan(qualifyingGrid.get("D24") ?? 24);
    expect(adjustedGrid).toHaveLength(24);
    expect(new Set(adjustedGrid).size).toBe(24);
  });

  it("uses the best of two source-bounded qualifying runs", () => {
    const roster = drivers(24, "hard");
    const input = {
      worldSeed: "two-qualifying-runs", season: 1, round: 1, tier: 6 as const,
      estimatedCircuitLapSeconds: 80, totalLaps: 8, trackAbrasion: 50,
      trackTemperatureCelsius: 25, trackCondition: "dry" as const, referenceSetupScore: 50,
      hasSprint: false, drivers: roster,
    };
    const result = simulateRaceWeekend(input);
    const driver = roster[0]!;
    const base = calculateBaseLapSeconds(input.estimatedCircuitLapSeconds, input.tier);
    const delta = calculatePerformanceDeltaSeconds(input.estimatedCircuitLapSeconds, {
      carScore: driver.carScore, driverScore: driver.qualifyingScore, setupScore: driver.setupScore,
    }, {
      carScore: TIER_CONFIG[input.tier].referenceCarScore,
      driverScore: TIER_CONFIG[input.tier].referenceDriverOverall,
      setupScore: input.referenceSetupScore,
    });
    const runTimes = [1, 2].map((runIndex) => {
      const random = new SeededRandom(hashSeed([
        input.worldSeed, input.season, input.round, "qualifying", 1, runIndex, driver.id,
      ]));
      return base + delta + sampleBoundedNormal(random, 0.10, 2.5);
    });
    expect(result.qualifying.classification.find((row) => row.driverId === driver.id)?.bestLapSeconds)
      .toBe(Math.min(...runTimes));
  });

  it("keeps sprint grid identical to qualifying while applying starts skill only to the main race", () => {
    const roster = drivers(24).map((driver, index) => ({ ...driver, starts: index === 23 ? 100 : 0 }));
    const result = simulateRaceWeekend({
      worldSeed: "sprint-grid-source-rule", season: 1, round: 1, tier: 1,
      estimatedCircuitLapSeconds: 90, totalLaps: 12, trackAbrasion: 50,
      trackTemperatureCelsius: 25, trackCondition: "dry", referenceSetupScore: 50,
      hasSprint: true, drivers: roster,
    });
    const qualifyingOrder = [...result.qualifying.classification]
      .sort((left, right) => left.gridPosition - right.gridPosition)
      .map((row) => row.driverId);
    expect(result.sprintStartingGrid).toEqual(qualifyingOrder);
    expect(result.raceStartingGrid).not.toEqual(qualifyingOrder);
  });

  it("continues ordering by accumulated lap performance when circuit overtaking config is absent", () => {
    const roster = drivers(24).map((driver, index) => index === 0
      ? { ...driver, carScore: 30, driverScore: 30, qualifyingScore: 100 }
      : index === 23
        ? { ...driver, carScore: 100, driverScore: 100, qualifyingScore: 0 }
        : driver);
    const result = simulateRaceWeekend({
      worldSeed: "lap-order-fallback-test", season: 1, round: 1, tier: 1,
      estimatedCircuitLapSeconds: 90, totalLaps: 8, trackAbrasion: 50,
      trackTemperatureCelsius: 25, trackCondition: "dry", referenceSetupScore: 50,
      hasSprint: false, drivers: roster,
    });
    const qualifyingGrid = result.qualifying.classification.find((row) => row.driverId === "D24")!.gridPosition;
    const lapTwoPosition = result.race.laps[1]!.find((row) => row.driverId === "D24")!.position;
    expect(qualifyingGrid).toBeGreaterThan(12);
    expect(lapTwoPosition).toBeLessThan(qualifyingGrid);
  });

  it("allows a faster driver to attempt and make source-modelled overtakes instead of auto-sorting only by lap time", () => {
    const roster = drivers(24).map((driver, index) => index === 0
      ? { ...driver, carScore: 30, driverScore: 30, qualifyingScore: 100, racecraft: 0, overtakingSkill: 0, defendingSkill: 0 }
      : index === 23
        ? { ...driver, carScore: 100, driverScore: 100, qualifyingScore: 0, racecraft: 100, overtakingSkill: 100, defendingSkill: 100 }
        : { ...driver, racecraft: 50, overtakingSkill: 50, defendingSkill: 50 });
    const result = simulateRaceWeekend({
      worldSeed: "overtake-integration-test", season: 1, round: 1, tier: 1,
      estimatedCircuitLapSeconds: 90, totalLaps: 8, trackAbrasion: 50,
      trackTemperatureCelsius: 25, trackCondition: "dry", referenceSetupScore: 50,
      hasSprint: false, overtakingDifficulty: 1, drivers: roster,
    });
    const gridPosition = result.qualifying.classification.find((row) => row.driverId === "D24")!.gridPosition;
    const lapOnePosition = result.race.laps[0]!.find((row) => row.driverId === "D24")!.position;
    expect(gridPosition).toBeGreaterThan(12);
    expect(lapOnePosition).toBeLessThan(gridPosition);
    expect(result.race.classification).toHaveLength(24);
  });
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
    expect(first.raceStartingGrid).toEqual(second.raceStartingGrid);
    expect(first.sprintStartingGrid).toEqual(second.sprintStartingGrid);
    expect(first.raceStartingGrid).toHaveLength(24);
    expect(first.sprintStartingGrid).toHaveLength(24);
    expect(new Set(first.raceStartingGrid).size).toBe(24);
    expect(new Set(first.sprintStartingGrid).size).toBe(24);
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

  it("completes a deterministic race weekend for every tier configuration", () => {
    const tiers: readonly TierId[] = [1, 2, 3, 4, 5, 6];
    for (const tier of tiers) {
      const config = TIER_CONFIG[tier];
      const compound = config.allowedDryCompounds[0]!;
      const input = {
        worldSeed: "all-tier-weekend-" + tier,
        season: 1,
        round: 1,
        tier,
        estimatedCircuitLapSeconds: 55 + tier * 4,
        totalLaps: 8,
        trackAbrasion: 45,
        trackTemperatureCelsius: 22,
        trackCondition: "dry" as const,
        referenceSetupScore: 50,
        hasSprint: config.sprintRacesPerSeason > 0,
        drivers: drivers(config.gridSize, compound),
      };
      const first = simulateRaceWeekend(input);
      const second = simulateRaceWeekend(input);
      expect(first.qualifying.classification).toHaveLength(config.gridSize);
      expect(first.race.classification).toHaveLength(config.gridSize);
      expect(first.race.totalLaps).toBe(8);
      expect(first.sprint !== null).toBe(config.sprintRacesPerSeason > 0);
      expect(first.race.classification.map((row) => row.driverId))
        .toEqual(second.race.classification.map((row) => row.driverId));
      expect(new Set(first.race.classification.map((row) => row.driverId)).size).toBe(config.gridSize);
    }
  });

  it("keeps main-race mandatory pit schedules out of the shorter sprint session", () => {
    const roster = drivers(24, "medium");
    const strategy = planMandatoryDryTwoCompoundStrategy({
      tier: 1, totalLaps: 12, trackAbrasion: 50, trackTemperatureCelsius: 95,
      driverAggression: roster[0]!.aggression, mechanicalGrip: roster[0]!.mechanicalGrip,
      driverTyreManagement: roster[0]!.tyreManagement, pitLossSeconds: 24,
    });
    roster[0] = {
      ...roster[0]!,
      compound: strategy.firstCompound,
      compoundByLap: strategy.compoundByLap,
      pitStopByLap: strategy.pitStopByLap,
      pitLossSecondsByLap: strategy.pitLossSecondsByLap,
    };
    const result = simulateRaceWeekend({
      worldSeed: "sprint-main-pit-isolation", season: 1, round: 1, tier: 1,
      estimatedCircuitLapSeconds: 90, totalLaps: 12, trackAbrasion: 50,
      trackTemperatureCelsius: 95, trackCondition: "dry", referenceSetupScore: 50,
      hasSprint: true, drivers: roster,
    });
    expect(result.sprint?.laps.flat().some((row) => row.pitStop)).toBe(false);
    expect(result.race.laps[strategy.pitLap - 1]!.find((row) => row.driverId === roster[0]!.id)?.pitStop).toBe(true);
    expect(result.race.laps[strategy.pitLap - 1]!.find((row) => row.driverId === roster[0]!.id)?.pitLossSeconds).toBe(24);
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
    expect(result.sprintStartingGrid).toBeNull();
    expect(result.raceStartingGrid).toHaveLength(24);
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
