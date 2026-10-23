import { SeededRandom } from "./SeededRandom";
import { hashSeed } from "./RandomDistributions";
import type { TierId } from "./GameConfig";

export type DefensiveMode = "normal" | "defend" | "all-out-defend";

export interface OvertakingInput {
  readonly attackerRacecraft: number;
  /** Positive values mean the attacker is faster per lap. */
  readonly attackerPaceAdvantageSeconds: number;
  /** Tyre wear percentages, where lower wear means the fresher tyre. */
  readonly attackerTyreWearPercent: number;
  readonly defenderTyreWearPercent: number;
  readonly gapSeconds: number;
  readonly drsZoneActive: boolean;
  readonly tier: TierId;
  readonly trackOvertakingDifficulty: number;
  readonly defenderSkill: number;
  readonly defensiveMode: DefensiveMode;
}

export interface OvertakingResult {
  readonly attempted: boolean;
  readonly probability: number;
  readonly score: number | null;
  readonly reason: "pace-not-faster" | "gap-too-large" | null;
  readonly drsBonus: number;
  readonly tyreAdvantage: number;
}

/** Source: 02_Simulation_Rules_Addendum_v1, section 9. */
export function evaluateOvertaking(input: OvertakingInput): OvertakingResult {
  const scores: readonly [string, number][] = [
    ["AttackerRacecraft", input.attackerRacecraft],
    ["AttackerTyreWearPercent", input.attackerTyreWearPercent],
    ["DefenderTyreWearPercent", input.defenderTyreWearPercent],
    ["DefenderSkill", input.defenderSkill],
  ];
  for (const [name, value] of scores) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new RangeError(name + " harus berada pada rentang 0–100.");
    }
  }
  if (!Number.isFinite(input.attackerPaceAdvantageSeconds)) {
    throw new RangeError("Pace advantage harus berupa angka finite.");
  }
  if (!Number.isFinite(input.gapSeconds) || input.gapSeconds < 0) {
    throw new RangeError("Gap harus berupa angka non-negatif.");
  }
  if (!Number.isSafeInteger(input.trackOvertakingDifficulty) ||
      input.trackOvertakingDifficulty < 1 || input.trackOvertakingDifficulty > 10) {
    throw new RangeError("Overtaking difficulty harus integer 1–10.");
  }

  const drsActive = input.drsZoneActive && input.tier <= 3;
  const drsBonus = drsActive ? 8 : 0;
  const tyreAdvantage = (input.defenderTyreWearPercent - input.attackerTyreWearPercent) / 2;
  const threshold = drsActive ? 1.0 : 0.8;
  if (input.attackerPaceAdvantageSeconds <= 0) {
    return { attempted: false, probability: 0, score: null, reason: "pace-not-faster", drsBonus, tyreAdvantage };
  }
  if (input.gapSeconds >= threshold) {
    return { attempted: false, probability: 0, score: null, reason: "gap-too-large", drsBonus, tyreAdvantage };
  }

  const defensivePenalty: Readonly<Record<DefensiveMode, number>> = {
    normal: 0,
    defend: 6,
    "all-out-defend": 12,
  };
  const trackFactor = (10 - input.trackOvertakingDifficulty) * 3;
  const score = input.attackerRacecraft
    + input.attackerPaceAdvantageSeconds * 10
    + tyreAdvantage
    + drsBonus
    + trackFactor
    - input.defenderSkill
    - defensivePenalty[input.defensiveMode];
  const probability = 1 / (1 + Math.exp(-score / 12));
  return { attempted: true, probability, score, reason: null, drsBonus, tyreAdvantage };
}

/** Seeded result so the same race/driver pairing always resolves identically. */
export function resolveOvertaking(input: {
  readonly seed: string | number;
  readonly season: number;
  readonly round: number;
  readonly lap: number;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly overtake: OvertakingInput;
}): OvertakingResult & { readonly successful: boolean } {
  for (const [name, value] of [["season", input.season], ["round", input.round], ["lap", input.lap]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + " harus integer positif.");
  }
  if (!input.attackerId.trim() || !input.defenderId.trim() || input.attackerId === input.defenderId) {
    throw new Error("Overtake membutuhkan dua driver berbeda dengan ID valid.");
  }
  const result = evaluateOvertaking(input.overtake);
  const rng = new SeededRandom(hashSeed([input.seed, input.season, input.round, input.lap, "overtake", input.attackerId, input.defenderId]));
  return { ...result, successful: result.attempted && rng.next() < result.probability };
}
