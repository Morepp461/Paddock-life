import { TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";

export type ReliabilityComponent = "engine" | "gearbox" | "brake" | "suspension" | "electronics";

export const BASE_FAILURE_RATE: Readonly<Record<ReliabilityComponent, number>> = {
  engine: 0.1,
  gearbox: 0.07,
  brake: 0.05,
  suspension: 0.05,
  electronics: 0.07,
};

export interface ComponentReliability {
  readonly component: ReliabilityComponent;
  readonly reliability: number;
  readonly racesSinceReset: number;
}

export interface ComponentFailureRisk {
  readonly component: ReliabilityComponent;
  readonly probability: number;
  readonly stressFactor: number;
  readonly ageFactor: number;
}

export interface ReliabilityRaceResult {
  readonly componentInstanceId: string;
  readonly risks: readonly ComponentFailureRisk[];
  readonly failedComponents: readonly ReliabilityComponent[];
}

export function calculateStressFactor(averageAggression: number, trackAbrasion: number): number {
  if (!Number.isFinite(averageAggression) || averageAggression < 0 || averageAggression > 100 ||
      !Number.isFinite(trackAbrasion) || trackAbrasion < 0 || trackAbrasion > 100) {
    throw new RangeError("Aggression rata-rata dan abrasion harus berada pada rentang 0–100.");
  }
  return 1 + 0.4 * averageAggression / 100 + 0.3 * trackAbrasion / 100;
}

export function calculateComponentFailureRisk(input: {
  readonly component: ReliabilityComponent;
  readonly reliability: number;
  readonly racesSinceReset: number;
  readonly averageAggression: number;
  readonly trackAbrasion: number;
  readonly tier: TierId;
}): ComponentFailureRisk {
  if (!Number.isFinite(input.reliability) || input.reliability < 0 || input.reliability > 100) {
    throw new RangeError("Reliability harus berada pada rentang 0–100.");
  }
  if (!Number.isSafeInteger(input.racesSinceReset) || input.racesSinceReset < 0) {
    throw new RangeError("Jumlah race sejak reset harus integer non-negatif.");
  }
  const stressFactor = calculateStressFactor(input.averageAggression, input.trackAbrasion);
  const ageFactor = Math.min(1.5, 1 + 0.05 * input.racesSinceReset);
  const probability = BASE_FAILURE_RATE[input.component] * (100 - input.reliability) / 100
    * stressFactor * ageFactor * TIER_CONFIG[input.tier].reliabilityMultiplier;
  return { component: input.component, probability, stressFactor, ageFactor };
}

/** Samples each component independently with stable, component-specific seeded RNG. */
export function simulateReliabilityForRace(input: {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly componentInstanceId: string;
  readonly tier: TierId;
  readonly averageAggression: number;
  readonly trackAbrasion: number;
  readonly components: readonly ComponentReliability[];
}): ReliabilityRaceResult {
  if (!input.componentInstanceId.trim()) throw new Error("Component instance ID wajib diisi.");
  if (![input.season, input.round].every((value) => Number.isSafeInteger(value) && value >= 1)) {
    throw new RangeError("Season dan round harus integer positif.");
  }
  const componentNames = new Set<ReliabilityComponent>();
  const risks = input.components.map((component) => {
    if (componentNames.has(component.component)) throw new Error(`Komponen duplikat: ${component.component}.`);
    componentNames.add(component.component);
    return calculateComponentFailureRisk({
      ...component,
      averageAggression: input.averageAggression,
      trackAbrasion: input.trackAbrasion,
      tier: input.tier,
    });
  });
  const failedComponents = risks.filter((risk) => {
    const random = new SeededRandom(hashSeed([
      input.worldSeed, input.season, input.round, input.componentInstanceId, risk.component, "reliability",
    ]));
    return random.next() < risk.probability;
  }).map((risk) => risk.component);
  return { componentInstanceId: input.componentInstanceId, risks, failedComponents };
}
