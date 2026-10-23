import { describe, expect, it } from "vitest";
import { evaluateOvertaking, resolveOvertaking, type OvertakingInput } from "./OvertakingEngine";

const base: OvertakingInput = {
  attackerRacecraft: 75,
  attackerPaceAdvantageSeconds: 0.2,
  attackerTyreWearPercent: 20,
  defenderTyreWearPercent: 40,
  gapSeconds: 0.5,
  drsZoneActive: false,
  tier: 1,
  trackOvertakingDifficulty: 5,
  defenderSkill: 55,
  defensiveMode: "normal",
};

describe("source-backed overtaking model", () => {
  it("does not attempt a pass unless the attacker is faster and within the gap threshold", () => {
    expect(evaluateOvertaking({ ...base, attackerPaceAdvantageSeconds: 0 }).reason).toBe("pace-not-faster");
    expect(evaluateOvertaking({ ...base, gapSeconds: 0.8 }).reason).toBe("gap-too-large");
    expect(evaluateOvertaking({ ...base, gapSeconds: 0.99, drsZoneActive: true }).attempted).toBe(true);
    expect(evaluateOvertaking({ ...base, gapSeconds: 0.99, drsZoneActive: false }).attempted).toBe(false);
  });

  it("uses DRS only in Tiers 1–3 and applies the documented track and defence modifiers", () => {
    const baseResult = evaluateOvertaking(base);
    expect(evaluateOvertaking({ ...base, drsZoneActive: true, tier: 3 }).drsBonus).toBe(8);
    expect(evaluateOvertaking({ ...base, drsZoneActive: true, tier: 4 }).drsBonus).toBe(0);
    expect(evaluateOvertaking({ ...base, trackOvertakingDifficulty: 1 }).probability)
      .toBeGreaterThan(evaluateOvertaking({ ...base, trackOvertakingDifficulty: 10 }).probability);
    expect(evaluateOvertaking({ ...base, defensiveMode: "defend" }).probability).toBeLessThan(baseResult.probability);
    expect(evaluateOvertaking({ ...base, defensiveMode: "all-out-defend" }).probability)
      .toBeLessThan(evaluateOvertaking({ ...base, defensiveMode: "defend" }).probability);
  });

  it("rewards fresher tyres and resolves attempts reproducibly from the race seed", () => {
    expect(evaluateOvertaking({ ...base, attackerTyreWearPercent: 10 }).probability)
      .toBeGreaterThan(evaluateOvertaking({ ...base, attackerTyreWearPercent: 30 }).probability);
    const input = {
      seed: "overtaking-test", season: 2, round: 3, lap: 8,
      attackerId: "driver-a", defenderId: "driver-b", overtake: base,
    };
    expect(resolveOvertaking(input)).toEqual(resolveOvertaking(input));
  });

  it("rejects invalid circuit difficulty, tyre values and gap", () => {
    expect(() => evaluateOvertaking({ ...base, trackOvertakingDifficulty: 11 })).toThrow("integer 1–10");
    expect(() => evaluateOvertaking({ ...base, attackerTyreWearPercent: 101 })).toThrow("0–100");
    expect(() => evaluateOvertaking({ ...base, gapSeconds: -0.1 })).toThrow("non-negatif");
  });
});
