import { describe, expect, it } from "vitest";
import {
  calculateAverageStaffPayroll,
  calculateBalanceAfterTransaction,
  calculateCommercialRevenue,
  calculateFacilityMaintenancePerSeason,
  calculateOperatingCostPerRound,
  calculatePrizeMoney,
  calculateSeasonInterest,
  calculateTeamDriverPayroll,
  requiredBudget,
} from "./EconomyEngine";
import { TIER_CONFIG, type TierId } from "./GameConfig";

describe("economy season soak validation", () => {
  it("runs 1,000 complete 12-team seasons across all six tiers without invalid cash balances", () => {
    const tiers: readonly TierId[] = [1, 2, 3, 4, 5, 6];
    let seasonsChecked = 0;

    for (let season = 1; season <= 1_000; season += 1) {
      for (const tier of tiers) {
        const rb = requiredBudget(tier);
        const rounds = TIER_CONFIG[tier].roundsPerSeason;
        for (let position = 1; position <= 12; position += 1) {
          let cash = Math.round(rb * 0.7);
          const recurringCosts = [
            { amount: -calculateOperatingCostPerRound(tier) },
            { amount: -Math.round(calculateTeamDriverPayroll(tier) / rounds) },
            { amount: -Math.round(calculateAverageStaffPayroll(tier) / rounds) },
          ];

          for (let round = 1; round <= rounds; round += 1) {
            for (const cost of recurringCosts) {
              const result = calculateBalanceAfterTransaction({ currentBalance: cash, amount: cost.amount, tier });
              expect(result.withinOverdraft).toBe(true);
              expect(Number.isFinite(result.balanceAfter)).toBe(true);
              cash = result.balanceAfter;
            }
          }

          const closingTransactions = [
            { amount: calculatePrizeMoney(tier, position) },
            { amount: calculateCommercialRevenue(tier, 50) },
            { amount: -6 * calculateFacilityMaintenancePerSeason(tier, 5) },
            { amount: -calculateSeasonInterest(0) },
          ];
          for (const transaction of closingTransactions) {
            const result = calculateBalanceAfterTransaction({ currentBalance: cash, amount: transaction.amount, tier });
            expect(result.withinOverdraft).toBe(true);
            expect(Number.isFinite(result.balanceAfter)).toBe(true);
            cash = result.balanceAfter;
          }
          expect(cash).toBeGreaterThan(-Math.round(rb * 0.25));
        }
      }
      seasonsChecked += 1;
    }

    expect(seasonsChecked).toBe(1_000);
  }, 120_000);
});
