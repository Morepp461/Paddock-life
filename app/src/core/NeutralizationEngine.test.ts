import { describe, expect, it } from "vitest";
import { selectNeutralization } from "./NeutralizationEngine";

const base = {
  worldSeed: "neutralization-test",
  season: 1,
  round: 5,
  totalLaps: 20,
  tier: 1 as const,
  safetyCarProbability: 1,
  vscProbability: 0,
};

describe("safety car and VSC selection", () => {
  it("uses documented safety-car pace, gap compression, pit loss, and rolling restart", () => {
    const result = selectNeutralization(base);
    expect(result).toMatchObject({
      type: "safety-car", paceMultiplier: 1.4, gapCompressionSeconds: 1,
      pitLaneTimeReduction: 0.4, restartType: "rolling",
    });
    expect(result.triggerLap).toBeGreaterThanOrEqual(3);
    expect(result.triggerLap).toBeLessThanOrEqual(17);
  });

  it("uses VSC values supplied by configuration and yellow flags in kart tiers", () => {
    expect(selectNeutralization({ ...base, vscProbability: 1 })).toMatchObject({
      type: "vsc", paceMultiplier: 1.35, gapCompressionSeconds: 0,
      pitLaneTimeReduction: 0.35, restartType: "rolling",
    });
    expect(selectNeutralization({ ...base, tier: 5 }).type).toBe("yellow-flag");
    expect(selectNeutralization({ ...base, tier: 6 }).type).toBe("yellow-flag");
  });

  it("does not trigger without a race event and is deterministic", () => {
    const noEvent = selectNeutralization({ ...base, safetyCarProbability: 0 });
    expect(noEvent).toMatchObject({ type: "none", triggerLap: null, paceMultiplier: 1 });
    expect(selectNeutralization(base)).toEqual(selectNeutralization(base));
  });

  it("allows an incident to force neutralization and rejects invalid probabilities", () => {
    expect(selectNeutralization({ ...base, safetyCarProbability: 0, forcedByIncident: true }).type).toBe("safety-car");
    expect(() => selectNeutralization({ ...base, vscProbability: 2 })).toThrow(RangeError);
    expect(() => selectNeutralization({ ...base, totalLaps: 7 })).toThrow(RangeError);
  });
});
