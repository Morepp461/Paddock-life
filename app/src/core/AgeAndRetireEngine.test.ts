import { describe, expect, it } from "vitest";
import { evaluateAgeAndRetirement, evaluateStaffCandidateOutcome, hasTwoSeasonsWithoutTeam } from "./AgeAndRetireEngine";

describe("age and retirement engine", () => {
  it("ages entities once and applies the documented driver retirement probability", () => {
    const input = { worldSeed: "age-test", season: 2, entityId: "driver-34", kind: "driver" as const, age: 34, tier: 1 as const };
    const first = evaluateAgeAndRetirement(input);
    const second = evaluateAgeAndRetirement(input);
    expect(first.ageAfter).toBe(35);
    expect(first.retirementProbability).toBe(0.05);
    expect(first.shouldRetire).toBe(second.shouldRetire);
    expect(first.becomesStaff).toBe(second.becomesStaff);
  });

  it("forces drivers to retire after age 45 and flags out-of-band drivers for a higher-tier move", () => {
    const veteran = evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 3, entityId: "veteran", kind: "driver", age: 45, tier: 1,
    });
    expect(veteran.ageAfter).toBe(46);
    expect(veteran.shouldRetire).toBe(true);
    expect(veteran.retirementProbability).toBe(1);
    expect(veteran.retirementReason).toBe("age");

    const kartDriver = evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 2, entityId: "kart-driver", kind: "driver", age: 14, tier: 5,
    });
    expect(kartDriver.ageAfter).toBe(15);
    expect(kartDriver.outsideCurrentTierAgeBand).toBe(true);
    expect(kartDriver.eligibleForHigherTierMove).toBe(true);
  });

  it("forces staff and AI managers to retire at 81 but never retires the player manager for age", () => {
    const staff = evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 4, entityId: "staff-80", kind: "staff", age: 80,
    });
    expect(staff.ageAfter).toBe(81);
    expect(staff.shouldRetire).toBe(true);

    const manager = evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 4, entityId: "ai-manager-80", kind: "ai-manager", age: 80,
    });
    expect(manager.shouldRetire).toBe(true);

    const player = evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 30, entityId: "player-manager", kind: "player-manager", age: 81,
    });
    expect(player.ageAfter).toBe(81);
    expect(player.shouldRetire).toBe(false);
  });

  it("retires a driver only after two full seasons without a team", () => {
    expect(hasTwoSeasonsWithoutTeam({
      createdSeason: 1, completedSeason: 1, hasTeamThisSeason: false, hadTeamPreviousSeason: false,
    })).toBe(false);
    expect(hasTwoSeasonsWithoutTeam({
      createdSeason: 2, completedSeason: 2, hasTeamThisSeason: false, hadTeamPreviousSeason: false,
    })).toBe(false);
    expect(hasTwoSeasonsWithoutTeam({
      createdSeason: 1, completedSeason: 2, hasTeamThisSeason: false, hadTeamPreviousSeason: false,
    })).toBe(true);
    expect(hasTwoSeasonsWithoutTeam({
      createdSeason: 1, completedSeason: 2, hasTeamThisSeason: true, hadTeamPreviousSeason: false,
    })).toBe(false);
    expect(hasTwoSeasonsWithoutTeam({
      createdSeason: null, completedSeason: 5, hasTeamThisSeason: false, hadTeamPreviousSeason: false,
    })).toBe(false);
  });

  it("uses a deterministic 40% staff-candidate roll", () => {
    const input = { worldSeed: "retirement-candidate-test", season: 4, entityId: "driver-22" };
    expect(evaluateStaffCandidateOutcome(input)).toBe(evaluateStaffCandidateOutcome(input));
    expect(() => evaluateStaffCandidateOutcome({ ...input, season: 0 })).toThrow("Season harus");
  });

  it("rejects missing driver tier and invalid input", () => {
    expect(() => evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 1, entityId: "driver", kind: "driver", age: 20,
    })).toThrow("Tier wajib");
    expect(() => evaluateAgeAndRetirement({
      worldSeed: "age-test", season: 0, entityId: "driver", kind: "driver", age: 20, tier: 1,
    })).toThrow("Season harus");
  });
});
