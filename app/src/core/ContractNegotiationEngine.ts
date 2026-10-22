import { SeededRandom } from "./SeededRandom";
import { hashSeed } from "./RandomDistributions";

export const DRIVER_SALARY_RATE = 0.12;
export const MINIMUM_DEMAND_FACTOR = 0.85;
export const MAXIMUM_DEMAND_FACTOR = 1.3;
export const CONTRACT_MIN_DURATION_SEASONS = 1;
export const CONTRACT_MAX_DURATION_SEASONS = 4;
export const UNDERAGE_CONTRACT_MAX_DURATION_SEASONS = 2;

export interface ContractAcceptanceTerms {
  readonly offeredSalary: number;
  readonly askingSalary: number;
  /** 1.0 for a guaranteed lead seat, 0.7 for a second-driver seat. */
  readonly roleScore: number;
  readonly prestigeScore: number;
  readonly titleChanceScore: number;
  readonly lengthScore: number;
  readonly loyaltyAmbitionScore: number;
  readonly bonusScore: number;
  /** 0.05 per adverse clause, capped at 0.15. */
  readonly clausePenalty: number;
}
export type ContractOfferDecision = "accepted" | "counter-offer" | "rejected";

export interface ContractOfferEvaluation {
  readonly score: number;
  readonly decision: ContractOfferDecision;
  readonly salaryScore: number;
}

function boundedScore(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1.2) {
    throw new RangeError(name + " harus berada pada rentang 0–1.2.");
  }
  return value;
}

/** Document 08, Section 1.2. Demand factor must come from seeded generation/configuration. */
export function calculateDriverAskingSalary(input: {
  readonly marketValue: number;
  readonly ambition: number;
  readonly demandFactor: number;
}): number {
  if (!Number.isFinite(input.marketValue) || input.marketValue < 0) throw new RangeError("Market value tidak valid.");
  if (!Number.isFinite(input.ambition) || input.ambition < 0 || input.ambition > 100) throw new RangeError("Ambition harus 0–100.");
  if (!Number.isFinite(input.demandFactor) || input.demandFactor < MINIMUM_DEMAND_FACTOR || input.demandFactor > MAXIMUM_DEMAND_FACTOR) {
    throw new RangeError("Demand factor harus berada pada rentang 0.85–1.30.");
  }
  return Math.round(input.marketValue * DRIVER_SALARY_RATE * input.demandFactor
    * (1 + 0.1 * (input.ambition - 50) / 50));
}

/** Stable demand-factor roll keyed by world seed, season and driver. */
export function generateDriverDemandFactor(input: {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly driverId: string;
}): number {
  if (!Number.isSafeInteger(input.season) || input.season < 1 || !input.driverId.trim()) {
    throw new RangeError("Season dan driver ID harus valid.");
  }
  const random = new SeededRandom(hashSeed([input.worldSeed, "contract-demand", input.season, input.driverId]));
  return MINIMUM_DEMAND_FACTOR + random.next() * (MAXIMUM_DEMAND_FACTOR - MINIMUM_DEMAND_FACTOR);
}

/** Document 08, Section 1.3. Every weighted term is supplied by the contract evaluation context. */
export function evaluateContractOffer(input: ContractAcceptanceTerms): ContractOfferEvaluation {
  if (!Number.isFinite(input.offeredSalary) || input.offeredSalary < 0 ||
      !Number.isFinite(input.askingSalary) || input.askingSalary <= 0) {
    throw new RangeError("Gaji penawaran dan asking salary harus valid.");
  }
  const roleScore = boundedScore("Role", input.roleScore);
  const prestigeScore = boundedScore("Prestige", input.prestigeScore);
  const titleChanceScore = boundedScore("TitleChance", input.titleChanceScore);
  const lengthScore = boundedScore("Length", input.lengthScore);
  const loyaltyAmbitionScore = boundedScore("Loyalty/Ambition", input.loyaltyAmbitionScore);
  const bonusScore = boundedScore("Bonus", input.bonusScore);
  if (!Number.isFinite(input.clausePenalty) || input.clausePenalty < 0 || input.clausePenalty > 0.15) {
    throw new RangeError("Clause penalty harus berada pada rentang 0–0.15.");
  }
  const salaryScore = Math.min(1.2, input.offeredSalary / input.askingSalary);
  const score = 0.35 * salaryScore + 0.15 * roleScore + 0.15 * prestigeScore
    + 0.10 * titleChanceScore + 0.10 * lengthScore + 0.10 * loyaltyAmbitionScore
    + 0.05 * bonusScore - input.clausePenalty;
  const decision: ContractOfferDecision = score >= 0.85 ? "accepted" : score >= 0.70 ? "counter-offer" : "rejected";
  return { score, decision, salaryScore };
}

/** Documents allow 1–4 seasons, capped at two seasons for drivers younger than 18. */
export function validateContractDuration(durationSeasons: number, driverAge: number): void {
  if (!Number.isSafeInteger(driverAge) || driverAge < 0) throw new RangeError("Umur driver tidak valid.");
  const maxDuration = driverAge < 18 ? UNDERAGE_CONTRACT_MAX_DURATION_SEASONS : CONTRACT_MAX_DURATION_SEASONS;
  if (!Number.isSafeInteger(durationSeasons) || durationSeasons < CONTRACT_MIN_DURATION_SEASONS || durationSeasons > maxDuration) {
    throw new RangeError("Durasi kontrak harus 1–" + maxDuration + " season untuk driver ini.");
  }
}

/** Counter-offers are bounded to the documented 5–25% salary increase. */
export function findSalaryCounterOffer(input: ContractAcceptanceTerms): {
  readonly offeredSalary: number;
  readonly evaluation: ContractOfferEvaluation;
} | null {
  for (const increase of [0.05, 0.10, 0.15, 0.20, 0.25]) {
    const offeredSalary = Math.round(input.offeredSalary * (1 + increase));
    const evaluation = evaluateContractOffer({ ...input, offeredSalary });
    if (evaluation.score >= 0.85) return { offeredSalary, evaluation };
  }
  return null;
}
