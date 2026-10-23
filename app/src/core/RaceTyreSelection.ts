import { TIER_CONFIG, type TierId } from "./GameConfig";
import { getCompoundPaceResult, type TrackCondition, type TyreCompound } from "./TyreEngine";

const TRACK_CONDITIONS: readonly TrackCondition[] = ["dry", "damp", "wet", "heavy-wet"];

export function parseTrackCondition(value: unknown): TrackCondition {
  const condition = String(value ?? "dry");
  if (!TRACK_CONDITIONS.includes(condition as TrackCondition)) {
    throw new Error("Kondisi lintasan tidak dikenal: " + condition);
  }
  return condition as TrackCondition;
}

/** Lists compounds allowed by the tier and physically usable in the scheduled condition. */
export function availableTyreCompounds(tier: TierId, condition: TrackCondition): TyreCompound[] {
  const config = TIER_CONFIG[tier];
  return [...config.allowedDryCompounds, ...config.allowedWetCompounds]
    .filter((compound) => getCompoundPaceResult({ compound, trackCondition: condition }).usable);
}

/** Source-aligned baseline choice for AI teams when the race starts wet. */
export function recommendedTyreCompound(tier: TierId, condition: TrackCondition): TyreCompound {
  const config = TIER_CONFIG[tier];
  if (condition === "dry") return config.allowedDryCompounds[0]!;
  if (condition === "heavy-wet") {
    return config.allowedWetCompounds.find((compound) => compound === "wet")
      ?? config.allowedWetCompounds[0] ?? config.allowedDryCompounds[0]!;
  }
  return config.allowedWetCompounds.find((compound) => compound === "intermediate")
    ?? config.allowedWetCompounds[0] ?? config.allowedDryCompounds[0]!;
}
