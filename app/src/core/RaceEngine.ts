import { calculateBaseLapSeconds, calculatePerformanceDeltaSeconds, TIER_CONFIG, type TierId } from "./GameConfig";
import { calculateWearPerLap, calculateWearPenaltySeconds, getCompoundPaceResult, type TrackCondition, type TyreCompound } from "./TyreEngine";
import { hashSeed, sampleBoundedNormal } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";

export interface RaceDriverInput {
  readonly id: string;
  readonly name: string;
  readonly carScore: number;
  readonly driverScore: number;
  readonly setupScore: number;
  readonly formModifier: number;
  readonly aggression: number;
  readonly tyreManagement: number;
  readonly mechanicalGrip: number;
  readonly compound: TyreCompound;
  /** Must be calibrated in game_config and validated by tier simulation. */
  readonly tierWearMultiplier: number;
}

export interface RaceInput {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly tier: TierId;
  readonly estimatedCircuitLapSeconds: number;
  readonly totalLaps: number;
  readonly trackAbrasion: number;
  readonly trackTemperatureCelsius: number;
  readonly trackCondition: TrackCondition;
  readonly referenceSetupScore: number;
  readonly drivers: readonly RaceDriverInput[];
}

export interface DriverLapResult {
  readonly driverId: string;
  readonly driverName: string;
  readonly lap: number;
  readonly lapTimeSeconds: number;
  readonly cumulativeTimeSeconds: number;
  readonly tyreWearPercent: number;
  readonly position: number;
  readonly gapToLeaderSeconds: number;
}

export interface RaceResult {
  readonly tier: TierId;
  readonly totalLaps: number;
  readonly laps: readonly (readonly DriverLapResult[])[];
  readonly classification: readonly DriverLapResult[];
}

function assertScore(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} harus berada pada rentang 0–100.`);
  }
}

function validateInput(input: RaceInput): void {
  if (!Number.isSafeInteger(input.season) || input.season < 1) throw new RangeError("Season harus integer positif.");
  if (!Number.isSafeInteger(input.round) || input.round < 1) throw new RangeError("Round harus integer positif.");
  if (!Number.isSafeInteger(input.totalLaps) || input.totalLaps < 8) throw new RangeError("Race harus memiliki minimal 8 lap.");
  if (!Number.isFinite(input.trackAbrasion) || input.trackAbrasion < 0 || input.trackAbrasion > 100) {
    throw new RangeError("TrackAbrasion harus berada pada rentang 0–100.");
  }
  if (!Number.isFinite(input.trackTemperatureCelsius)) throw new RangeError("Suhu lintasan harus valid.");
  assertScore("ReferenceSetupScore", input.referenceSetupScore);
  if (input.drivers.length < 2) throw new RangeError("Race membutuhkan minimal dua driver.");
  const ids = new Set<string>();
  for (const driver of input.drivers) {
    if (!driver.id.trim() || !driver.name.trim()) throw new RangeError("Driver harus memiliki ID dan nama.");
    if (ids.has(driver.id)) throw new Error(`ID driver duplikat: ${driver.id}`);
    ids.add(driver.id);
    assertScore("CarScore", driver.carScore);
    assertScore("DriverScore", driver.driverScore);
    assertScore("SetupScore", driver.setupScore);
    assertScore("Aggression", driver.aggression);
    assertScore("TyreManagement", driver.tyreManagement);
    assertScore("MechanicalGrip", driver.mechanicalGrip);
    if (!Number.isFinite(driver.formModifier) || driver.formModifier < -2 || driver.formModifier > 2) {
      throw new RangeError("FormModifier harus berada pada rentang -2 sampai +2.");
    }
    if (!Number.isFinite(driver.tierWearMultiplier) || driver.tierWearMultiplier <= 0) {
      throw new RangeError("TierWearMultiplier harus berupa angka positif yang valid.");
    }
  }
}

interface MutableDriverState {
  readonly input: RaceDriverInput;
  readonly baseLapSeconds: number;
  readonly performanceDeltaSeconds: number;
  readonly compoundDeltaSeconds: number;
  readonly wearPerLap: number;
  cumulativeTimeSeconds: number;
  tyreWearPercent: number;
}

/**
 * Deterministic lap-by-lap race kernel. Weather transitions, pit strategy,
 * incidents, overtaking, and reliability are separate systems and are not
 * simulated by this first kernel.
 */
export function simulateRace(input: RaceInput): RaceResult {
  validateInput(input);
  const tierConfig = TIER_CONFIG[input.tier];
  const fuelFactor = input.tier >= 5 ? 0.4 : 1;
  const states: MutableDriverState[] = input.drivers.map((driver) => {
    const compoundResult = getCompoundPaceResult({ compound: driver.compound, trackCondition: input.trackCondition });
    if (!compoundResult.usable) {
      throw new Error(`Compound ${driver.compound} tidak dapat dipakai pada kondisi ${input.trackCondition}.`);
    }
    return {
      input: driver,
      baseLapSeconds: calculateBaseLapSeconds(input.estimatedCircuitLapSeconds, input.tier),
      performanceDeltaSeconds: calculatePerformanceDeltaSeconds(input.estimatedCircuitLapSeconds,
        { carScore: driver.carScore, driverScore: driver.driverScore, setupScore: driver.setupScore },
        { carScore: tierConfig.referenceCarScore, driverScore: tierConfig.referenceDriverOverall, setupScore: input.referenceSetupScore }),
      compoundDeltaSeconds: compoundResult.deltaSecondsPerLap,
      wearPerLap: calculateWearPerLap({
        compound: driver.compound,
        trackAbrasion: input.trackAbrasion,
        driverAggression: driver.aggression,
        trackTemperatureCelsius: input.trackTemperatureCelsius,
        mechanicalGrip: driver.mechanicalGrip,
        driverTyreManagement: driver.tyreManagement,
        tierWearMultiplier: driver.tierWearMultiplier,
      }),
      cumulativeTimeSeconds: 0,
      tyreWearPercent: 0,
    };
  });

  const laps: DriverLapResult[][] = [];
  for (let lap = 1; lap <= input.totalLaps; lap += 1) {
    const lapResults = states.map((state): Omit<DriverLapResult, "position" | "gapToLeaderSeconds"> => {
      const rng = new SeededRandom(hashSeed([input.worldSeed, input.season, input.round, "race", lap, state.input.id]));
      const randomDelta = sampleBoundedNormal(rng, 0.15, 2.5);
      const formDelta = -state.input.formModifier * 0.05;
      const fuelDelta = 0.035 * (input.totalLaps - lap) * fuelFactor;
      const wearPenalty = calculateWearPenaltySeconds(state.tyreWearPercent);
      const lapTimeSeconds = state.baseLapSeconds
        + state.performanceDeltaSeconds
        + state.compoundDeltaSeconds
        + wearPenalty
        + fuelDelta
        + formDelta
        + randomDelta;
      state.cumulativeTimeSeconds += lapTimeSeconds;
      state.tyreWearPercent = Math.min(100, state.tyreWearPercent + state.wearPerLap);
      return {
        driverId: state.input.id,
        driverName: state.input.name,
        lap,
        lapTimeSeconds,
        cumulativeTimeSeconds: state.cumulativeTimeSeconds,
        tyreWearPercent: state.tyreWearPercent,
      };
    });
    lapResults.sort((a, b) => a.cumulativeTimeSeconds - b.cumulativeTimeSeconds || a.driverId.localeCompare(b.driverId));
    const leaderTime = lapResults[0].cumulativeTimeSeconds;
    laps.push(lapResults.map((result, index) => ({
      ...result,
      position: index + 1,
      gapToLeaderSeconds: result.cumulativeTimeSeconds - leaderTime,
    })));
  }

  return {
    tier: input.tier,
    totalLaps: input.totalLaps,
    laps,
    classification: laps[laps.length - 1],
  };
}
