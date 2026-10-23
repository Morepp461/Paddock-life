import { describe, expect, it } from "vitest";
import {
  calculateAdReward,
  calculateAverageDriverPayroll,
  calculateTeamDriverPayroll,
  calculateAverageStaffPayroll,
  calculateBalanceAfterTransaction,
  calculateCashPackValue,
  calculateCommercialRevenue,
  calculateDevelopmentProjectCost,
  calculateEntryFee,
  calculateFacilityMaintenancePerSeason,
  calculateFacilityUpgradeCost,
  calculateMinimumRAndDBudget,
  calculateOperatingCostPerRound,
  calculateProratedRoundCost,
  calculateOverdraftLimit,
  calculatePrizeMoney,
  calculateRevenueTarget,
  calculateSeasonInterest,
  maximumActiveSponsors,
} from "./EconomyEngine";

describe("documented economy formulas", () => {
  it("distributes annual payroll exactly across race rounds", () => {
    expect(Array.from({ length: 24 }, (_, index) => calculateProratedRoundCost(62_000_003, index + 1, 24)).reduce((sum, amount) => sum + amount, 0)).toBe(62_000_003);
    expect(calculateProratedRoundCost(1_000, 1, 3)).toBe(334);
    expect(calculateProratedRoundCost(1_000, 2, 3)).toBe(333);
    expect(calculateProratedRoundCost(1_000, 3, 3)).toBe(333);
    expect(() => calculateProratedRoundCost(1_000, 4, 3)).toThrow("Round harus");
  });
  it("matches required budget cost fractions across tiers", () => {
    expect(calculateOperatingCostPerRound(5)).toBe(150_000);
    expect(calculateOperatingCostPerRound(1)).toBe(Math.round(248_000_000 * 0.25 / 24));
    expect(calculateEntryFee(5)).toBe(480_000);
    expect(calculateMinimumRAndDBudget(5)).toBe(900_000);
    expect(calculateAverageDriverPayroll(5)).toBe(720_000);
    expect(calculateTeamDriverPayroll(5)).toBe(1_440_000);
    expect(calculateTeamDriverPayroll(3)).toBe(9_120_000);
    expect(calculateAverageStaffPayroll(5)).toBe(900_000);
    expect(calculateOverdraftLimit(5)).toBe(1_500_000);
  });

  it("calculates facility, development, debt, and sponsor caps", () => {
    expect(calculateFacilityUpgradeCost(5, 1)).toBe(90_000);
    expect(calculateFacilityUpgradeCost(5, 2)).toBe(130_500);
    expect(calculateFacilityMaintenancePerSeason(5, 1)).toBe(7_200);
    expect(calculateDevelopmentProjectCost(5, "minor")).toBe(90_000);
    expect(calculateDevelopmentProjectCost(5, "standard")).toBe(240_000);
    expect(calculateDevelopmentProjectCost(5, "major")).toBe(600_000);
    expect(calculateSeasonInterest(1_500_000)).toBe(120_000);
    expect([1, 2, 3, 4, 5].map((tier) => maximumActiveSponsors(tier as 1 | 2 | 3 | 4 | 5))).toEqual([5, 4, 4, 3, 3]);
  });

  it("matches prize money, commercial revenue, and median revenue target", () => {
    expect(calculatePrizeMoney(5, 1)).toBe(3_888_000);
    expect(calculatePrizeMoney(1, 1)).toBe(160_704_000);
    expect(calculateCommercialRevenue(5, 50)).toBe(720_000);
    const target = calculateRevenueTarget(5, 50);
    expect(target.sponsorTarget).toBe(3_420_000);
    expect(target.prizeMoneyTarget).toBe(1_800_000);
    expect(target.commercialRevenue).toBe(720_000);
    expect(target.otherRevenueTarget).toBe(360_000);
    expect(target.totalTarget).toBe(6_300_000);
  });

  it("scales cash packs and enforces rewarded-ad limits", () => {
    expect(calculateCashPackValue(5, "S")).toBe(180_000);
    expect(calculateCashPackValue(5, "XL")).toBe(4_800_000);
    expect(calculateAdReward({ tier: 5, viewsThisSeason: 0, viewsToday: 0, secondsSincePreviousView: 5 })).toEqual({ allowed: true, reward: 60_000 });
    expect(calculateAdReward({ tier: 5, viewsThisSeason: 59, viewsToday: 9, secondsSincePreviousView: 5 }).allowed).toBe(true);
    expect(calculateAdReward({ tier: 5, viewsThisSeason: 60, viewsToday: 9, secondsSincePreviousView: 5 }).allowed).toBe(false);
    expect(calculateAdReward({ tier: 5, viewsThisSeason: 0, viewsToday: 10, secondsSincePreviousView: 5 }).allowed).toBe(false);
    expect(calculateAdReward({ tier: 5, viewsThisSeason: 0, viewsToday: 0, secondsSincePreviousView: 4 }).allowed).toBe(false);
  });

  it("supports RB-scaled Tier 6 operating costs and finance formulas", () => {
    expect(calculateOperatingCostPerRound(6)).toBe(93_750);
    expect(calculateEntryFee(6)).toBe(240_000);
    expect(calculateMinimumRAndDBudget(6)).toBe(450_000);
    expect(calculateOverdraftLimit(6)).toBe(750_000);
    expect(calculateCashPackValue(6, "S")).toBe(90_000);
    expect(calculatePrizeMoney(6, 1)).toBe(1_944_000);
  });

  it("applies overdraft rules without allowing negative cash recruitment", () => {
    expect(calculateBalanceAfterTransaction({ currentBalance: 100, amount: -50, tier: 5 })).toEqual({
      balanceAfter: 50, withinOverdraft: true, canRecruitOrDevelop: true,
    });
    expect(calculateBalanceAfterTransaction({ currentBalance: 100, amount: -200, tier: 5 })).toEqual({
      balanceAfter: -100, withinOverdraft: true, canRecruitOrDevelop: false,
    });
    expect(calculateBalanceAfterTransaction({ currentBalance: -1_400_000, amount: -200_000, tier: 5 }).withinOverdraft).toBe(false);
    expect(() => calculatePrizeMoney(5, 13)).toThrow(RangeError);
    expect(() => calculateFacilityUpgradeCost(5, 10)).toThrow(RangeError);
  });
});
