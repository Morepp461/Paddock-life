import type { TierId } from "./GameConfig";
import { SeededRandom } from "./SeededRandom";

export type SponsorTier = 1 | 2 | 3 | 4 | 5;
export type SponsorFocus = "points" | "podium" | "win" | "finish" | "popularity";

export interface SponsorTargetThresholds {
  readonly points: number;
  readonly podium: number;
  readonly win: number;
  readonly finish: number;
  readonly popularity: number;
}

export interface SponsorPerformance {
  readonly roundsWithPointsFinish: number;
  readonly roundsWithPodium: number;
  readonly roundsWon: number;
  readonly carStarts: number;
  readonly carFinishes: number;
  readonly leadDriverPopularity: number;
}

export interface SponsorTargetResult {
  readonly focus: SponsorFocus;
  readonly required: number;
  readonly actual: number;
  readonly achieved: boolean;
}

export const SPONSOR_TARGETS: Readonly<Record<SponsorTier, SponsorTargetThresholds>> = {
  1: { points: 0.80, podium: 0.40, win: 0.25, finish: 0.92, popularity: 75 },
  2: { points: 0.70, podium: 0.30, win: 0.15, finish: 0.90, popularity: 65 },
  3: { points: 0.60, podium: 0.20, win: 0.10, finish: 0.88, popularity: 55 },
  4: { points: 0.50, podium: 0.15, win: 0.05, finish: 0.85, popularity: 45 },
  5: { points: 0.40, podium: 0.10, win: 0.05, finish: 0.80, popularity: 35 },
};

/** Probabilities of an offered sponsor tier by division tier, from Pool_Sponsor_v1. */
export const SPONSOR_OFFER_WEIGHTS: Readonly<Record<TierId, readonly { tier: SponsorTier; weight: number }[]>> = {
  1: [{ tier: 3, weight: 0.10 }, { tier: 2, weight: 0.40 }, { tier: 1, weight: 0.50 }],
  2: [{ tier: 3, weight: 0.25 }, { tier: 2, weight: 0.50 }, { tier: 1, weight: 0.25 }],
  3: [{ tier: 4, weight: 0.25 }, { tier: 3, weight: 0.50 }, { tier: 2, weight: 0.25 }],
  4: [{ tier: 5, weight: 0.20 }, { tier: 4, weight: 0.50 }, { tier: 3, weight: 0.30 }],
  5: [{ tier: 5, weight: 0.70 }, { tier: 4, weight: 0.30 }],
  6: [],
};

export const SPONSOR_MINIMUM_REPUTATION: Readonly<Record<SponsorTier, number>> = {
  1: 7000,
  2: 4500,
  3: 2500,
  4: 1000,
  5: 0,
};

export function isSponsorEligible(sponsorTier: SponsorTier, teamReputation: number): boolean {
  if (!Number.isFinite(teamReputation) || teamReputation < 0 || teamReputation > 9999) {
    throw new RangeError("Reputasi tim harus berada pada rentang 0–9999.");
  }
  return teamReputation >= SPONSOR_MINIMUM_REPUTATION[sponsorTier];
}

export function selectSponsorTier(rng: SeededRandom, divisionTier: TierId): SponsorTier {
  const choices = SPONSOR_OFFER_WEIGHTS[divisionTier];
  if (choices.length === 0) throw new Error("Tier 6 tidak memiliki distribusi sponsor yang ditentukan sumber.");
  const roll = rng.next();
  let cumulative = 0;
  for (const choice of choices) {
    cumulative += choice.weight;
    if (roll < cumulative) return choice.tier;
  }
  return choices[choices.length - 1]!.tier;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Evaluates one source-defined target over a completed season. Rates are 0..1; popularity is 0..100. */
export function evaluateSponsorTarget(
  sponsorTier: SponsorTier,
  focus: SponsorFocus,
  performance: SponsorPerformance,
  completedRounds: number,
): SponsorTargetResult {
  if (!Number.isSafeInteger(completedRounds) || completedRounds <= 0) {
    throw new RangeError("Jumlah ronde selesai harus berupa integer positif.");
  }
  for (const [key, value] of Object.entries(performance)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Statistik sponsor tidak valid: ${key}.`);
  }
  if (performance.roundsWithPointsFinish > completedRounds ||
      performance.roundsWithPodium > completedRounds || performance.roundsWon > completedRounds ||
      performance.carFinishes > performance.carStarts || performance.leadDriverPopularity > 100) {
    throw new RangeError("Statistik performa sponsor tidak konsisten.");
  }
  const thresholds = SPONSOR_TARGETS[sponsorTier];
  const actualByFocus: Record<SponsorFocus, number> = {
    points: safeRate(performance.roundsWithPointsFinish, completedRounds),
    podium: safeRate(performance.roundsWithPodium, completedRounds),
    win: safeRate(performance.roundsWon, completedRounds),
    finish: safeRate(performance.carFinishes, performance.carStarts),
    popularity: performance.leadDriverPopularity,
  };
  const required = thresholds[focus];
  const actual = actualByFocus[focus];
  return { focus, required, actual, achieved: actual >= required };
}
