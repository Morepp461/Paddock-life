import type { TierId } from "./GameConfig";

export type BoardDifficulty = "easy" | "normal" | "hard";
export interface BoardSeasonInput {
  readonly tier: Exclude<TierId, 6>;
  readonly difficulty: BoardDifficulty;
  readonly expectedRank: number;
  readonly constructorPosition: number;
  readonly closingCash: number;
  readonly requiredBudget: number;
  readonly currentConfidence: number;
  readonly currentManagerReputation: number;
  readonly previousPrimaryMisses: number;
  readonly season: number;
  readonly isSandbox: boolean;
  readonly higherDivisionUnlocked: boolean;
}
export interface BoardSeasonResult {
  readonly primaryTargetRank: number;
  readonly primaryAchieved: boolean;
  readonly financialAchieved: boolean;
  readonly unlockDivisionObjective: boolean;
  readonly unlockDivisionAchieved: boolean | null;
  readonly confidenceDelta: number;
  readonly confidenceAfter: number;
  readonly objectiveScore: number;
  readonly titleBonus: number;
  readonly managerReputationDelta: number;
  readonly managerReputationAfter: number;
  readonly consecutivePrimaryMisses: number;
  readonly managerFired: boolean;
  readonly firingReason: "low-confidence" | "consecutive-primary-misses" | null;
}

const AMBITION: Readonly<Record<BoardDifficulty, number>> = { easy: 0.10, normal: 0.15, hard: 0.25 };
const TIER_WEIGHT: Readonly<Record<Exclude<TierId, 6>, number>> = { 1: 6, 2: 4, 3: 2.5, 4: 1.5, 5: 1 };

function boundedInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Source: 08_Career_Rules_v1 sections 6 and 7. Pure and deterministic. */
export function evaluateBoardSeason(input: BoardSeasonInput): BoardSeasonResult {
  if (!Number.isSafeInteger(input.season) || input.season < 1) throw new RangeError("Season harus integer positif.");
  if (!Number.isFinite(input.expectedRank) || input.expectedRank < 1 || input.expectedRank > 12) {
    throw new RangeError("Expected rank harus berada pada rentang 1–12.");
  }
  if (!Number.isSafeInteger(input.constructorPosition) || input.constructorPosition < 1 || input.constructorPosition > 12) {
    throw new RangeError("Peringkat konstruktor harus integer 1–12.");
  }
  if (!Number.isFinite(input.requiredBudget) || input.requiredBudget <= 0 || !Number.isFinite(input.closingCash)) {
    throw new RangeError("Budget dan kas akhir harus valid.");
  }
  if (!Number.isFinite(input.currentConfidence) || input.currentConfidence < 0 || input.currentConfidence > 100) {
    throw new RangeError("Board confidence harus berada pada rentang 0–100.");
  }
  if (!Number.isFinite(input.currentManagerReputation) || input.currentManagerReputation < 0) {
    throw new RangeError("Reputasi manager tidak valid.");
  }
  if (!Number.isSafeInteger(input.previousPrimaryMisses) || input.previousPrimaryMisses < 0) {
    throw new RangeError("Jumlah kegagalan primary sebelumnya tidak valid.");
  }

  const primaryTargetRank = boundedInteger(input.expectedRank * (1 - AMBITION[input.difficulty]), 1, 12);
  const primaryAchieved = input.constructorPosition <= primaryTargetRank;
  const financialAchieved = input.closingCash >= 0.5 * input.requiredBudget;
  const unlockDivisionObjective = input.tier > 1 && input.expectedRank <= 3 && !input.higherDivisionUnlocked;
  const unlockDivisionAchieved = unlockDivisionObjective ? input.constructorPosition === 1 : null;

  let confidenceDelta = primaryAchieved ? 15 : -20;
  confidenceDelta += financialAchieved ? 5 : -5;
  if (unlockDivisionAchieved === true) confidenceDelta += 10;
  if (input.closingCash < -0.25 * input.requiredBudget) confidenceDelta -= 10;
  const confidenceAfter = Math.max(0, Math.min(100, input.currentConfidence + confidenceDelta));

  const allObjectivesAchieved = primaryAchieved && financialAchieved && (unlockDivisionAchieved !== false);
  const objectiveScore = allObjectivesAchieved ? 60 : primaryAchieved ? 30 : -40;
  const titleBonus = input.constructorPosition === 1 ? 150 : input.constructorPosition <= 3 ? 50 : 0;
  const managerReputationDelta = TIER_WEIGHT[input.tier] * (objectiveScore + titleBonus);
  const managerReputationAfter = Math.max(0, Math.min(9999, Math.round(input.currentManagerReputation + managerReputationDelta)));
  const consecutivePrimaryMisses = primaryAchieved ? 0 : input.previousPrimaryMisses + 1;
  const beyondOverdraft = input.closingCash < -0.25 * input.requiredBudget;
  const firedForConfidence = confidenceAfter < 35;
  const firedForMisses = consecutivePrimaryMisses >= 2;
  const protectedFirstSeason = input.season === 1 && !beyondOverdraft;
  const managerFired = !input.isSandbox && !protectedFirstSeason && (firedForConfidence || firedForMisses);
  const firingReason = !managerFired ? null
    : firedForConfidence ? "low-confidence"
    : "consecutive-primary-misses";

  return {
    primaryTargetRank, primaryAchieved, financialAchieved,
    unlockDivisionObjective, unlockDivisionAchieved,
    confidenceDelta, confidenceAfter, objectiveScore, titleBonus,
    managerReputationDelta, managerReputationAfter, consecutivePrimaryMisses,
    managerFired, firingReason,
  };
}
