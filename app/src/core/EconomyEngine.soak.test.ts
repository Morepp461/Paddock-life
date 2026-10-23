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
  it("runs 1,000 season cycles across all six tiers and all 12 constructor positions", () => {
    const tiers: readonly TierId[] = [1, 2, 3, 4, 5, 6];
    let seasonsChecked = 0;
    let teamSettlementsChecked = 0;

    for (let season = 1; season <= 1_000; season += 1) {
      for (const tier of tiers) {
        const rb = requiredBudget(tier);
        const rounds = TIER_CONFIG[tier].roundsPerSeason;
        let cashAfterRecurringCosts = Math.round(rb * 0.7);
        const recurringCosts = [
          -calculateOperatingCostPerRound(tier),
          -Math.round(calculateTeamDriverPayroll(tier) / rounds),
          -Math.round(calculateAverageStaffPayroll(tier) / rounds),
        ];

        for (let round = 1; round <= rounds; round += 1) {
          for (const amount of recurringCosts) {
            const result = calculateBalanceAfterTransaction({ currentBalance: cashAfterRecurringCosts, amount, tier });
            if (!result.withinOverdraft || !Number.isFinite(result.balanceAfter)) {
              throw new Error("Recurring economy transaction exceeded valid cash bounds at tier " + tier + ", season " + season + ", round " + round + ".");
            }
            cashAfterRecurringCosts = result.balanceAfter;
          }
        }

        for (let position = 1; position <= 12; position += 1) {
          let closingCash = cashAfterRecurringCosts;
          const closingTransactions = [
            calculatePrizeMoney(tier, position),
            calculateCommercialRevenue(tier, 50),
            -6 * calculateFacilityMaintenancePerSeason(tier, 5),
            -calculateSeasonInterest(0),
          ];
          for (const amount of closingTransactions) {
            const result = calculateBalanceAfterTransaction({ currentBalance: closingCash, amount, tier });
            if (!result.withinOverdraft || !Number.isFinite(result.balanceAfter)) {
              throw new Error("Season settlement exceeded valid cash bounds at tier " + tier + ", position " + position + ", season " + season + ".");
            }
            closingCash = result.balanceAfter;
          }
          if (closingCash <= -Math.round(rb * 0.25)) {
            throw new Error("Closing balance must remain above the overdraft boundary.");
          }
          teamSettlementsChecked += 1;
        }
      }
      seasonsChecked += 1;
    }

    expect(seasonsChecked).toBe(1_000);
    expect(teamSettlementsChecked).toBe(72_000);
  }, 120_000);
});
