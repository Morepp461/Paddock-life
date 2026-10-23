import { describe, expect, it } from "vitest";
import { INITIAL_DISTRIBUTIONS } from "./InitialDistributions";
import { resolveFinancialDivisionMovement, type FinancialMovementTeam } from "./FinancialDivisionMovementEngine";

function world(): FinancialMovementTeam[] {
  const teams: FinancialMovementTeam[] = [];
  for (const tier of [1, 2, 3, 4, 5, 6] as const) {
    for (let index = 0; index < 12; index += 1) {
      teams.push({
        teamId: "T" + tier + "-" + String(index + 1).padStart(2, "0"),
        tier,
        isPlayerTeam: false,
        isActive: true,
        cash: INITIAL_DISTRIBUTIONS[tier].requiredBudget,
        debt: 0,
        projectedIncomeByTier: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        reputation: INITIAL_DISTRIBUTIONS[tier].reputationRange[0] + 100,
        distressSeasons: 0,
        severeDistressSeasons: 0,
        movementCooldown: 0,
      });
    }
  }
  return teams;
}

function byId(result: ReturnType<typeof resolveFinancialDivisionMovement>, teamId: string) {
  return result.teams.find((team) => team.teamId === teamId)!;
}

describe("financial division movement", () => {
  it("keeps a stable world unchanged when every team is financially healthy", () => {
    const result = resolveFinancialDivisionMovement(world());
    expect(result.events).toHaveLength(0);
    expect(result.newTier6SlotsNeeded).toBe(0);
    for (const tier of [1, 2, 3, 4, 5, 6] as const) {
      expect(result.teams.filter((team) => team.isActive && team.tier === tier)).toHaveLength(12);
    }
  });

  it("relegates a severely distressed AI team and fills the resulting vacancy through a financial promotion", () => {
    const teams = world();
    const index = teams.findIndex((team) => team.teamId === "T1-01");
    teams[index] = { ...teams[index]!, cash: -100_000_000 };
    const result = resolveFinancialDivisionMovement(teams);
    expect(byId(result, "T1-01").tier).toBe(2);
    expect(result.events.find((event) => event.teamId === "T1-01")?.reason).toBe("financial_relegation");
    expect(result.events.some((event) => event.reason === "financial_promotion" && event.toTier === 1)).toBe(true);
    for (const tier of [1, 2, 3, 4, 5] as const) {
      expect(result.teams.filter((team) => team.isActive && team.tier === tier)).toHaveLength(12);
    }
  });

  it("never financially relegates the player's team", () => {
    const teams = world();
    const index = teams.findIndex((team) => team.teamId === "T3-01");
    teams[index] = { ...teams[index]!, isPlayerTeam: true, cash: -100_000_000 };
    const result = resolveFinancialDivisionMovement(teams);
    expect(byId(result, "T3-01").tier).toBe(3);
    expect(result.events.some((event) => event.teamId === "T3-01")).toBe(false);
  });

  it("respects movement cooldown for ordinary distress but allows severe financial relegation", () => {
    const teams = world();
    const ordinary = teams.findIndex((team) => team.teamId === "T2-01");
    teams[ordinary] = { ...teams[ordinary]!, cash: 0, projectedIncomeByTier: { 1: 0, 2: INITIAL_DISTRIBUTIONS[2].requiredBudget * 0.8, 3: 0, 4: 0, 5: 0, 6: 0 }, distressSeasons: 1, movementCooldown: 2 };
    const severe = teams.findIndex((team) => team.teamId === "T3-01");
    teams[severe] = { ...teams[severe]!, cash: 0, movementCooldown: 2 };
    const result = resolveFinancialDivisionMovement(teams);
    expect(byId(result, "T2-01").tier).toBe(2);
    expect(byId(result, "T2-01").nextMovementCooldown).toBe(1);
    expect(byId(result, "T3-01").tier).toBe(4);
  });

  it("refuses to break movement cooldown when no lower-tier promotion candidate is eligible", () => {
    const teams = world().map((team) => team.tier === 2 ? { ...team, movementCooldown: 2 } : team);
    const index = teams.findIndex((team) => team.teamId === "T1-01");
    teams[index] = { ...teams[index]!, cash: -100_000_000 };
    expect(() => resolveFinancialDivisionMovement(teams)).toThrow("without violating movement cooldown");
  });

  it("folds a Tier 6 AI team after two consecutive severe-distress seasons and reports the replacement slot", () => {
    const teams = world();
    const index = teams.findIndex((team) => team.teamId === "T6-01");
    teams[index] = { ...teams[index]!, cash: 0, severeDistressSeasons: 1 };
    const result = resolveFinancialDivisionMovement(teams);
    expect(byId(result, "T6-01").isActive).toBe(false);
    expect(result.events.find((event) => event.teamId === "T6-01")?.reason).toBe("bankruptcy");
    expect(result.newTier6SlotsNeeded).toBe(1);
  });

  it("rejects an incomplete or duplicate world before making movement decisions", () => {
    expect(() => resolveFinancialDivisionMovement(world().slice(0, 71))).toThrow("exactly 72 teams");
    const teams = world();
    teams[1] = { ...teams[1]!, teamId: teams[0]!.teamId };
    expect(() => resolveFinancialDivisionMovement(teams)).toThrow("duplikat");
  });
});
