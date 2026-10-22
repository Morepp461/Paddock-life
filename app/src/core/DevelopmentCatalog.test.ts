import { describe, expect, it } from "vitest";
import {
  CHIEF_ENGINEER_MINIMUM_SKILL,
  DEVELOPMENT_CATALOG,
  getDevelopmentProjectName,
  validateDevelopmentCatalog,
  validateDevelopmentSelection,
} from "./DevelopmentCatalog";

describe("development catalog and eligibility", () => {
  it("contains 36 unique documented projects", () => {
    expect(() => validateDevelopmentCatalog()).not.toThrow();
    expect(DEVELOPMENT_CATALOG).toHaveLength(36);
    expect(new Set(DEVELOPMENT_CATALOG.map((project) => project.id)).size).toBe(36);
  });

  it("enforces tier, project size, engineer skill, and facility requirements", () => {
    expect(validateDevelopmentSelection({
      projectId: "A01", tier: 5, size: "minor", chiefEngineerSkill: 80, facilityLevel: 2,
    })).toMatchObject({ eligible: false });
    expect(validateDevelopmentSelection({
      projectId: "A03", tier: 1, size: "minor", chiefEngineerSkill: 80, facilityLevel: 6,
    }).reasons.some((reason) => reason.includes("tidak tersedia dalam skala"))).toBe(true);
    expect(validateDevelopmentSelection({
      projectId: "E01", tier: 6, size: "minor", chiefEngineerSkill: 20, facilityLevel: 2,
    })).toEqual({ eligible: true, reasons: [] });
    expect(CHIEF_ENGINEER_MINIMUM_SKILL[1].major).toBe(80);
  });

  it("uses kart-specific names in Tier 5–6 and standard names elsewhere", () => {
    expect(getDevelopmentProjectName("E01", 4)).toBe("Engine Calibration");
    expect(getDevelopmentProjectName("E01", 5)).toBe("Karburator/tuning mesin");
    expect(getDevelopmentProjectName("A01", 5)).toBe("Front Wing");
    expect(getDevelopmentProjectName("unknown", 1)).toBeUndefined();
  });

  it("rejects invalid facility levels and missing projects", () => {
    expect(validateDevelopmentSelection({
      projectId: "missing", tier: 1, size: "minor", chiefEngineerSkill: 80, facilityLevel: 2,
    }).eligible).toBe(false);
    expect(validateDevelopmentSelection({
      projectId: "E01", tier: 1, size: "minor", chiefEngineerSkill: 80, facilityLevel: 11,
    }).reasons.some((reason) => reason.includes("Fasilitas"))).toBe(true);
  });
});
