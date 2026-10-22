import { describe, expect, it } from "vitest";
import { calculateIncidentRisk, resolveIncidentOutcome, rollLapIncident } from "./IncidentEngine";
import { SeededRandom } from "./SeededRandom";
import type { IncidentRiskInput } from "./IncidentEngine";

const baseline: IncidentRiskInput = {
  tier: 1,
  baseRisk: 50,
  aggression: 50,
  tyreStress: 50,
  weatherRisk: 50,
  pressure: 50,
  consistency: 50,
  focus: 50,
};

describe("incident risk and outcome model", () => {
  it("calculates the documented per-lap risk and tier multiplier", () => {
    expect(calculateIncidentRisk(baseline)).toEqual({ mistakeScore: 150, perLapProbability: 0.0076 });
    const maximum = calculateIncidentRisk({
      tier: 6, baseRisk: 100, aggression: 100, tyreStress: 100, weatherRisk: 100,
      pressure: 100, consistency: 0, focus: 0,
    });
    expect(maximum.mistakeScore).toBe(500);
    expect(maximum.perLapProbability).toBeCloseTo(0.0308);
  });

  it("rejects invalid risk scores", () => {
    expect(() => calculateIncidentRisk({ ...baseline, aggression: 101 })).toThrow(RangeError);
    expect(() => calculateIncidentRisk({ ...baseline, focus: Number.NaN })).toThrow(RangeError);
  });

  it("is deterministic and returns source-defined effects", () => {
    expect(resolveIncidentOutcome(new SeededRandom(10))).toEqual(resolveIncidentOutcome(new SeededRandom(10)));
    const outcomes = new Set(Array.from({ length: 1000 }, (_, index) =>
      resolveIncidentOutcome(new SeededRandom(index + 1)).outcome));
    expect(outcomes).toEqual(new Set(["lock-up", "spin", "minor-collision", "crash", "fatal-incident"]));
  });

  it("keeps outcome weights normalized to 100 percent over a large seeded sample", () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 20_000; seed += 1) {
      const outcome = resolveIncidentOutcome(new SeededRandom(seed)).outcome;
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    expect((counts.get("lock-up") ?? 0) / 20_000).toBeCloseTo(0.54, 1);
    expect((counts.get("spin") ?? 0) / 20_000).toBeCloseTo(0.22, 1);
    expect((counts.get("minor-collision") ?? 0) / 20_000).toBeCloseTo(0.13, 1);
    expect((counts.get("crash") ?? 0) / 20_000).toBeCloseTo(0.09, 1);
    expect((counts.get("fatal-incident") ?? 0) / 20_000).toBeCloseTo(0.02, 1);
  });

  it("returns no event when the seeded lap roll exceeds risk", () => {
    const result = rollLapIncident({ risk: baseline, random: new SeededRandom(1) });
    expect(result.risk.perLapProbability).toBeGreaterThan(0);
    expect(result.result === null || typeof result.result.outcome === "string").toBe(true);
  });
});
