import { describe, expect, it } from "vitest";
import { evaluateBoardSeason } from "./BoardObjectiveEngine";

const base = {
  tier: 3 as const,
  difficulty: "normal" as const,
  expectedRank: 8,
  constructorPosition: 8,
  closingCash: 20_000_000,
  requiredBudget: 38_000_000,
  currentConfidence: 60,
  currentManagerReputation: 3_000,
  previousPrimaryMisses: 0,
  season: 2,
  isSandbox: false,
  higherDivisionUnlocked: false,
};

describe("board objective season outcomes", () => {
  it("uses the documented difficulty ambition to calculate primary target rank", () => {
    expect(evaluateBoardSeason({ ...base, difficulty: "easy" }).primaryTargetRank).toBe(7);
    expect(evaluateBoardSeason({ ...base, difficulty: "normal" }).primaryTargetRank).toBe(7);
    expect(evaluateBoardSeason({ ...base, difficulty: "hard" }).primaryTargetRank).toBe(6);
  });

  it("updates confidence and manager reputation from primary, financial and title results", () => {
    const result = evaluateBoardSeason({ ...base, constructorPosition: 1, closingCash: 30_000_000, expectedRank: 3 });
    expect(result.primaryAchieved).toBe(true);
    expect(result.financialAchieved).toBe(true);
    expect(result.unlockDivisionObjective).toBe(true);
    expect(result.unlockDivisionAchieved).toBe(true);
    expect(result.confidenceDelta).toBe(30);
    expect(result.confidenceAfter).toBe(90);
    expect(result.objectiveScore).toBe(60);
    expect(result.titleBonus).toBe(150);
    expect(result.managerReputationDelta).toBe(525);
    expect(result.managerReputationAfter).toBe(3_525);
  });

  it("applies the documented consecutive-miss dismissal rule outside season-one protection", () => {
    const result = evaluateBoardSeason({
      ...base, season: 3, constructorPosition: 12, closingCash: -10_000_000,
      currentConfidence: 40, previousPrimaryMisses: 1,
    });
    expect(result.primaryAchieved).toBe(false);
    expect(result.financialAchieved).toBe(false);
    expect(result.consecutivePrimaryMisses).toBe(2);
    expect(result.managerFired).toBe(true);
    expect(result.firingReason).toBe("low-confidence");
  });

  it("protects a first-season manager unless cash exceeds the overdraft limit, and disables firing in sandbox", () => {
    const protectedResult = evaluateBoardSeason({ ...base, season: 1, constructorPosition: 12, currentConfidence: 40 });
    expect(protectedResult.managerFired).toBe(false);
    const sandboxResult = evaluateBoardSeason({
      ...base, season: 3, constructorPosition: 12, currentConfidence: 20,
      previousPrimaryMisses: 1, isSandbox: true,
    });
    expect(sandboxResult.managerFired).toBe(false);
  });

  it("rejects invalid positions and confidence values", () => {
    expect(() => evaluateBoardSeason({ ...base, constructorPosition: 13 })).toThrow("1–12");
    expect(() => evaluateBoardSeason({ ...base, currentConfidence: 101 })).toThrow("0–100");
  });
});
