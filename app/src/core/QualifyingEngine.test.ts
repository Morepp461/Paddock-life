import { describe, expect, it } from "vitest";
import { classifyQualifying, type QualifyingDriver } from "./QualifyingEngine";

const drivers: QualifyingDriver[] = Array.from({ length: 24 }, (_, index) => ({
  driverId: `D${String(index + 1).padStart(2, "0")}`,
  driverName: `Driver ${index + 1}`,
}));

function times(count: number, offset = 0): Record<string, number> {
  return Object.fromEntries(drivers.slice(0, count).map((driver, index) => [driver.driverId, 80 + index + offset]));
}

describe("qualifying classification", () => {
  it("ranks a single-lap tier without inventing extra sessions", () => {
    const result = classifyQualifying({
      tier: 6,
      drivers,
      sessions: [{ bestLapSecondsByDriver: times(24) }],
    });
    expect(result.format).toBe("single-lap");
    expect(result.classification).toHaveLength(24);
    expect(result.classification[0].driverId).toBe("D01");
    expect(result.classification[23].driverId).toBe("D24");
    expect(result.classification.every((entry) => entry.eliminatedIn === null)).toBe(true);
  });

  it("applies the documented 24-to-12 knockout format", () => {
    const q1 = times(24);
    const q2 = Object.fromEntries(drivers.slice(0, 12).map((driver, index) => [driver.driverId, 90 - index]));
    const result = classifyQualifying({
      tier: 3,
      drivers,
      sessions: [{ bestLapSecondsByDriver: q1 }, { bestLapSecondsByDriver: q2 }],
    });
    expect(result.sessionOrder.map((session) => session.length)).toEqual([24, 12]);
    expect(result.classification.slice(0, 12).map((entry) => entry.driverId)).toEqual(
      drivers.slice(0, 12).map((driver) => driver.driverId).reverse(),
    );
    expect(result.classification.slice(12).every((entry) => entry.eliminatedIn === "Q1")).toBe(true);
    expect(result.classification.map((entry) => entry.gridPosition)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("applies Q1 24-to-18, Q2 18-to-12, then Q3 ranking", () => {
    const q1 = times(24);
    const q2 = Object.fromEntries(drivers.slice(0, 18).map((driver, index) => [driver.driverId, 85 + index]));
    const q3 = Object.fromEntries(drivers.slice(0, 12).map((driver, index) => [driver.driverId, 82 + (11 - index)]));
    const result = classifyQualifying({
      tier: 1,
      drivers,
      sessions: [{ bestLapSecondsByDriver: q1 }, { bestLapSecondsByDriver: q2 }, { bestLapSecondsByDriver: q3 }],
    });
    expect(result.sessionOrder.map((session) => session.length)).toEqual([24, 18, 12]);
    expect(result.classification.slice(0, 12).map((entry) => entry.driverId)).toEqual(
      drivers.slice(0, 12).map((driver) => driver.driverId).reverse(),
    );
    expect(result.classification.slice(12, 18).every((entry) => entry.eliminatedIn === "Q2")).toBe(true);
    expect(result.classification.slice(18).every((entry) => entry.eliminatedIn === "Q1")).toBe(true);
  });

  it("rejects missing session times, duplicate drivers, and the wrong session count", () => {
    expect(() => classifyQualifying({ tier: 1, drivers, sessions: [{ bestLapSecondsByDriver: times(24) }] })).toThrow("membutuhkan 3 sesi");
    expect(() => classifyQualifying({
      tier: 6, drivers, sessions: [{ bestLapSecondsByDriver: { D01: 80 } }],
    })).toThrow("Waktu qualifying tidak valid");
    expect(() => classifyQualifying({
      tier: 6, drivers: [...drivers.slice(0, 23), drivers[0]], sessions: [{ bestLapSecondsByDriver: times(24) }],
    })).toThrow("unik");
  });
});
