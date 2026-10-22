import { TIER_CONFIG, type TierId } from "./GameConfig";

export type EconomyTierId = TierId;
export type DevelopmentProjectSize = "minor" | "standard" | "major";
export type CashPackSize = "S" | "M" | "L" | "XL";

const SPONSOR_SLOTS: Readonly<Record<Exclude<TierId, 6>, number>> = {
  1: 5, 2: 4, 3: 4, 4: 3, 5: 3,
};

const PRIZE_SHARES_PERCENT = [18, 14, 11.5, 9.5, 8, 7, 6, 5.5, 4.5, 4.5, 6, 5.5] as const;
const PROJECT_COST_FRACTIONS: Readonly<Record<DevelopmentProjectSize, number>> = {
  minor: 0.015, standard: 0.04, major: 0.1,
};
const CASH_PACK_FRACTIONS: Readonly<Record<CashPackSize, number>> = {
  S: 0.03, M: 0.1, L: 0.3, XL: 0.8,
};

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} harus berupa angka non-negatif.`);
}

export function requiredBudget(tier: EconomyTierId): number {
  return TIER_CONFIG[tier].requiredBudget;
}

export function calculateOperatingCostPerRound(tier: EconomyTierId): number {
  return Math.round(requiredBudget(tier) * 0.25 / TIER_CONFIG[tier].roundsPerSeason);
}

export function calculateEntryFee(tier: EconomyTierId): number {
  return Math.round(requiredBudget(tier) * 0.08);
}

export function calculateMinimumRAndDBudget(tier: EconomyTierId): number {
  return Math.round(requiredBudget(tier) * 0.15);
}

/** Per-driver average salary target: 12% of RequiredBudget per season. */
export function calculateAverageDriverPayroll(tier: EconomyTierId): number {
  return Math.round(requiredBudget(tier) * 0.12);
}

/** The source economy table budgets two race drivers per team. */
export function calculateTeamDriverPayroll(tier: EconomyTierId): number {
  return calculateAverageDriverPayroll(tier) * 2;
}

export function calculateAverageStaffPayroll(tier: EconomyTierId): number {
  return Math.round(requiredBudget(tier) * 0.15);
}

export function calculateFacilityUpgradeCost(tier: EconomyTierId, currentLevel: number): number {
  if (!Number.isSafeInteger(currentLevel) || currentLevel < 1 || currentLevel >= 10) {
    throw new RangeError("Level fasilitas saat ini harus integer 1–9.");
  }
  return Math.round(requiredBudget(tier) * 0.015 * Math.pow(1.45, currentLevel - 1));
}

export function calculateFacilityMaintenancePerSeason(tier: EconomyTierId, level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > 10) {
    throw new RangeError("Level fasilitas harus integer 1–10.");
  }
  return Math.round(requiredBudget(tier) * 0.0012 * level);
}

export function calculateDevelopmentProjectCost(tier: EconomyTierId, size: DevelopmentProjectSize): number {
  return Math.round(requiredBudget(tier) * PROJECT_COST_FRACTIONS[size]);
}

export function calculateOverdraftLimit(tier: EconomyTierId): number {
  return Math.round(requiredBudget(tier) * 0.25);
}

export function calculateSeasonInterest(debt: number): number {
  assertFiniteNonNegative("Debt", debt);
  return Math.round(debt * 0.08);
}

export function calculatePrizeMoney(tier: EconomyTierId, constructorPosition: number): number {
  if (!Number.isSafeInteger(constructorPosition) || constructorPosition < 1 || constructorPosition > 12) {
    throw new RangeError("Posisi konstruktor harus integer 1–12.");
  }
  const divisionPrizePool = requiredBudget(tier) * 0.3 * 12;
  return Math.round(divisionPrizePool * PRIZE_SHARES_PERCENT[constructorPosition - 1] / 100);
}

export function calculateCommercialRevenue(tier: EconomyTierId, averageDriverFanPopularity: number): number {
  if (!Number.isFinite(averageDriverFanPopularity) || averageDriverFanPopularity < 0 || averageDriverFanPopularity > 100) {
    throw new RangeError("Fan Popularity rata-rata harus berada pada rentang 0–100.");
  }
  return Math.round(requiredBudget(tier) * 0.12 * (0.6 + 0.8 * averageDriverFanPopularity / 100));
}

export function calculateRevenueTarget(tier: EconomyTierId, averageDriverFanPopularity: number) {
  const rb = requiredBudget(tier);
  const sponsorTarget = Math.round(rb * 0.57);
  const prizeMoneyTarget = Math.round(rb * 0.3);
  const commercialRevenue = calculateCommercialRevenue(tier, averageDriverFanPopularity);
  const otherRevenueTarget = Math.round(rb * 0.06);
  return {
    sponsorTarget,
    prizeMoneyTarget,
    commercialRevenue,
    otherRevenueTarget,
    totalTarget: sponsorTarget + prizeMoneyTarget + commercialRevenue + otherRevenueTarget,
  };
}

export function maximumActiveSponsors(tier: Exclude<TierId, 6>): number {
  return SPONSOR_SLOTS[tier];
}

export function calculateCashPackValue(tier: EconomyTierId, pack: CashPackSize): number {
  return Math.round(requiredBudget(tier) * CASH_PACK_FRACTIONS[pack]);
}

export function calculateAdReward(input: {
  readonly tier: EconomyTierId;
  readonly viewsThisSeason: number;
  readonly viewsToday: number;
  readonly secondsSincePreviousView: number;
}): { readonly allowed: boolean; readonly reward: number; readonly reason?: string } {
  for (const [name, value] of [
    ["viewsThisSeason", input.viewsThisSeason],
    ["viewsToday", input.viewsToday],
    ["secondsSincePreviousView", input.secondsSincePreviousView],
  ] as const) assertFiniteNonNegative(name, value);
  if (!Number.isSafeInteger(input.viewsThisSeason) || !Number.isSafeInteger(input.viewsToday)) {
    throw new RangeError("Jumlah tayangan harus berupa integer.");
  }
  if (input.viewsToday >= 10) return { allowed: false, reward: 0, reason: "Batas 10 tayangan per hari tercapai." };
  if (input.secondsSincePreviousView < 5) return { allowed: false, reward: 0, reason: "Jeda antar tayangan minimal 5 detik." };
  const reward = Math.round(requiredBudget(input.tier) * 0.01);
  const seasonCap = requiredBudget(input.tier) * 0.6;
  if (input.viewsThisSeason * reward + reward > seasonCap) {
    return { allowed: false, reward: 0, reason: "Batas reward iklan 60% RB per season tercapai." };
  }
  return { allowed: true, reward };
}

export function calculateBalanceAfterTransaction(input: {
  readonly currentBalance: number;
  readonly amount: number;
  readonly tier: EconomyTierId;
}): { readonly balanceAfter: number; readonly withinOverdraft: boolean; readonly canRecruitOrDevelop: boolean } {
  if (!Number.isFinite(input.currentBalance) || !Number.isFinite(input.amount)) {
    throw new RangeError("Saldo dan nominal transaksi harus valid.");
  }
  const balanceAfter = Math.round(input.currentBalance + input.amount);
  const withinOverdraft = balanceAfter >= -calculateOverdraftLimit(input.tier);
  return {
    balanceAfter,
    withinOverdraft,
    canRecruitOrDevelop: balanceAfter >= 0,
  };
}
