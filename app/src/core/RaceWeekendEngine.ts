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
  return { qualifying, sprint, race, sprintLaps };
}
