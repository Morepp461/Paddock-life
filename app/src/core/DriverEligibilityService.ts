import { TIER_CONFIG, type TierId } from "./GameConfig";

export interface DriverEligibilityInput {
  readonly age: number;
  readonly tier: TierId;
}
export interface DriverEligibilityResult {
  readonly eligible: boolean;
  readonly age: number;
  readonly tier: TierId;
  readonly minimumAge: number;
  readonly maximumAge: number;
  readonly reason: string | null;
}

/** Enforces the hard age band defined for each division in the final ruleset. */
export function evaluateDriverEligibility(input: DriverEligibilityInput): DriverEligibilityResult {
  if (!Number.isSafeInteger(input.age) || input.age < 0) throw new RangeError("Umur driver harus integer non-negatif.");
  const band = TIER_CONFIG[input.tier].driverAge;
  if (input.age < band.min) {
    return {
      eligible: false, age: input.age, tier: input.tier,
      minimumAge: band.min, maximumAge: band.max,
      reason: `Driver berumur ${input.age} belum memenuhi batas minimum ${band.min} tahun untuk Tier ${input.tier}.`,
    };
  }
  if (input.age > band.max) {
    return {
      eligible: false, age: input.age, tier: input.tier,
      minimumAge: band.min, maximumAge: band.max,
      reason: `Driver berumur ${input.age} melewati batas maksimum ${band.max} tahun untuk Tier ${input.tier}.`,
    };
  }
  return {
    eligible: true, age: input.age, tier: input.tier,
    minimumAge: band.min, maximumAge: band.max, reason: null,
  };
}

export function assertDriverEligible(input: DriverEligibilityInput): void {
  const result = evaluateDriverEligibility(input);
  if (!result.eligible) throw new Error(result.reason ?? "Driver tidak memenuhi syarat untuk divisi ini.");
}
