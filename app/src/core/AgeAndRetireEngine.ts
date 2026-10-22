import { hashSeed } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";
import { TIER_CONFIG, type TierId } from "./GameConfig";

export type AgingEntityKind = "driver" | "staff" | "ai-manager" | "player-manager";
export type RetirementReason = "age" | null;

export interface AgeAndRetireInput {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly entityId: string;
  readonly kind: AgingEntityKind;
  readonly age: number;
  readonly tier?: TierId;
}
export interface AgeAndRetireResult {
  readonly entityId: string;
  readonly kind: AgingEntityKind;
  readonly previousAge: number;
  readonly ageAfter: number;
  readonly retirementProbability: number;
  readonly shouldRetire: boolean;
  readonly retirementReason: RetirementReason;
  readonly eligibleForHigherTierMove: boolean;
  readonly outsideCurrentTierAgeBand: boolean;
  readonly becomesStaff: boolean;
}

/** Source: Career Rules §5 and PRD age bands. All random outcomes are save-seeded. */
export function evaluateAgeAndRetirement(input: AgeAndRetireInput): AgeAndRetireResult {
  if (!input.entityId.trim()) throw new Error("Entity ID wajib diisi.");
  if (!Number.isSafeInteger(input.season) || input.season < 1) throw new RangeError("Season harus integer positif.");
  if (!Number.isSafeInteger(input.age) || input.age < 0) throw new RangeError("Umur harus integer non-negatif.");
  if (input.kind === "driver" && input.tier === undefined) throw new Error("Tier wajib untuk evaluasi umur driver.");

  const ageAfter = input.kind === "driver" ? input.age + 1 : Math.min(81, input.age + 1);
  let retirementProbability = 0;
  let mandatoryRetirement = false;
  if (input.kind === "driver") {
    retirementProbability = ageAfter >= 35 ? Math.min(1, 0.05 * (ageAfter - 34)) : 0;
    mandatoryRetirement = ageAfter > 45;
  } else if (input.kind === "staff" || input.kind === "ai-manager") {
    retirementProbability = ageAfter >= 65 ? Math.min(1, 0.06 * (ageAfter - 64)) : 0;
    mandatoryRetirement = ageAfter >= 81;
  }

  const random = new SeededRandom(hashSeed([input.worldSeed, input.season, input.entityId, "retirement"]));
  const shouldRetire = input.kind !== "player-manager"
    && (mandatoryRetirement || random.next() < retirementProbability);
  const becomesStaff = shouldRetire && input.kind === "driver"
    && new SeededRandom(hashSeed([input.worldSeed, input.season, input.entityId, "retirement-to-staff"])).next() < 0.4;

  let outsideCurrentTierAgeBand = false;
  if (input.kind === "driver" && input.tier !== undefined) {
    outsideCurrentTierAgeBand = ageAfter < TIER_CONFIG[input.tier].driverAge.min
      || ageAfter > TIER_CONFIG[input.tier].driverAge.max;
  }

  return {
    entityId: input.entityId,
    kind: input.kind,
    previousAge: input.age,
    ageAfter,
    retirementProbability,
    shouldRetire,
    retirementReason: shouldRetire ? "age" : null,
    eligibleForHigherTierMove: input.kind === "driver" && outsideCurrentTierAgeBand && !shouldRetire,
    outsideCurrentTierAgeBand,
    becomesStaff,
  };
}
