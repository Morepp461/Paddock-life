import { describe, expect, it } from "vitest";
import { availableTyreCompounds, parseTrackCondition, recommendedTyreCompound } from "./RaceTyreSelection";

describe("race tyre selection", () => {
  it("parses only supported scheduled track conditions", () => {
    expect(parseTrackCondition("dry")).toBe("dry");
    expect(parseTrackCondition("heavy-wet")).toBe("heavy-wet");
    expect(parseTrackCondition(null)).toBe("dry");
    expect(() => parseTrackCondition("storm")).toThrow("Kondisi lintasan tidak dikenal");
  });

  it("filters slicks when the circuit is heavy-wet", () => {
    const compounds = availableTyreCompounds(1, "heavy-wet");
    expect(compounds).toContain("intermediate");
    expect(compounds).toContain("wet");
    expect(compounds).not.toContain("soft");
    expect(compounds).not.toContain("medium");
    expect(compounds).not.toContain("hard");
  });

  it("respects the tier's available compounds when recommending a wet tyre", () => {
    expect(recommendedTyreCompound(1, "dry")).toBe("soft");
    expect(recommendedTyreCompound(1, "damp")).toBe("intermediate");
    expect(recommendedTyreCompound(5, "wet")).toBe("wet");
    expect(availableTyreCompounds(5, "heavy-wet")).toEqual(["wet"]);
    expect(availableTyreCompounds(6, "heavy-wet")).toEqual(["wet"]);
  });
});
