import { describe, expect, it } from "vitest";
import { calculateCircuitCarScore, type CarPerformanceAttributes, type CircuitPerformanceWeights } from "./CircuitCarScore";

const weights: CircuitPerformanceWeights = {
  engine: 0.2, aero: 0.2, highSpeed: 0.1, mediumSpeed: 0.1,
  lowSpeed: 0.1, grip: 0.1, traction: 0.1, braking: 0.1,
};
const car: CarPerformanceAttributes = {
  enginePower: 100, aero: 0, highSpeed: 0, mediumSpeed: 50,
  lowSpeed: 50, grip: 100, traction: 0, braking: 50,
};

describe("circuit-weighted car score", () => {
  it("uses circuit-specific weights for formula cars", () => {
    expect(calculateCircuitCarScore(1, weights, car)).toBeCloseTo(45, 8);
  });

  it("redistributes aero and high-speed weights for kart tiers", () => {
    expect(calculateCircuitCarScore(5, weights, car)).toBeCloseTo(63, 8);
    expect(calculateCircuitCarScore(6, weights, car)).toBeCloseTo(63, 8);
  });

  it("normalizes weights and rejects invalid attributes", () => {
    const doubledWeights = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value * 2])) as unknown as CircuitPerformanceWeights;
    expect(calculateCircuitCarScore(1, doubledWeights, car)).toBeCloseTo(45, 8);
    expect(() => calculateCircuitCarScore(1, { ...weights, engine: -1 }, car)).toThrow("non-negatif");
    expect(() => calculateCircuitCarScore(1, weights, { ...car, grip: 101 })).toThrow("0–100");
  });
});
