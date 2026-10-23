import { describe, expect, it } from "vitest";
import { TIER_CONFIG, type TierId } from "./GameConfig";
import { planMandatoryDryTwoCompoundStrategy } from "./MandatoryDryTyreStrategy";
import { simulateRace } from "./RaceEngine";

const baseInput = {
  totalLaps: 12,
  trackAbrasion: 50,
  trackTemperatureCelsius: 95,
  driverAggression: 50,
  mechanicalGrip: 50,
  driverTyreManagement: 50,
  pitLossSeconds: 20,
};

describe("mandatory dry tyre strategy", () => {
  it("returns a deterministic legal one-stop two-compound strategy for Tiers 1–3", () => {
    for (const tier of [1, 2, 3] as const) {
      const input = { ...baseInput, tier };
      const first = planMandatoryDryTwoCompoundStrategy(input);
      const second = planMandatoryDryTwoCompoundStrategy(input);
      expect(first).toEqual(second);
      expect(first.firstCompound).not.toBe(first.secondCompound);
      expect(TIER_CONFIG[tier].allowedDryCompounds).toContain(first.firstCompound);
      expect(TIER_CONFIG[tier].allowedDryCompounds).toContain(first.secondCompound);
      expect(first.pitLap).toBeGreaterThan(1);
      expect(first.pitLap).toBeLessThan(input.totalLaps);
      expect(first.compoundByLap).toHaveLength(input.totalLaps);
      expect(first.pitStopByLap.filter(Boolean)).toHaveLength(1);
      expect(first.pitStopByLap[first.pitLap - 1]).toBe(true);
      expect(first.pitLossSecondsByLap[first.pitLap - 1]).toBe(input.pitLossSeconds);
      expect(first.compoundByLap.slice(0, first.pitLap - 1).every((compound) => compound === first.firstCompound)).toBe(true);
      expect(first.compoundByLap.slice(first.pitLap - 1).every((compound) => compound === first.secondCompound)).toBe(true);
    }
  });

  it("feeds the selected schedule into the deterministic race kernel", () => {
    const strategy = planMandatoryDryTwoCompoundStrategy({ ...baseInput, tier: 3 });
    const driver = {
      id: "driver-a", name: "Driver A", carScore: 60, driverScore: 60, setupScore: 50,
      formModifier: 0, aggression: baseInput.driverAggression,
      tyreManagement: baseInput.driverTyreManagement, mechanicalGrip: baseInput.mechanicalGrip,
      compound: strategy.firstCompound,
      compoundByLap: strategy.compoundByLap,
      pitStopByLap: strategy.pitStopByLap,
      pitLossSecondsByLap: strategy.pitLossSecondsByLap,
    };
    const opponent = { ...driver, id: "driver-b", name: "Driver B", compound: TIER_CONFIG[3].allowedDryCompounds[0]!,
      compoundByLap: undefined, pitStopByLap: undefined, pitLossSecondsByLap: undefined };
    const result = simulateRace({
      worldSeed: "mandatory-tyre-strategy", season: 1, round: 1, tier: 3,
      estimatedCircuitLapSeconds: 90, totalLaps: baseInput.totalLaps,
      trackAbrasion: baseInput.trackAbrasion, trackTemperatureCelsius: baseInput.trackTemperatureCelsius,
      trackCondition: "dry", referenceSetupScore: 50, drivers: [driver, opponent],
    });
    const driverPitLap = result.laps[strategy.pitLap - 1]!.find((row) => row.driverId === driver.id)!;
    expect(driverPitLap.pitStop).toBe(true);
    expect(driverPitLap.compound).toBe(strategy.secondCompound);
    expect(driverPitLap.pitLossSeconds).toBe(baseInput.pitLossSeconds);
    expect(result.laps).toHaveLength(baseInput.totalLaps);
  });

  it("rejects tiers without the mandatory two-compound dry rule and invalid pit configuration", () => {
    expect(() => planMandatoryDryTwoCompoundStrategy({ ...baseInput, tier: 4 })).toThrow("Tier 1–3");
    expect(() => planMandatoryDryTwoCompoundStrategy({ ...baseInput, tier: 3, pitLossSeconds: 0 })).toThrow("positif");
    expect(() => planMandatoryDryTwoCompoundStrategy({ ...baseInput, tier: 3, totalLaps: 7 })).toThrow("minimal 8 lap");
  });
});
