import { describe, expect, it } from "vitest";
import { assertDriverEligible, evaluateDriverEligibility } from "./DriverEligibilityService";

describe("driver eligibility", () => {
  it("accepts ages on the inclusive boundaries for each tier", () => {
    expect(evaluateDriverEligibility({ age: 18, tier: 1 }).eligible).toBe(true);
    expect(evaluateDriverEligibility({ age: 45, tier: 1 }).eligible).toBe(true);
    expect(evaluateDriverEligibility({ age: 10, tier: 5 }).eligible).toBe(true);
    expect(evaluateDriverEligibility({ age: 14, tier: 5 }).eligible).toBe(true);
  });

  it("rejects underage Tier 1 and overage Tier 5 drivers with actionable reasons", () => {
    const tooYoung = evaluateDriverEligibility({ age: 17, tier: 1 });
    expect(tooYoung.eligible).toBe(false);
    expect(tooYoung.reason).toContain("minimum 18 tahun");
    const tooOld = evaluateDriverEligibility({ age: 15, tier: 5 });
    expect(tooOld.eligible).toBe(false);
    expect(tooOld.reason).toContain("maksimum 14 tahun");
  });

  it("throws when a caller attempts an ineligible registration", () => {
    expect(() => assertDriverEligible({ age: 15, tier: 5 })).toThrow("melewati batas maksimum 14 tahun");
    expect(() => assertDriverEligible({ age: 19, tier: 1 })).not.toThrow();
  });

  it("rejects invalid ages rather than silently clamping them", () => {
    expect(() => evaluateDriverEligibility({ age: -1, tier: 1 })).toThrow("integer non-negatif");
    expect(() => evaluateDriverEligibility({ age: 18.5, tier: 1 })).toThrow("integer non-negatif");
  });
});
