import { hashSeed } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";
import type { TierId } from "./GameConfig";

export type NeutralizationType = "none" | "yellow-flag" | "safety-car" | "vsc";

export interface NeutralizationResult {
  readonly type: NeutralizationType;
  readonly triggerLap: number | null;
  readonly paceMultiplier: number;
  readonly gapCompressionSeconds: number;
  /** Fraction of pit-lane time removed while the neutralization is active. */
  readonly pitLaneTimeReduction: number;
  readonly restartType: "none" | "rolling";
}

export function selectNeutralization(input: {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly totalLaps: number;
  readonly tier: TierId;
  readonly safetyCarProbability: number;
  /** Supplied by game_config; the design document does not hardcode this probability. */
  readonly vscProbability: number;
  readonly forcedByIncident?: boolean;
}): NeutralizationResult {
  if (![input.season, input.round, input.totalLaps].every(Number.isSafeInteger) ||
      input.season < 1 || input.round < 1 || input.totalLaps < 8) {
    throw new RangeError("Season, round, dan total lap tidak valid.");
  }
  for (const [name, value] of [
    ["safetyCarProbability", input.safetyCarProbability],
    ["vscProbability", input.vscProbability],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} harus berada pada rentang 0–1.`);
  }

  const random = new SeededRandom(hashSeed([input.worldSeed, input.season, input.round, "neutralization"]));
  const triggered = input.forcedByIncident === true || random.next() < input.safetyCarProbability;
  if (!triggered) {
    return { type: "none", triggerLap: null, paceMultiplier: 1, gapCompressionSeconds: 0, pitLaneTimeReduction: 0, restartType: "none" };
  }

  const firstEligibleLap = 3;
  const lastEligibleLap = input.totalLaps - 3;
  const triggerLap = firstEligibleLap + Math.floor(random.next() * (lastEligibleLap - firstEligibleLap + 1));
  if (input.tier >= 5) {
    return { type: "yellow-flag", triggerLap, paceMultiplier: 1, gapCompressionSeconds: 0, pitLaneTimeReduction: 0, restartType: "none" };
  }

  if (random.next() < input.vscProbability) {
    return { type: "vsc", triggerLap, paceMultiplier: 1.35, gapCompressionSeconds: 0, pitLaneTimeReduction: 0.35, restartType: "rolling" };
  }
  return { type: "safety-car", triggerLap, paceMultiplier: 1.4, gapCompressionSeconds: 1, pitLaneTimeReduction: 0.4, restartType: "rolling" };
}
