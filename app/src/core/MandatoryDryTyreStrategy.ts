import { TIER_CONFIG, type TierId } from "./GameConfig";
import { calculateWearPerLap, calculateWearPenaltySeconds, getCompoundPaceResult, type DryTyreCompound } from "./TyreEngine";

export interface MandatoryDryStrategyInput {
  readonly tier: TierId;
  readonly totalLaps: number;
  readonly trackAbrasion: number;
  readonly trackTemperatureCelsius: number;
  readonly driverAggression: number;
  readonly mechanicalGrip: number;
  readonly driverTyreManagement: number;
  /** Full stop loss supplied by the validated pit configuration for this race. */
  readonly pitLossSeconds: number;
}

export interface MandatoryDryStrategy {
  readonly tier: TierId;
  readonly totalLaps: number;
  readonly firstCompound: DryTyreCompound;
  readonly secondCompound: DryTyreCompound;
  /** One-based lap number on which the car pits and switches to secondCompound. */
  readonly pitLap: number;
  readonly compoundByLap: readonly DryTyreCompound[];
  readonly pitStopByLap: readonly boolean[];
  readonly pitLossSecondsByLap: readonly number[];
  /** Compound pace delta + tyre wear penalty + pit loss; common lap-time terms are excluded. */
  readonly modeledStrategyCostSeconds: number;
}

function validateInput(input: MandatoryDryStrategyInput): void {
  if (input.tier < 1 || input.tier > 3) {
    throw new Error("Mandatory two-compound dry strategy hanya berlaku untuk Tier 1–3.");
  }
  if (!Number.isSafeInteger(input.totalLaps) || input.totalLaps < 8) {
    throw new RangeError("Race harus memiliki minimal 8 lap.");
  }
  if (!Number.isFinite(input.pitLossSeconds) || input.pitLossSeconds <= 0) {
    throw new RangeError("Pit loss wajib berupa waktu positif dari konfigurasi pit yang tervalidasi.");
  }
}

function scoreStrategy(
  input: MandatoryDryStrategyInput,
  compounds: readonly DryTyreCompound[],
  pitLap: number,
): number {
  const tier = TIER_CONFIG[input.tier];
  let wear = 0;
  let activeCompound = compounds[0]!;
  let cost = 0;
  for (let lap = 1; lap <= input.totalLaps; lap += 1) {
    const compound = compounds[lap - 1]!;
    const pitStop = lap === pitLap;
    if (pitStop) {
      wear = 0;
      activeCompound = compound;
      cost += input.pitLossSeconds;
    } else if (compound !== activeCompound) {
      throw new Error("Strategi mengganti compound tanpa pit stop.");
    }
    const pace = getCompoundPaceResult({ compound, trackCondition: "dry" });
    if (!pace.usable) throw new Error("Compound strategi tidak valid untuk kondisi dry.");
    cost += pace.deltaSecondsPerLap + calculateWearPenaltySeconds(wear);
    wear = Math.min(100, wear + calculateWearPerLap({
      compound,
      trackAbrasion: input.trackAbrasion,
      driverAggression: input.driverAggression,
      trackTemperatureCelsius: input.trackTemperatureCelsius,
      mechanicalGrip: input.mechanicalGrip,
      driverTyreManagement: input.driverTyreManagement,
      tierWearMultiplier: tier.tyreWearMultiplier,
    }));
  }
  return cost;
}

/**
 * Selects the lowest modeled-time mandatory two-compound dry strategy.
 * All race-specific pit loss values must come from validated game configuration;
 * this planner does not invent stationary times, error probabilities, or pit costs.
 */
export function planMandatoryDryTwoCompoundStrategy(input: MandatoryDryStrategyInput): MandatoryDryStrategy {
  validateInput(input);
  const compounds = TIER_CONFIG[input.tier].allowedDryCompounds;
  if (compounds.length < 2) throw new Error("Tier ini tidak memiliki dua compound kering yang berbeda.");
  let best: MandatoryDryStrategy | null = null;

  for (const firstCompound of compounds) {
    for (const secondCompound of compounds) {
      if (firstCompound === secondCompound) continue;
      for (let pitLap = 2; pitLap < input.totalLaps; pitLap += 1) {
        const compoundByLap = Array.from(
          { length: input.totalLaps },
          (_, index) => index + 1 < pitLap ? firstCompound : secondCompound,
        );
        const cost = scoreStrategy(input, compoundByLap, pitLap);
        if (best && cost >= best.modeledStrategyCostSeconds) continue;
        const pitStopByLap = Array.from({ length: input.totalLaps }, (_, index) => index + 1 === pitLap);
        const pitLossSecondsByLap = Array.from({ length: input.totalLaps }, (_, index) => index + 1 === pitLap ? input.pitLossSeconds : 0);
        best = {
          tier: input.tier,
          totalLaps: input.totalLaps,
          firstCompound,
          secondCompound,
          pitLap,
          compoundByLap,
          pitStopByLap,
          pitLossSecondsByLap,
          modeledStrategyCostSeconds: cost,
        };
      }
    }
  }
  if (!best) throw new Error("Tidak ditemukan strategi dry dua compound yang legal.");
  return best;
}
