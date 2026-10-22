import { describe, expect, it } from "vitest";
import { SeededRandom } from "./SeededRandom";
describe("SeededRandom", () => {
  it("repeats a sequence for the same seed", () => {
    const a = new SeededRandom(20261022); const b = new SeededRandom(20261022);
    expect(Array.from({ length: 100 }, () => a.nextUint32())).toEqual(Array.from({ length: 100 }, () => b.nextUint32()));
  });
  it("produces values in [0, 1)", () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 1000; i += 1) { const value = rng.next(); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); }
  });
  it("rejects non-integer seeds", () => { expect(() => new SeededRandom(1.5)).toThrow("safe integer"); });
});
