import { calculateBaseLapSeconds, calculatePerformanceDeltaSeconds, TIER_CONFIG, type TierId } from "./GameConfig";
import { calculateWearPerLap, calculateWearPenaltySeconds, getCompoundPaceResult, type TrackCondition, type TyreCompound } from "./TyreEngine";
import { hashSeed, sampleBoundedNormal } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";
import { calculateWeatherDeltaSeconds } from "./WeatherEngine";

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
  /** Optional per-lap compound schedule. A compound change requires a pit stop on that lap. */
  readonly compoundByLap?: readonly TyreCompound[];
  /** Explicit pit-stop markers indexed by race lap; supports zero-time red-flag tyre changes. */
  readonly pitStopByLap?: readonly boolean[];
  /** Pit time loss in seconds per lap, supplied by source-backed pit strategy/configuration. */
  readonly pitLossSecondsByLap?: readonly number[];
  readonly weatherAdaptation?: number;
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
  /** Optional per-lap conditions supplied by the weather transition system. */
  readonly weatherByLap?: readonly TrackCondition[];
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
  readonly trackCondition: TrackCondition;
  readonly compound: TyreCompound;
  readonly pitStop: boolean;
  readonly pitLossSeconds: number;
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
  if (input.weatherByLap && input.weatherByLap.length !== input.totalLaps) throw new RangeError("WeatherByLap harus memiliki satu kondisi untuk setiap lap.");
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
    if (driver.weatherAdaptation !== undefined) assertScore("WeatherAdaptation", driver.weatherAdaptation);
    for (const [label, schedule] of [
      ["CompoundByLap", driver.compoundByLap],
      ["PitStopByLap", driver.pitStopByLap],
      ["PitLossSecondsByLap", driver.pitLossSecondsByLap],
    ] as const) {
      if (schedule && schedule.length !== input.totalLaps) {
        throw new RangeError(label + " harus memiliki satu nilai untuk setiap lap.");
      }
    }
    if (driver.pitLossSecondsByLap?.some((seconds) => !Number.isFinite(seconds) || seconds < 0)) {
      throw new RangeError("Pit loss harus berupa waktu finite non-negatif.");
    }
    if (driver.pitLossSecondsByLap?.some((seconds, index) => seconds > 0 && !driver.pitStopByLap?.[index])) {
      throw new Error("Pit loss hanya boleh dicatat pada lap yang memiliki pit stop.");
    }
    if (driver.pitStopByLap?.[0] || (driver.pitLossSecondsByLap?.[0] ?? 0) !== 0 ||
        (driver.compoundByLap?.[0] !== undefined && driver.compoundByLap[0] !== driver.compound)) {
      throw new Error("Race tidak dapat dimulai dengan pit stop atau perubahan compound pada lap pertama.");
    }
    if (!Number.isFinite(driver.formModifier) || driver.formModifier < -2 || driver.formModifier > 2) {
      throw new RangeError("FormModifier harus berada pada rentang -2 sampai +2.");
    }
  }
}

interface MutableDriverState {
  readonly input: RaceDriverInput;
  readonly baseLapSeconds: number;
  readonly performanceDeltaSeconds: number;
  cumulativeTimeSeconds: number;
  tyreWearPercent: number;
  activeCompound: TyreCompound;
}

/**
 * Deterministic lap-by-lap race kernel. Weather conditions can be supplied per lap;
 * Per-lap tyre compounds and pit losses are accepted from the strategy/configuration layer;
 * incidents, overtaking, and reliability remain separate systems.
 */
export function simulateRace(input: RaceInput): RaceResult {
  validateInput(input);
  const tierConfig = TIER_CONFIG[input.tier];
  const fuelFactor = input.tier >= 5 ? 0.4 : 1;
  const allowedCompounds: readonly string[] = [
    ...tierConfig.allowedDryCompounds,
    ...tierConfig.allowedWetCompounds,
  ];
  const states: MutableDriverState[] = input.drivers.map((driver) => {
    if (!allowedCompounds.includes(driver.compound)) {
      throw new Error(`Compound ${driver.compound} tidak tersedia untuk Tier ${input.tier}.`);
    }
    const unavailableScheduledCompound = driver.compoundByLap?.find((compound) => !allowedCompounds.includes(compound));
    if (unavailableScheduledCompound) {
      throw new Error(`Compound ${unavailableScheduledCompound} dalam strategi tidak tersedia untuk Tier ${input.tier}.`);
    }
    const initialCondition = input.weatherByLap?.[0] ?? input.trackCondition;
    const compoundResult = getCompoundPaceResult({ compound: driver.compound, trackCondition: initialCondition });
    if (!compoundResult.usable) {
      throw new Error(`Compound ${driver.compound} tidak dapat dipakai pada kondisi ${input.trackCondition}.`);
    }
    return {
      input: driver,
      baseLapSeconds: calculateBaseLapSeconds(input.estimatedCircuitLapSeconds, input.tier),
      performanceDeltaSeconds: calculatePerformanceDeltaSeconds(input.estimatedCircuitLapSeconds,
        { carScore: driver.carScore, driverScore: driver.driverScore, setupScore: driver.setupScore },
        { carScore: tierConfig.referenceCarScore, driverScore: tierConfig.referenceDriverOverall, setupScore: input.referenceSetupScore }),
      cumulativeTimeSeconds: 0,
      tyreWearPercent: 0,
      activeCompound: driver.compound,
    };
  });

  const laps: DriverLapResult[][] = [];
  for (let lap = 1; lap <= input.totalLaps; lap += 1) {
    const trackCondition = input.weatherByLap?.[lap - 1] ?? input.trackCondition;
    const lapResults = states.map((state): Omit<DriverLapResult, "position" | "gapToLeaderSeconds"> => {
      const compound = state.input.compoundByLap?.[lap - 1] ?? state.input.compound;
      const pitStop = state.input.pitStopByLap?.[lap - 1] ?? false;
      const pitLossSeconds = state.input.pitLossSecondsByLap?.[lap - 1] ?? 0;
      if (compound !== state.activeCompound && !pitStop) {
        throw new Error("Driver " + state.input.id + " mengubah compound tanpa pit stop pada lap " + lap + ".");
      }
      if (pitStop) state.tyreWearPercent = 0;
      state.activeCompound = compound;
      const compoundResult = getCompoundPaceResult({ compound, trackCondition });
      if (!compoundResult.usable) throw new Error("Compound " + compound + " tidak dapat dipakai pada kondisi " + trackCondition + ".");
      const wearPerLap = calculateWearPerLap({
        compound,
        trackAbrasion: input.trackAbrasion,
        driverAggression: state.input.aggression,
        trackTemperatureCelsius: input.trackTemperatureCelsius,
        mechanicalGrip: state.input.mechanicalGrip,
        driverTyreManagement: state.input.tyreManagement,
        tierWearMultiplier: tierConfig.tyreWearMultiplier,
      });
      const weatherDelta = calculateWeatherDeltaSeconds({
        condition: trackCondition,
        weatherAdaptation: state.input.weatherAdaptation ?? 0,
        tyreMismatchDeltaSeconds: compoundResult.deltaSecondsPerLap,
      });
      const rng = new SeededRandom(hashSeed([input.worldSeed, input.season, input.round, "race", lap, state.input.id]));
      const randomDelta = sampleBoundedNormal(rng, 0.15, 2.5);
      const formDelta = -state.input.formModifier * 0.05;
      const fuelDelta = 0.035 * (input.totalLaps - lap) * fuelFactor;
      const wearPenalty = calculateWearPenaltySeconds(state.tyreWearPercent);
      const lapTimeSeconds = state.baseLapSeconds
        + state.performanceDeltaSeconds
        + weatherDelta
        + wearPenalty
        + fuelDelta
        + formDelta
        + pitLossSeconds
        + randomDelta;
      state.cumulativeTimeSeconds += lapTimeSeconds;
      state.tyreWearPercent = Math.min(100, state.tyreWearPercent + wearPerLap);
      return {
        driverId: state.input.id,
        driverName: state.input.name,
        lap,
        lapTimeSeconds,
        cumulativeTimeSeconds: state.cumulativeTimeSeconds,
        tyreWearPercent: state.tyreWearPercent,
        trackCondition,
        compound,
        pitStop,
        pitLossSeconds,
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
