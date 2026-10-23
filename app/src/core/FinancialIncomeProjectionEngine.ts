import { calculateCommercialRevenue, calculatePrizeMoney } from "./EconomyEngine";
import type { TierId } from "./GameConfig";

export interface FinancialIncomeProjectionInput {
  /** Contract value from sponsors active in the target season and eligible for the team's reputation. */
  readonly activeSponsorRevenue: number;
  /** Mean popularity of the team's current eligible race drivers, 0–100. */
  readonly averageDriverFanPopularity: number;
}

export interface TierIncomeProjection {
  readonly tier: TierId;
  readonly sponsorRevenue: number;
  readonly projectedPrizeMoney: number;
  readonly commercialRevenue: number;
  readonly totalProjectedIncome: number;
}

export type TierIncomeProjectionMap = Readonly<Record<TierId, number>>;

/**
 * Source: PRD_Game_Designv4 §6.4 and 06_Economy_Spec_v1.
 * Prize income uses the arithmetic mean of all 12 documented constructor positions,
 * avoiding an invented predicted finishing position for a team moving divisions.
 */
export function calculateFinancialIncomeProjections(
  input: FinancialIncomeProjectionInput,
): { readonly byTier: TierIncomeProjectionMap; readonly detail: readonly TierIncomeProjection[] } {
  if (!Number.isFinite(input.activeSponsorRevenue) || input.activeSponsorRevenue < 0) {
    throw new RangeError("Active sponsor revenue must be a non-negative finite value.");
  }
  if (!Number.isFinite(input.averageDriverFanPopularity) ||
      input.averageDriverFanPopularity < 0 || input.averageDriverFanPopularity > 100) {
    throw new RangeError("Average driver popularity must be between 0 and 100.");
  }

  const detail = ([1, 2, 3, 4, 5, 6] as const).map((tier): TierIncomeProjection => {
    const prizeTotal = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const)
      .reduce((sum, position) => sum + calculatePrizeMoney(tier, position), 0);
    const projectedPrizeMoney = Math.round(prizeTotal / 12);
    const commercialRevenue = calculateCommercialRevenue(tier, input.averageDriverFanPopularity);
    return {
      tier,
      sponsorRevenue: input.activeSponsorRevenue,
      projectedPrizeMoney,
      commercialRevenue,
      totalProjectedIncome: input.activeSponsorRevenue + projectedPrizeMoney + commercialRevenue,
    };
  });

  const byTier = Object.fromEntries(detail.map((row) => [row.tier, row.totalProjectedIncome])) as Record<TierId, number>;
  return { byTier, detail };
}
