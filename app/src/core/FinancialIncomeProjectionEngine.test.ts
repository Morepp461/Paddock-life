import { describe, expect, it } from "vitest";
import { calculateCommercialRevenue, calculatePrizeMoney } from "./EconomyEngine";
import { calculateFinancialIncomeProjections } from "./FinancialIncomeProjectionEngine";
import type { TierId } from "./GameConfig";

describe("financial income projections", () => {
  it("uses documented sponsor, average prize-pool, and commercial formulas for all six tiers", () => {
    const input = { activeSponsorRevenue: 1_250_000, averageDriverFanPopularity: 62 };
    const result = calculateFinancialIncomeProjections(input);
    const tiers: readonly TierId[] = [1, 2, 3, 4, 5, 6];
    expect(result.detail.map((row) => row.tier)).toEqual(tiers);
    for (const row of result.detail) {
      const meanPrize = Math.round(
        Array.from({ length: 12 }, (_, index) => calculatePrizeMoney(row.tier, index + 1))
          .reduce((sum, amount) => sum + amount, 0) / 12,
      );
      expect(row.sponsorRevenue).toBe(input.activeSponsorRevenue);
      expect(row.projectedPrizeMoney).toBe(meanPrize);
      expect(row.commercialRevenue).toBe(calculateCommercialRevenue(row.tier, input.averageDriverFanPopularity));
      expect(row.totalProjectedIncome).toBe(row.sponsorRevenue + row.projectedPrizeMoney + row.commercialRevenue);
      expect(result.byTier[row.tier]).toBe(row.totalProjectedIncome);
    }
  });

  it("rejects unsupported sponsor revenue and popularity inputs", () => {
    expect(() => calculateFinancialIncomeProjections({ activeSponsorRevenue: -1, averageDriverFanPopularity: 50 })).toThrow("non-negative");
    expect(() => calculateFinancialIncomeProjections({ activeSponsorRevenue: 0, averageDriverFanPopularity: 101 })).toThrow("between 0 and 100");
  });
});
