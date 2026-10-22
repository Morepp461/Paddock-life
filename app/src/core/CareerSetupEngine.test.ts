import { describe, expect, it } from "vitest";
import {
  getNewTeamCareerTiers,
  getTakeoverCareerTiers,
  validateCareerSetupDraft,
  type CareerSetupValidationContext,
} from "./CareerSetupEngine";

const context: CareerSetupValidationContext = {
  availableCountryCodes: new Set(["ID", "GB", "IT"]),
  blockedManagerNames: new Set(["blocked manager"]),
  blockedTeamNames: new Set(["real racing team"]),
  existingTeamNames: new Set(["existing team"]),
  existingTeamCodes: new Set(["EXT"]),
  teamPool: [
    { teamId: "T5-WEAK", tier: 5, name: "Weak Team", strength: "Lemah" },
    { teamId: "T5-MED", tier: 5, name: "Mid Team", strength: "Menengah" },
    { teamId: "T5-STRONG", tier: 5, name: "Strong Team", strength: "Kuat" },
    { teamId: "T3-WEAK", tier: 3, name: "Tier Three Team", strength: "Lemah" },
    { teamId: "T1-TAKEOVER", tier: 1, name: "Top Team", strength: "Kuat" },
    { teamId: "T6-HIDDEN", tier: 6, name: "Hidden Team", strength: "Lemah" },
  ],
};

const baseDraft = {
  managerName: "Alex Driver",
  managerCountryCode: "ID",
  difficulty: "normal" as const,
  path: "new-team" as const,
  worldSeed: "career-seed-001",
  newTeam: {
    name: "Northstar Racing",
    code: "NOR",
    countryCode: "ID",
    tier: 5 as const,
    replacedTeamId: "T5-WEAK",
  },
};

describe("career setup validation", () => {
  it("exposes only documented starting tiers", () => {
    expect(getNewTeamCareerTiers()).toEqual([5, 4, 3]);
    expect(getTakeoverCareerTiers()).toEqual([5, 4, 3, 2, 1]);
  });

  it("validates a new team and keeps the initial unlock at Tier 3", () => {
    expect(validateCareerSetupDraft(baseDraft, context)).toMatchObject({
      path: "new-team",
      selectedTier: 5,
      highestUnlockedTier: 3,
      newTeam: { name: "Northstar Racing", code: "NOR", replacedTeamId: "T5-WEAK" },
    });
  });

  it("rejects a manager name outside the documented character set or blocked list", () => {
    expect(() => validateCareerSetupDraft({ ...baseDraft, managerName: "A" }, context)).toThrow(/2–24/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, managerName: "Blocked Manager" }, context)).toThrow(/tidak dapat digunakan/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, managerName: "Alex@Driver" }, context)).toThrow(/huruf, angka/);
  });

  it("rejects unavailable country codes and invalid difficulty", () => {
    expect(() => validateCareerSetupDraft({ ...baseDraft, managerCountryCode: "XX" }, context)).toThrow(/daftar negara/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, difficulty: "impossible" as never }, context)).toThrow(/kesulitan/);
  });

  it("rejects blocked, duplicate, or invalid team names and codes", () => {
    expect(() => validateCareerSetupDraft({ ...baseDraft, newTeam: { ...baseDraft.newTeam, name: "Real Racing Team" } }, context)).toThrow(/tidak dapat digunakan/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, newTeam: { ...baseDraft.newTeam, name: "Existing Team" } }, context)).toThrow(/sudah dipakai/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, newTeam: { ...baseDraft.newTeam, code: "EXT" } }, context)).toThrow(/sudah dipakai/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, newTeam: { ...baseDraft.newTeam, code: "NO" } }, context)).toThrow(/3 huruf/);
  });

  it("requires replacement team in the same tier and rejects strong teams", () => {
    expect(() => validateCareerSetupDraft({ ...baseDraft, newTeam: { ...baseDraft.newTeam, replacedTeamId: "T3-WEAK" } }, context)).toThrow(/tier yang sama/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, newTeam: { ...baseDraft.newTeam, replacedTeamId: "T5-STRONG" } }, context)).toThrow(/Lemah atau Menengah/);
  });

  it("validates takeover tiers and inherits the selected team's tier", () => {
    const draft = { ...baseDraft, path: "takeover" as const, takeoverTeamId: "T1-TAKEOVER", newTeam: undefined };
    expect(validateCareerSetupDraft(draft, context)).toMatchObject({ path: "takeover", selectedTier: 1, highestUnlockedTier: 1 });
    expect(() => validateCareerSetupDraft({ ...draft, takeoverTeamId: "T6-HIDDEN" }, context)).toThrow(/Tier 6/);
  });

  it("requires a non-empty bounded world seed", () => {
    expect(() => validateCareerSetupDraft({ ...baseDraft, worldSeed: " " }, context)).toThrow(/World seed/);
    expect(() => validateCareerSetupDraft({ ...baseDraft, worldSeed: "x".repeat(129) }, context)).toThrow(/World seed/);
  });
});
