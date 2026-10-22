import { calculateBaseLapSeconds, calculatePerformanceDeltaSeconds, TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed, sampleBoundedNormal } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";
import { classifyQualifying, type QualifyingResult, type QualifyingSessionTimes } from "./QualifyingEngine";
import { simulateRace, type RaceDriverInput, type RaceInput, type RaceResult } from "./RaceEngine";

export interface RaceWeekendDriver extends RaceDriverInput {
  readonly qualifyingScore: number;
}

export interface RaceWeekendInput {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly tier: TierId;
  readonly estimatedCircuitLapSeconds: number;
  readonly totalLaps: number;
  readonly trackAbrasion: number;
  readonly trackTemperatureCelsius: number;
  readonly trackCondition: RaceInput["trackCondition"];
  readonly referenceSetupScore: number;
  readonly hasSprint: boolean;
  readonly drivers: readonly RaceWeekendDriver[];
}

export interface RaceWeekendResult {
  readonly qualifying: QualifyingResult;
  readonly sprint: RaceResult | null;
  readonly race: RaceResult;
  readonly sprintLaps: number | null;
  readonly fastestLapDriverIds: readonly string[];
}

function sessionCount(tier: TierId): number {
  const format = TIER_CONFIG[tier].qualifyingFormat;
  return format === "q1-24-12-q2" ? 2 : format === "q1-24-18-q2-18-12-q3" ? 3 : 1;
}

function makeQualifyingSession(input: RaceWeekendInput, sessionIndex: number): QualifyingSessionTimes {
  const config = TIER_CONFIG[input.tier];
  const base = calculateBaseLapSeconds(input.estimatedCircuitLapSeconds, input.tier);
  const times: Record<string, number> = {};
  for (const driver of input.drivers) {
    const random = new SeededRandom(hashSeed([input.worldSeed, input.season, input.round, "qualifying", sessionIndex, driver.id]));
    const delta = calculatePerformanceDeltaSeconds(input.estimatedCircuitLapSeconds, {
      carScore: driver.carScore,
      driverScore: driver.qualifyingScore,
      setupScore: driver.setupScore,
    }, {
      carScore: config.referenceCarScore,
      driverScore: config.referenceDriverOverall,
      setupScore: input.referenceSetupScore,
    });
    times[driver.id] = base + delta + sampleBoundedNormal(random, 0.12, 2.5);
  }
  return { bestLapSecondsByDriver: times };
}

/** Runs a deterministic qualifying session, optional sprint, and main race from career roster data. */
export function simulateRaceWeekend(input: RaceWeekendInput): RaceWeekendResult {
  if (!Number.isSafeInteger(input.season) || input.season < 1 || !Number.isSafeInteger(input.round) || input.round < 1) {
    throw new RangeError("Season dan round harus integer positif.");
  }
  if (!Number.isSafeInteger(input.totalLaps) || input.totalLaps < 8) throw new RangeError("Race harus memiliki minimal 8 lap.");
  const drivers = input.drivers.map(({ qualifyingScore: _qualifyingScore, ...driver }) => driver);
  const qualifying = classifyQualifying({
    tier: input.tier,
    drivers: input.drivers.map((driver) => ({ driverId: driver.id, driverName: driver.name })),
    sessions: Array.from({ length: sessionCount(input.tier) }, (_, index) => makeQualifyingSession(input, index + 1)),
  });
  const raceInput: RaceInput = {
    worldSeed: input.worldSeed,
    season: input.season,
    round: input.round,
    tier: input.tier,
    estimatedCircuitLapSeconds: input.estimatedCircuitLapSeconds,
    totalLaps: input.totalLaps,
    trackAbrasion: input.trackAbrasion,
    trackTemperatureCelsius: input.trackTemperatureCelsius,
    trackCondition: input.trackCondition,
    referenceSetupScore: input.referenceSetupScore,
    drivers,
  };
  const sprintLaps = input.hasSprint ? Math.max(8, Math.round(input.totalLaps * 0.3)) : null;
  const sprint = sprintLaps === null ? null : simulateRace({
    ...raceInput,
    worldSeed: String(input.worldSeed) + ":sprint",
    totalLaps: sprintLaps,
  });
  const race = simulateRace(raceInput);
  const raceLapRows = race.laps.flat();
  const fastestLapSeconds = Math.min(...raceLapRows.map((lap) => lap.lapTimeSeconds));
  const fastestLapDriverIds = [...new Set(raceLapRows.filter((lap) => lap.lapTimeSeconds === fastestLapSeconds).map((lap) => lap.driverId))].sort();
  return { qualifying, sprint, race, sprintLaps, fastestLapDriverIds };
}


const MAIN_RACE_POINTS: Readonly<Record<number, number>> = {
  1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1,
};
const SPRINT_RACE_POINTS: Readonly<Record<number, number>> = {
  1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1,
};

/** PRD Section 6.2 and Division Ruleset: fastest lap bonus applies only in Tiers 1–3. */
export function calculateMainRacePoints(tier: TierId, finishPosition: number, fastestLap: boolean): number {
  if (!Number.isSafeInteger(finishPosition) || finishPosition < 1) {
    throw new RangeError("Posisi finis harus integer positif.");
  }
  const basePoints = MAIN_RACE_POINTS[finishPosition] ?? 0;
  const bonusEligible = tier <= 3 && finishPosition <= 10 && fastestLap;
  return basePoints + (bonusEligible ? 1 : 0);
}

/** Sprint points are fixed at 8–1 for P1–P8 and have no fastest-lap bonus. */
export function calculateSprintRacePoints(finishPosition: number): number {
  if (!Number.isSafeInteger(finishPosition) || finishPosition < 1) {
    throw new RangeError("Posisi finis sprint harus integer positif.");
  }
  return SPRINT_RACE_POINTS[finishPosition] ?? 0;
}
