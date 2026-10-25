import { effectiveDriverDevelopmentRate } from "./YouthLoanService";

export type DriverDevelopmentAttribute =
  | "pace" | "qualifying" | "racecraft" | "consistency" | "wet_skill"
  | "tyre_management" | "overtaking" | "defending" | "starts" | "adaptability"
  | "focus" | "pressure" | "morale" | "confidence" | "aggression" | "teamwork";

export interface DriverDevelopmentGainInput {
  readonly trainingFacilitiesLevel: number;
  readonly baseDevelopmentRate: number;
  readonly isLoanedForSeason: boolean;
  /** Source table from 02_Simulation_Rules_Addendum_v1, provided for the driver's age/attribute. */
  readonly ageFactor: number;
  /** Potential − current overall, in rating points, not normalized. */
  readonly potentialRemaining: number;
}

export interface DriverDevelopmentGain {
  readonly trainingQuality: number;
  readonly effectiveDevelopmentRate: number;
  readonly ageFactor: number;
  readonly potentialRemaining: number;
  readonly gain: number;
}

/** 07_Development_Catalog_v1: TrainingQuality = 0.6 + 0.05 × Training Facilities level. */
export function calculateTrainingQuality(trainingFacilitiesLevel: number): number {
  if (!Number.isSafeInteger(trainingFacilitiesLevel) || trainingFacilitiesLevel < 1 || trainingFacilitiesLevel > 10) {
    throw new RangeError("Training Facilities level harus integer 1–10.");
  }
  return 0.6 + 0.05 * trainingFacilitiesLevel;
}

/**
 * 02_Simulation_Rules_Addendum_v1: DevelopmentGain = TrainingQuality × DevelopmentRate
 * × AgeFactor × PotentialRemaining / 100. Age and remaining-potential inputs must
 * come from the documented table/current overall calculation; this function does not
 * invent missing attribute-specific modifiers.
 */
export function calculateDriverDevelopmentGain(input: DriverDevelopmentGainInput): DriverDevelopmentGain {
  const trainingQuality = calculateTrainingQuality(input.trainingFacilitiesLevel);
  if (!Number.isFinite(input.baseDevelopmentRate) || input.baseDevelopmentRate < 0) {
    throw new RangeError("Development rate harus finite dan non-negatif.");
  }
  if (!Number.isFinite(input.ageFactor)) {
    throw new RangeError("Age factor harus finite.");
  }
  if (!Number.isFinite(input.potentialRemaining) || input.potentialRemaining < 0 || input.potentialRemaining > 100) {
    throw new RangeError("Potential remaining harus berada pada rentang 0–100 poin.");
  }
  const effectiveDevelopmentRate = effectiveDriverDevelopmentRate(input.baseDevelopmentRate, input.isLoanedForSeason);
  const gain = trainingQuality * effectiveDevelopmentRate * input.ageFactor * input.potentialRemaining / 100;
  return {
    trainingQuality,
    effectiveDevelopmentRate,
    ageFactor: input.ageFactor,
    potentialRemaining: input.potentialRemaining,
    gain,
  };
}

/** The documented default growth age-factor table. */
export function getDriverGrowthAgeFactor(age: number): number {
  if (!Number.isSafeInteger(age) || age < 0) throw new RangeError("Umur driver harus integer non-negatif.");
  if (age <= 13) return 1.6;
  if (age <= 17) return 1.25;
  if (age <= 23) return 1;
  if (age <= 29) return 0.55;
  if (age <= 33) return 0.15;
  if (age <= 38) return -0.3;
  return -0.7;
}
