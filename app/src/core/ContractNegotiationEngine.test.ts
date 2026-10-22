import { describe, expect, it } from "vitest";
import {
  calculateDriverAskingSalary,
  evaluateContractOffer,
  findSalaryCounterOffer,
  generateDriverDemandFactor,
  validateContractDuration,
} from "./ContractNegotiationEngine";

describe("contract negotiation rules", () => {
  it("calculates asking salary from market value, salary rate, demand and ambition", () => {
    expect(calculateDriverAskingSalary({ marketValue: 10_000_000, ambition: 50, demandFactor: 1 })).toBe(1_200_000);
    expect(calculateDriverAskingSalary({ marketValue: 10_000_000, ambition: 100, demandFactor: 1 })).toBe(1_320_000);
  });

  it("generates a reproducible demand factor inside the documented bounds", () => {
    const input = { worldSeed: "contract-test", season: 2, driverId: "driver-01" };
    const first = generateDriverDemandFactor(input);
    expect(first).toBe(generateDriverDemandFactor(input));
    expect(first).toBeGreaterThanOrEqual(0.85);
    expect(first).toBeLessThanOrEqual(1.3);
  });

  it("applies the documented weighted acceptance score and decision thresholds", () => {
    const terms = {
      offeredSalary: 1_000_000, askingSalary: 1_000_000,
      roleScore: 1, prestigeScore: 1, titleChanceScore: 1,
      lengthScore: 1, loyaltyAmbitionScore: 1, bonusScore: 1, clausePenalty: 0,
    };
    expect(evaluateContractOffer(terms)).toEqual({ score: 1, decision: "accepted", salaryScore: 1 });
    expect(evaluateContractOffer({ ...terms, roleScore: 0, prestigeScore: 0, titleChanceScore: 0, lengthScore: 0, loyaltyAmbitionScore: 0, bonusScore: 0 }).decision).toBe("rejected");
    expect(evaluateContractOffer({ ...terms, offeredSalary: 0.2 * terms.askingSalary, roleScore: 1, prestigeScore: 1, titleChanceScore: 1, lengthScore: 1, loyaltyAmbitionScore: 1, bonusScore: 1 }).decision).toBe("counter-offer");
  });

  it("limits under-18 contracts to two seasons and other contracts to four", () => {
    expect(() => validateContractDuration(3, 17)).toThrow("1–2");
    expect(() => validateContractDuration(4, 18)).not.toThrow();
    expect(() => validateContractDuration(5, 25)).toThrow("1–4");
  });

  it("finds a counter-offer only inside the documented 5–25% salary increase", () => {
    const counter = findSalaryCounterOffer({
      offeredSalary: 700_000, askingSalary: 1_000_000,
      roleScore: 1, prestigeScore: 1, titleChanceScore: 1,
      lengthScore: 1, loyaltyAmbitionScore: 1, bonusScore: 1, clausePenalty: 0,
    });
    expect(counter?.offeredSalary).toBeGreaterThanOrEqual(735_000);
    expect(counter?.offeredSalary).toBeLessThanOrEqual(875_000);
    expect(counter?.evaluation.score).toBeGreaterThanOrEqual(0.85);
  });
});
