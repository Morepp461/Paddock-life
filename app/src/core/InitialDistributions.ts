import { SeededRandom } from "./SeededRandom";
import type { TierId } from "./GameConfig";

export type LetterGrade = "A" | "B" | "C" | "D";
export type Difficulty = "easy" | "normal" | "hard";

export interface InitialTierDistribution {
  readonly driverOverallMean: number;
  readonly driverOverallSd: number;
  readonly carReference: number;
  readonly staffSkillMean: number;
  readonly reliabilityMean: number;
  readonly fanPopularityMean: number;
  readonly driverAgeMean: number;
  readonly driverAgeSd: number;
  readonly minDriverAge: number;
  readonly maxDriverAge: number;
  readonly requiredBudget: number;
  readonly facilityLevelByFinance: Readonly<Record<LetterGrade, number>>;
  readonly staffSlots: number;
  readonly academySlots: number;
  readonly reputationRange: readonly [number, number];
}

export const INITIAL_DISTRIBUTIONS: Readonly<Record<TierId, InitialTierDistribution>> = {
  1: { driverOverallMean: 76, driverOverallSd: 6, carReference: 74, staffSkillMean: 72, reliabilityMean: 75, fanPopularityMean: 58, driverAgeMean: 27, driverAgeSd: 6, minDriverAge: 18, maxDriverAge: 45, requiredBudget: 248_000_000, facilityLevelByFinance: { A: 8, B: 7, C: 6, D: 5 }, staffSlots: 11, academySlots: 2, reputationRange: [6500, 9999] },
  2: { driverOverallMean: 68, driverOverallSd: 6.5, carReference: 66, staffSkillMean: 64, reliabilityMean: 72, fanPopularityMean: 50, driverAgeMean: 20.5, driverAgeSd: 2.5, minDriverAge: 17, maxDriverAge: 25, requiredBudget: 98_000_000, facilityLevelByFinance: { A: 7, B: 6, C: 5, D: 4 }, staffSlots: 11, academySlots: 2, reputationRange: [5000, 8000] },
  3: { driverOverallMean: 60, driverOverallSd: 7, carReference: 58, staffSkillMean: 56, reliabilityMean: 68, fanPopularityMean: 42, driverAgeMean: 17.3, driverAgeSd: 1, minDriverAge: 16, maxDriverAge: 19, requiredBudget: 38_000_000, facilityLevelByFinance: { A: 6, B: 5, C: 4, D: 3 }, staffSlots: 9, academySlots: 2, reputationRange: [3000, 6000] },
  4: { driverOverallMean: 52, driverOverallSd: 7, carReference: 50, staffSkillMean: 48, reliabilityMean: 62, fanPopularityMean: 35, driverAgeMean: 16.3, driverAgeSd: 1, minDriverAge: 15, maxDriverAge: 18, requiredBudget: 15_000_000, facilityLevelByFinance: { A: 5, B: 4, C: 3, D: 2 }, staffSlots: 7, academySlots: 1, reputationRange: [1500, 4000] },
  5: { driverOverallMean: 40, driverOverallSd: 7, carReference: 38, staffSkillMean: 38, reliabilityMean: 62, fanPopularityMean: 25, driverAgeMean: 12, driverAgeSd: 1.2, minDriverAge: 10, maxDriverAge: 14, requiredBudget: 6_000_000, facilityLevelByFinance: { A: 4, B: 3, C: 2, D: 1 }, staffSlots: 5, academySlots: 1, reputationRange: [500, 2500] },
  6: { driverOverallMean: 32, driverOverallSd: 7, carReference: 30, staffSkillMean: 30, reliabilityMean: 60, fanPopularityMean: 20, driverAgeMean: 9.5, driverAgeSd: 1, minDriverAge: 8, maxDriverAge: 11, requiredBudget: 3_000_000, facilityLevelByFinance: { A: 3, B: 2, C: 1, D: 1 }, staffSlots: 3, academySlots: 0, reputationRange: [300, 1500] },
};

export const PERFORMANCE_GRADE_OFFSETS: Readonly<Record<LetterGrade, { car: number; technicalStaff: number; reliability: number }>> = {
  A: { car: 5, technicalStaff: 5, reliability: 5 },
  B: { car: 2, technicalStaff: 2, reliability: 2 },
  C: { car: -2, technicalStaff: -2, reliability: -2 },
  D: { car: -5, technicalStaff: -5, reliability: -5 },
};

export const FINANCE_GRADE_MULTIPLIERS: Readonly<Record<LetterGrade, number>> = {
  A: 1.4,
  B: 1.0,
  C: 0.7,
  D: 0.45,
};

export const DIFFICULTY_MULTIPLIERS: Readonly<Record<Difficulty, {
  initialCash: number;
  sponsorOffers: number;
  boardAmbition: number;
  aiDevelopment: number;
  transferCost: number;
  initialBoardConfidenceOffset: number;
}>> = {
  easy: { initialCash: 1.3, sponsorOffers: 1.1, boardAmbition: 0.1, aiDevelopment: 0.85, transferCost: 0.9, initialBoardConfidenceOffset: 10 },
  normal: { initialCash: 1, sponsorOffers: 1, boardAmbition: 0.15, aiDevelopment: 1, transferCost: 1, initialBoardConfidenceOffset: 0 },
  hard: { initialCash: 0.75, sponsorOffers: 0.9, boardAmbition: 0.25, aiDevelopment: 1.15, transferCost: 1.1, initialBoardConfidenceOffset: -10 },
};

export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || minimum > maximum) throw new RangeError("Batas clamp atau nilai tidak valid.");
  return Math.min(maximum, Math.max(minimum, value));
}

export function sampleNormal(random: SeededRandom, mean: number, standardDeviation: number): number {
  if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
    throw new RangeError("Parameter distribusi normal tidak valid.");
  }
  if (standardDeviation === 0) return mean;
  const u1 = Math.max(random.next(), Number.EPSILON);
  const u2 = random.next();
  const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + standardNormal * standardDeviation;
}

export function sampleBoundedNormal(
  random: SeededRandom,
  mean: number,
  standardDeviation: number,
  minimum: number,
  maximum: number,
): number {
  if (minimum > maximum) throw new RangeError("Rentang nilai tidak valid.");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sample = sampleNormal(random, mean, standardDeviation);
    if (sample >= minimum && sample <= maximum) return sample;
  }
  return clamp(mean, minimum, maximum);
}

export function calculateInitialCash(
  tier: TierId,
  financeGrade: LetterGrade,
  difficulty: Difficulty,
  jitter: number,
): number {
  if (!Number.isFinite(jitter) || jitter < -0.15 || jitter > 0.15) {
    throw new RangeError("Variasi kas harus berada di antara -15% dan +15%.");
  }
  const config = INITIAL_DISTRIBUTIONS[tier];
  return Math.round(config.requiredBudget * FINANCE_GRADE_MULTIPLIERS[financeGrade] *
    (1 + jitter) * DIFFICULTY_MULTIPLIERS[difficulty].initialCash);
}

export function generateDriverInitialProfile(random: SeededRandom, tier: TierId) {
  const config = INITIAL_DISTRIBUTIONS[tier];
  const age = Math.round(sampleBoundedNormal(random, config.driverAgeMean, config.driverAgeSd, config.minDriverAge, config.maxDriverAge));
  const overall = Math.round(clamp(sampleNormal(random, config.driverOverallMean, config.driverOverallSd), 15, 97));
  const potentialRoom = age <= 13 ? [20, 40] : age <= 17 ? [12, 28] : age <= 23 ? [6, 16] : age <= 29 ? [2, 8] : [0, 3];
  const potential = Math.round(clamp(overall + potentialRoom[0] + random.next() * (potentialRoom[1] - potentialRoom[0]), overall, 99));
  const sharedRacecraftFactor = sampleNormal(random, 0, 7 * Math.sqrt(0.6));
  const pace = Math.round(clamp(overall + sharedRacecraftFactor + sampleNormal(random, 0, 7 * Math.sqrt(0.4)), 5, 99));
  const qualifying = Math.round(clamp(overall + sharedRacecraftFactor + sampleNormal(random, 0, 7 * Math.sqrt(0.4)), 5, 99));
  const racecraft = Math.round(clamp(overall + sharedRacecraftFactor + sampleNormal(random, 0, 7 * Math.sqrt(0.4)), 5, 99));
  return {
    age, overall, potential,
    pace, qualifying, racecraft,
    consistency: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    wetSkill: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    tyreManagement: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    overtaking: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    defending: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    starts: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    adaptability: Math.round(clamp(sampleNormal(random, overall, 7), 5, 99)),
    focus: Math.round(clamp(sampleNormal(random, overall, 8), 20, 95)),
    pressure: Math.round(clamp(sampleNormal(random, overall, 8), 20, 95)),
    fanPopularity: Math.round(clamp(sampleNormal(random, config.fanPopularityMean, 15), 0, 100)),
    developmentRate: clamp(sampleNormal(random, 1, 0.18), 0.6, 1.4),
    injuryResistance: Math.round(30 + random.next() * 60),
    loyalty: Math.round(clamp(sampleNormal(random, 60, 15), 20, 95)),
    ambition: Math.round(clamp(sampleNormal(random, 65, 15), 30, 95)),
    morale: Math.round(clamp(sampleNormal(random, 60, 8), 0, 100)),
    confidence: Math.round(clamp(sampleNormal(random, 55, 8), 0, 100)),
    aggression: Math.round(clamp(sampleNormal(random, 55, 15), 20, 90)),
  };
}
