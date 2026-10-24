import type { IDatabase } from "../storage/IDatabase";
import { requireGameConfigNumber } from "../storage/GameConfigStore";
import type { TierId } from "./GameConfig";

export interface PitStopConfigForTier {
  readonly tier: TierId;
  readonly pitAllowed: boolean;
  readonly pitLaneLengthMeters: number;
  readonly pitLaneSpeedMetersPerSecond: number | null;
  readonly stationarySeconds: number | null;
  readonly stationaryJitterRangeSeconds: number | null;
  readonly fixedTotalLossSeconds: number | null;
  readonly crewErrorProbabilityBounds: { readonly minimum: number; readonly maximum: number } | null;
  readonly unsafeReleaseProbabilityBounds: { readonly minimum: number; readonly maximum: number } | null;
  readonly safetyCarPitLaneTimeReduction: number | null;
  readonly vscPitLaneTimeReduction: number | null;
  /** These must be explicitly supplied before the full PitStopEngine can run. */
  readonly unresolvedKeys: readonly string[];
}

/**
 * Resolves only source-backed pit settings. It deliberately does not turn the
 * documented probability bounds into a guessed skill curve or invent delay jitter.
 */
export async function resolvePitStopConfig(
  database: IDatabase,
  input: { readonly tier: TierId; readonly pitLaneLengthMeters: number },
): Promise<PitStopConfigForTier> {
  if (!Number.isFinite(input.pitLaneLengthMeters) || input.pitLaneLengthMeters <= 0) {
    throw new RangeError("Panjang pit lane harus berupa angka positif dari data sirkuit.");
  }
  if (input.tier === 6) {
    return {
      tier: 6, pitAllowed: false, pitLaneLengthMeters: input.pitLaneLengthMeters,
      pitLaneSpeedMetersPerSecond: null, stationarySeconds: null, stationaryJitterRangeSeconds: null,
      fixedTotalLossSeconds: null, crewErrorProbabilityBounds: null, unsafeReleaseProbabilityBounds: null,
      safetyCarPitLaneTimeReduction: null, vscPitLaneTimeReduction: null, unresolvedKeys: [],
    };
  }
  if (input.tier === 5) {
    const fixed = await requireGameConfigNumber(database, "pit.fixed_total_loss_seconds", {
      scope: "tier", scopeId: "5",
    }, { minimum: 0.01 });
    return {
      tier: 5, pitAllowed: true, pitLaneLengthMeters: input.pitLaneLengthMeters,
      pitLaneSpeedMetersPerSecond: null, stationarySeconds: null, stationaryJitterRangeSeconds: null,
      fixedTotalLossSeconds: fixed.value, crewErrorProbabilityBounds: null, unsafeReleaseProbabilityBounds: null,
      safetyCarPitLaneTimeReduction: null, vscPitLaneTimeReduction: null, unresolvedKeys: [],
    };
  }

  const [speed, stationary, jitter, crewMin, crewMax, unsafeMin, unsafeMax, scReduction, vscReduction] = await Promise.all([
    requireGameConfigNumber(database, "pit.lane_speed_mps", {}, { minimum: 0.01 }),
    requireGameConfigNumber(database, "pit.stationary_mean_seconds", { scope: "tier", scopeId: String(input.tier) }, { minimum: 0 }),
    requireGameConfigNumber(database, "pit.stationary_jitter_seconds", { scope: "tier", scopeId: String(input.tier) }, { minimum: 0 }),
    requireGameConfigNumber(database, "pit.crew_error_probability_min", {}, { minimum: 0.02, maximum: 0.10 }),
    requireGameConfigNumber(database, "pit.crew_error_probability_max", {}, { minimum: 0.02, maximum: 0.10 }),
    requireGameConfigNumber(database, "pit.unsafe_release_probability_min", {}, { minimum: 0.01, maximum: 0.05 }),
    requireGameConfigNumber(database, "pit.unsafe_release_probability_max", {}, { minimum: 0.01, maximum: 0.05 }),
    requireGameConfigNumber(database, "neutralization.safety_car_pit_lane_time_reduction", {}, { minimum: 0, maximum: 1 }),
    requireGameConfigNumber(database, "neutralization.vsc_pit_lane_time_reduction", {}, { minimum: 0, maximum: 1 }),
  ]);
  if (crewMin.value > crewMax.value || unsafeMin.value > unsafeMax.value) {
    throw new Error("Batas probabilitas pit tidak valid: nilai minimum melebihi maksimum.");
  }
  const unresolvedKeys = [
    "pit.crew_error_probability_by_mechanic_skill",
    "pit.crew_error_jitter_range_seconds",
    "pit.unsafe_release_delay_seconds",
  ].filter((key) => key.length > 0);
  return {
    tier: input.tier, pitAllowed: true, pitLaneLengthMeters: input.pitLaneLengthMeters,
    pitLaneSpeedMetersPerSecond: speed.value, stationarySeconds: stationary.value,
    stationaryJitterRangeSeconds: jitter.value, fixedTotalLossSeconds: null,
    crewErrorProbabilityBounds: { minimum: crewMin.value, maximum: crewMax.value },
    unsafeReleaseProbabilityBounds: { minimum: unsafeMin.value, maximum: unsafeMax.value },
    safetyCarPitLaneTimeReduction: scReduction.value,
    vscPitLaneTimeReduction: vscReduction.value,
    unresolvedKeys,
  };
}
