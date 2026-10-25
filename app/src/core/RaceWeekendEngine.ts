import { calculateBaseLapSeconds, calculatePerformanceDeltaSeconds, TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed, sampleBoundedNormal } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";
import { classifyQualifying, type QualifyingResult, type QualifyingSessionTimes } from "./QualifyingEngine";
import { simulateRace, type RaceDriverInput, type RaceInput, type RaceResult } from "./RaceEngine";
import { advanceWeather, createWeatherRandom, type WeatherState, type WeatherTransitionMatrix } from "./WeatherEngine";
import { resolveOvertaking, type DefensiveMode } from "./OvertakingEngine";

export interface RaceWeekendDriver extends RaceDriverInput {
  readonly qualifyingScore: number;
  readonly starts?: number;
  readonly racecraft?: number;
  readonly overtakingSkill?: number;
  readonly defendingSkill?: number;
  readonly defensiveMode?: DefensiveMode;
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
  /** Optional source-configured Markov matrix. Omit to preserve fixed-condition sessions. */
  readonly weatherTransitionMatrix?: WeatherTransitionMatrix;
  /** Circuit difficulty is sourced from Pool_Sirkuit, on a 1–10 scale. */
  readonly overtakingDifficulty?: number;
  /** Per-lap DRS availability; omit when zone-level activation data is unavailable. */
  readonly drsZoneActiveByLap?: readonly boolean[];
  readonly drivers: readonly RaceWeekendDriver[];
}

export interface RaceWeekendResult {
  readonly qualifying: QualifyingResult;
  readonly sprint: RaceResult | null;
  readonly race: RaceResult;
  readonly sprintLaps: number | null;
  /** Actual start order after the documented starts-skill adjustment. */
  readonly raceStartingGrid: readonly string[];
  /** Sprint starts are independently seeded; null when the weekend has no sprint. */
  readonly sprintStartingGrid: readonly string[] | null;
  readonly fastestLapDriverIds: readonly string[];
}

function sessionCount(tier: TierId): number {
  const format = TIER_CONFIG[tier].qualifyingFormat;
  return format === "q1-24-12-q2" ? 2 : format === "q1-24-18-q2-18-12-q3" ? 3 : 1;
}

function createWeatherSchedule(
  input: RaceWeekendInput,
  sessionSeed: string | number,
  totalLaps: number,
): readonly RaceInput["trackCondition"][] | undefined {
  const matrix = input.weatherTransitionMatrix;
  if (!matrix) return undefined;
  const schedule: RaceInput["trackCondition"][] = [input.trackCondition];
  let state: WeatherState = {
    condition: input.trackCondition,
    rainLapsElapsed: input.trackCondition === "dry" ? 0 : 1,
  };
  for (let lap = 2; lap <= totalLaps; lap += 1) {
    state = advanceWeather(
      state,
      matrix,
      createWeatherRandom(sessionSeed, input.season, input.round, lap),
    );
    schedule.push(state.condition);
  }
  return schedule;
}

/** Applies the documented starts-skill delta to qualifying grid positions. */
export function calculateStartingGrid(input: {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly session: "sprint" | "race";
  readonly qualifying: QualifyingResult;
  readonly drivers: readonly RaceWeekendDriver[];
}): readonly string[] {
  const startsByDriver = new Map(input.drivers.map((driver) => {
    const starts = driver.starts ?? 50;
    if (!Number.isFinite(starts) || starts < 0 || starts > 100) {
      throw new RangeError("Starts harus berada pada rentang 0–100.");
    }
    return [driver.id, starts] as const;
  }));
  const gridByDriver = new Map(input.qualifying.classification.map((row) => [row.driverId, row.gridPosition]));
  if (gridByDriver.size !== input.drivers.length || input.drivers.some((driver) => !gridByDriver.has(driver.id))) {
    throw new Error("Starting grid harus memiliki seluruh driver yang mengikuti race.");
  }
  const ordered = input.drivers.map((driver) => {
    const ownStarts = startsByDriver.get(driver.id)!;
    const opponentValues = input.drivers.filter((opponent) => opponent.id !== driver.id).map((opponent) => startsByDriver.get(opponent.id)!);
    const averageOpponentStarts = opponentValues.reduce((sum, value) => sum + value, 0) / opponentValues.length;
    const random = new SeededRandom(hashSeed([input.worldSeed, input.season, input.round, input.session, "start", driver.id]));
    const jitter = Math.floor(random.next() * 3) - 1;
    const delta = Math.max(-3, Math.min(3, Math.round((ownStarts - averageOpponentStarts) / 10 + jitter)));
    return {
      driverId: driver.id,
      gridPosition: gridByDriver.get(driver.id)!,
      startPosition: Math.max(1, Math.min(input.drivers.length, gridByDriver.get(driver.id)! - delta)),
    };
  });
  ordered.sort((left, right) => left.startPosition - right.startPosition
    || left.gridPosition - right.gridPosition || left.driverId.localeCompare(right.driverId));
  return ordered.map((entry) => entry.driverId);
}

function applyGridAndOvertaking(
  result: RaceResult,
  input: RaceWeekendInput,
  startingOrder: readonly string[],
  sessionSeed: string | number,
): RaceResult {
  const driverById = new Map(input.drivers.map((driver) => [driver.id, driver]));
  const laps: (typeof result.laps[number])[] = [];
  for (let lapIndex = 0; lapIndex < result.laps.length; lapIndex += 1) {
    const rawLap = result.laps[lapIndex]!;
    const rowById = new Map(rawLap.map((row) => [row.driverId, row]));
    const order = lapIndex === 0
      ? startingOrder.slice()
      : input.overtakingDifficulty === undefined
        ? rawLap.map((row) => row.driverId)
        : laps[lapIndex - 1]!.map((row) => row.driverId);
    if (input.overtakingDifficulty !== undefined) {
      for (let index = 1; index < order.length; index += 1) {
        let attackerPosition = index;
        while (attackerPosition > 0) {
          const attackerId = order[attackerPosition]!;
          const defenderId = order[attackerPosition - 1]!;
          const attacker = driverById.get(attackerId)!;
          const defender = driverById.get(defenderId)!;
          if (attacker.overtakingSkill === undefined || defender.defendingSkill === undefined) break;
          const attackerLap = rowById.get(attackerId)!;
          const defenderLap = rowById.get(defenderId)!;
          const gapSeconds = Math.max(0, attackerLap.cumulativeTimeSeconds - defenderLap.cumulativeTimeSeconds);
          const outcome = resolveOvertaking({
            seed: sessionSeed,
            season: input.season,
            round: input.round,
            lap: lapIndex + 1,
            attackerId,
            defenderId,
            overtake: {
              attackerRacecraft: attacker.racecraft ?? attacker.driverScore,
              attackerPaceAdvantageSeconds: defenderLap.lapTimeSeconds - attackerLap.lapTimeSeconds,
              attackerTyreWearPercent: attackerLap.tyreWearPercent,
              defenderTyreWearPercent: defenderLap.tyreWearPercent,
              gapSeconds,
              drsZoneActive: input.drsZoneActiveByLap?.[lapIndex] ?? false,
              tier: input.tier,
              trackOvertakingDifficulty: input.overtakingDifficulty,
              defenderSkill: defender.defendingSkill,
              defensiveMode: defender.defensiveMode ?? "normal",
            },
          });
          if (!outcome.successful) break;
          [order[attackerPosition - 1], order[attackerPosition]] = [order[attackerPosition]!, order[attackerPosition - 1]!];
          attackerPosition -= 1;
        }
      }
    }
    const leader = rowById.get(order[0]!)!;
    laps.push(order.map((driverId, positionIndex) => {
      const row = rowById.get(driverId)!;
      return {
        ...row,
        position: positionIndex + 1,
        gapToLeaderSeconds: Math.max(0, row.cumulativeTimeSeconds - leader.cumulativeTimeSeconds),
      };
    }));
  }
  return { ...result, laps, classification: laps[laps.length - 1]! };
}

function makeQualifyingSession(input: RaceWeekendInput, sessionIndex: number): QualifyingSessionTimes {
  const config = TIER_CONFIG[input.tier];
  const base = calculateBaseLapSeconds(input.estimatedCircuitLapSeconds, input.tier);
  const times: Record<string, number> = {};
  for (const driver of input.drivers) {
    const delta = calculatePerformanceDeltaSeconds(input.estimatedCircuitLapSeconds, {
      carScore: driver.carScore,
      driverScore: driver.qualifyingScore,
      setupScore: driver.setupScore,
    }, {
      carScore: config.referenceCarScore,
      driverScore: config.referenceDriverOverall,
      setupScore: input.referenceSetupScore,
    });
    // Simulation Rules Addendum §12: each driver gets two runs; best lap counts.
    // Qualifying randomness is sigma 0.10 s, clipped to ±0.25 s.
    const runTimes = [1, 2].map((runIndex) => {
      const random = new SeededRandom(hashSeed([
        input.worldSeed, input.season, input.round, "qualifying", sessionIndex, runIndex, driver.id,
      ]));
      return base + delta + sampleBoundedNormal(random, 0.10, 2.5);
    });
    times[driver.id] = Math.min(...runTimes);
  }
  return { bestLapSecondsByDriver: times };
}

/** Runs a deterministic qualifying session, optional sprint, and main race from career roster data. */
export function simulateRaceWeekend(input: RaceWeekendInput): RaceWeekendResult {
  if (!Number.isSafeInteger(input.season) || input.season < 1 || !Number.isSafeInteger(input.round) || input.round < 1) {
    throw new RangeError("Season dan round harus integer positif.");
  }
  if (!Number.isSafeInteger(input.totalLaps) || input.totalLaps < 8) throw new RangeError("Race harus memiliki minimal 8 lap.");
  if (input.overtakingDifficulty !== undefined &&
      (!Number.isSafeInteger(input.overtakingDifficulty) || input.overtakingDifficulty < 1 || input.overtakingDifficulty > 10)) {
    throw new RangeError("Overtaking difficulty harus integer 1–10.");
  }
  if (input.drsZoneActiveByLap && input.drsZoneActiveByLap.length !== input.totalLaps) {
    throw new RangeError("DRS activation schedule harus memiliki satu nilai per lap.");
  }
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
  const sprintSeed = String(input.worldSeed) + ":sprint";
  // Division Ruleset §3: sprint starts directly from qualifying classification.
  const sprintGrid = [...qualifying.classification]
    .sort((left, right) => left.gridPosition - right.gridPosition)
    .map((row) => row.driverId);
  const raceGrid = calculateStartingGrid({
    worldSeed: input.worldSeed, season: input.season, round: input.round,
    session: "race", qualifying, drivers: input.drivers,
  });
  // The mandatory two-compound rule is specified for the main dry race.
  // Do not carry a full-distance main-race pit schedule into the shorter sprint.
  const sprintDrivers = drivers.map((driver) => ({
    ...driver,
    compoundByLap: undefined,
    pitStopByLap: undefined,
    pitLossSecondsByLap: undefined,
  }));
  const rawSprint = sprintLaps === null ? null : simulateRace({
    ...raceInput,
    drivers: sprintDrivers,
    worldSeed: sprintSeed,
    totalLaps: sprintLaps,
    weatherByLap: createWeatherSchedule(input, sprintSeed, sprintLaps),
  });
  const sprint = rawSprint === null ? null : applyGridAndOvertaking(rawSprint, input, sprintGrid, sprintSeed);
  const rawRace = simulateRace({
    ...raceInput,
    weatherByLap: createWeatherSchedule(input, input.worldSeed, input.totalLaps),
  });
  const race = applyGridAndOvertaking(rawRace, input, raceGrid, input.worldSeed);
  const raceLapRows = race.laps.flat();
  const fastestLapSeconds = Math.min(...raceLapRows.map((lap) => lap.lapTimeSeconds));
  const fastestLapDriverIds = [...new Set(raceLapRows.filter((lap) => lap.lapTimeSeconds === fastestLapSeconds).map((lap) => lap.driverId))].sort();
  return { qualifying, sprint, race, sprintLaps, raceStartingGrid: raceGrid, sprintStartingGrid: sprint === null ? null : sprintGrid, fastestLapDriverIds };
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

export interface DriverTyreStrategySummary {
  readonly pitStops: number;
  readonly compounds: readonly import("./TyreEngine").TyreCompound[];
  readonly serialized: string;
}

/** Derives persisted strategy details from actual lap results rather than the starting compound. */
export function summarizeDriverTyreStrategy(
  result: RaceResult,
  driverId: string,
): DriverTyreStrategySummary {
  if (!driverId.trim()) throw new Error("Driver ID wajib diisi untuk merangkum strategi ban.");
  const driverLaps = result.laps
    .flat()
    .filter((row) => row.driverId === driverId)
    .sort((left, right) => left.lap - right.lap);
  if (driverLaps.length === 0) throw new Error("Tidak ada catatan lap untuk driver " + driverId + ".");
  const compounds: import("./TyreEngine").TyreCompound[] = [];
  let pitStops = 0;
  for (const lap of driverLaps) {
    if (lap.pitStop) pitStops += 1;
    if (compounds[compounds.length - 1] !== lap.compound) compounds.push(lap.compound);
  }
  return { pitStops, compounds, serialized: compounds.join("→") };
}

/** Sprint points are fixed at 8–1 for P1–P8 and have no fastest-lap bonus. */
export function calculateSprintRacePoints(finishPosition: number): number {
  if (!Number.isSafeInteger(finishPosition) || finishPosition < 1) {
    throw new RangeError("Posisi finis sprint harus integer positif.");
  }
  return SPRINT_RACE_POINTS[finishPosition] ?? 0;
}
