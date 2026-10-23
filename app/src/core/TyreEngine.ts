import { clamp } from "./math";

export type TyreCompound = "soft" | "medium" | "hard" | "intermediate" | "wet";
export type TrackCondition = "dry" | "damp" | "wet" | "heavy-wet";

export interface TyreCompoundConfig {
  readonly baseWearPerLap: number;
  readonly dryPaceDeltaSeconds: number;
  readonly idealTemperatureCelsius: { readonly min: number; readonly max: number };
}

export const TYRE_COMPOUND_CONFIG: Readonly<Record<TyreCompound, TyreCompoundConfig>> = {
  soft: { baseWearPerLap: 3.6, dryPaceDeltaSeconds: -0.60, idealTemperatureCelsius: { min: 90, max: 110 } },
  medium: { baseWearPerLap: 2.4, dryPaceDeltaSeconds: 0, idealTemperatureCelsius: { min: 85, max: 105 } },
  hard: { baseWearPerLap: 1.7, dryPaceDeltaSeconds: 0.55, idealTemperatureCelsius: { min: 80, max: 100 } },
  intermediate: { baseWearPerLap: 3.0, dryPaceDeltaSeconds: 1.2, idealTemperatureCelsius: { min: 60, max: 80 } },
  wet: { baseWearPerLap: 2.0, dryPaceDeltaSeconds: 4.0, idealTemperatureCelsius: { min: 50, max: 70 } },
} as const;

export interface TyreWearInput {
  readonly compound: TyreCompound;
  readonly trackAbrasion: number;
  readonly driverAggression: number;
  /** Omit when no source-backed circuit temperature is available. */
  readonly trackTemperatureCelsius?: number;
  readonly mechanicalGrip: number;
  readonly driverTyreManagement: number;
  /** Must come from the validated tier configuration, not an implicit default. */
  readonly tierWearMultiplier: number;
}

export interface TyreConditionInput {
  readonly compound: TyreCompound;
  readonly trackCondition: TrackCondition;
}

export interface CompoundPaceResult {
  readonly deltaSecondsPerLap: number;
  readonly usable: boolean;
}

function assertPercentage(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} harus berada pada rentang 0–100.`);
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} harus berupa angka positif yang valid.`);
  }
}

/** Document 02, Section 4. Temperature outside the compound window increases wear. */
export function calculateTemperatureWearFactor(
  temperatureCelsius: number,
  window: { readonly min: number; readonly max: number },
): number {
  if (!Number.isFinite(temperatureCelsius) || window.min > window.max) {
    throw new RangeError("Suhu dan jendela suhu ban tidak valid.");
  }
  const degreesOutside = temperatureCelsius < window.min
    ? window.min - temperatureCelsius
    : temperatureCelsius > window.max
      ? temperatureCelsius - window.max
      : 0;
  return Math.min(1.6, 1 + degreesOutside * 0.02);
}

/** Document 02, Section 4. Returns wear as percentage points per lap. */
export function calculateWearPerLap(input: TyreWearInput): number {
  const compound = TYRE_COMPOUND_CONFIG[input.compound];
  assertPercentage("TrackAbrasion", input.trackAbrasion);
  assertPercentage("Aggression", input.driverAggression);
  assertPercentage("MechanicalGrip", input.mechanicalGrip);
  assertPercentage("TyreManagement", input.driverTyreManagement);
  assertPositive("TierWearMultiplier", input.tierWearMultiplier);

  const aggressionFactor = 0.7 + 0.6 * input.driverAggression / 100;
  const carBalanceFactor = clamp(1.15 - 0.003 * input.mechanicalGrip, 0.85, 1.15);
  const driverManagementFactor = 1.15 - 0.004 * input.driverTyreManagement;
  const temperatureFactor = input.trackTemperatureCelsius === undefined
    ? 1
    : calculateTemperatureWearFactor(input.trackTemperatureCelsius, compound.idealTemperatureCelsius);

  return compound.baseWearPerLap
    * (input.trackAbrasion / 50)
    * aggressionFactor
    * temperatureFactor
    * carBalanceFactor
    * driverManagementFactor
    * input.tierWearMultiplier;
}

/** Document 02, Section 4. Wear penalty is nonlinear after the tyre cliff. */
export function calculateWearPenaltySeconds(wearPercent: number): number {
  assertPercentage("Wear", wearPercent);
  if (wearPercent <= 60) return 0;
  if (wearPercent <= 80) return (wearPercent - 60) * 0.01;
  return 0.2 + (wearPercent - 80) * 0.06;
}

/** Document 02, Section 4. Delta is relative to Medium; unusable tyres are explicit. */
export function getCompoundPaceResult(input: TyreConditionInput): CompoundPaceResult {
  const { compound, trackCondition } = input;
  if (trackCondition === "dry") {
    if (compound === "intermediate") return { deltaSecondsPerLap: 3, usable: true };
    if (compound === "wet") return { deltaSecondsPerLap: 6, usable: true };
    return { deltaSecondsPerLap: TYRE_COMPOUND_CONFIG[compound].dryPaceDeltaSeconds, usable: true };
  }
  if (trackCondition === "damp") {
    if (compound === "intermediate") return { deltaSecondsPerLap: -2, usable: true };
    if (compound === "wet") return { deltaSecondsPerLap: 2, usable: true };
    return { deltaSecondsPerLap: 4, usable: true };
  }
  if (trackCondition === "wet") {
    if (compound === "wet") return { deltaSecondsPerLap: -3, usable: true };
    if (compound === "intermediate") return { deltaSecondsPerLap: -2, usable: true };
    return { deltaSecondsPerLap: 9, usable: true };
  }
  if (compound === "wet") return { deltaSecondsPerLap: -3, usable: true };
  if (compound === "intermediate") return { deltaSecondsPerLap: 4, usable: true };
  return { deltaSecondsPerLap: 0, usable: false };
}
