import { INITIAL_DISTRIBUTIONS } from "./InitialDistributions";
import type { TierId } from "./GameConfig";

export interface FinancialMovementTeam {
  readonly teamId: string;
  readonly tier: TierId;
  readonly isPlayerTeam: boolean;
  readonly isActive: boolean;
  readonly cash: number;
  readonly debt: number;
  readonly projectedIncomeByTier: Readonly<Record<TierId, number>>;
  readonly reputation: number;
  readonly distressSeasons: number;
  readonly severeDistressSeasons: number;
  readonly movementCooldown: number;
}

export interface FinancialMovementTeamResult extends FinancialMovementTeam {
  readonly affordability: number;
  readonly nextDistressSeasons: number;
  readonly nextSevereDistressSeasons: number;
  readonly nextMovementCooldown: number;
}

export interface DivisionMovementEvent {
  readonly teamId: string;
  readonly fromTier: TierId;
  readonly toTier: TierId | null;
  readonly reason: "financial_relegation" | "financial_promotion" | "bankruptcy";
  readonly affordability: number;
}

export interface FinancialDivisionMovementResult {
  readonly teams: readonly FinancialMovementTeamResult[];
  readonly events: readonly DivisionMovementEvent[];
  readonly newTier6SlotsNeeded: number;
}

const DISTRESS_THRESHOLD = 1.0;
const SEVERE_THRESHOLD = 0.5;
const DISTRESS_SEASONS_TO_RELEGATE = 2;
const PROMOTION_MIN_AFFORDABILITY = 1.2;
const MOVEMENT_COOLDOWN_SEASONS = 2;
const DEBT_WEIGHT = 1.0;
const TIER6_FOLD_SEASONS = 2;

function requiredBudget(tier: TierId): number {
  return INITIAL_DISTRIBUTIONS[tier].requiredBudget;
}

function affordability(team: FinancialMovementTeam, targetTier: TierId): number {
  return (team.cash + team.projectedIncomeByTier[targetTier] - team.debt * DEBT_WEIGHT) / requiredBudget(targetTier);
}

function reputationThreshold(tier: TierId): number {
  return INITIAL_DISTRIBUTIONS[tier].reputationRange[0];
}

/**
 * Implements the source-defined AI team movement rules from PRD_Game_Designv4 §6.4.
 * The caller supplies projected income; this function does not invent sponsor/prize forecasts.
 * Player teams are never financially relegated.
 */
export function resolveFinancialDivisionMovement(
  inputTeams: readonly FinancialMovementTeam[],
): FinancialDivisionMovementResult {
  if (inputTeams.length !== 72) throw new Error("Financial movement requires exactly 72 teams across six tiers.");
  const ids = new Set<string>();
  const counts = new Map<TierId, number>([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
  for (const team of inputTeams) {
    if (!team.teamId.trim() || ids.has(team.teamId)) throw new Error("Team ID kosong atau duplikat.");
    ids.add(team.teamId);
    counts.set(team.tier, (counts.get(team.tier) ?? 0) + 1);
    for (const [label, value] of [
      ["cash", team.cash], ["debt", team.debt],
      ["projectedIncome:T1", team.projectedIncomeByTier[1]], ["projectedIncome:T2", team.projectedIncomeByTier[2]],
      ["projectedIncome:T3", team.projectedIncomeByTier[3]], ["projectedIncome:T4", team.projectedIncomeByTier[4]],
      ["projectedIncome:T5", team.projectedIncomeByTier[5]], ["projectedIncome:T6", team.projectedIncomeByTier[6]],
      ["reputation", team.reputation], ["distressSeasons", team.distressSeasons],
      ["severeDistressSeasons", team.severeDistressSeasons], ["movementCooldown", team.movementCooldown],
    ] as const) {
      if (!Number.isFinite(value)) throw new RangeError(label + " must be finite.");
    }
    if (team.debt < 0 || team.reputation < 0 || team.distressSeasons < 0 ||
        team.severeDistressSeasons < 0 || team.movementCooldown < 0) {
      throw new RangeError("Debt, reputation, distress counters, and cooldown cannot be negative.");
    }
  }
  for (const tier of [1, 2, 3, 4, 5, 6] as const) {
    if (counts.get(tier) !== 12) throw new Error("Tier " + tier + " must start with exactly 12 teams.");
  }

  const working = new Map<string, FinancialMovementTeamResult>();
  for (const team of inputTeams) {
    const currentAffordability = affordability(team, team.tier);
    const nextDistressSeasons = currentAffordability < DISTRESS_THRESHOLD ? team.distressSeasons + 1 : 0;
    const nextSevereDistressSeasons = currentAffordability < SEVERE_THRESHOLD ? team.severeDistressSeasons + 1 : 0;
    working.set(team.teamId, {
      ...team,
      affordability: currentAffordability,
      nextDistressSeasons,
      nextSevereDistressSeasons,
      nextMovementCooldown: team.movementCooldown,
    });
  }

  const events: DivisionMovementEvent[] = [];
  const movedThisSeason = new Set<string>();
  const bankrupt = new Set<string>();

  for (const team of inputTeams) {
    const state = working.get(team.teamId)!;
    if (team.isPlayerTeam || !team.isActive) continue;
    if (team.tier === 6 && state.nextSevereDistressSeasons >= TIER6_FOLD_SEASONS) {
      bankrupt.add(team.teamId);
      movedThisSeason.add(team.teamId);
      events.push({
        teamId: team.teamId, fromTier: 6, toTier: null, reason: "bankruptcy",
        affordability: state.affordability,
      });
      working.set(team.teamId, { ...state, isActive: false, nextMovementCooldown: 0 });
      continue;
    }
    if (team.tier === 6) continue;
    const severe = state.affordability < SEVERE_THRESHOLD;
    const repeatedDistress = state.nextDistressSeasons >= DISTRESS_SEASONS_TO_RELEGATE;
    const cooldownBlocksMove = team.movementCooldown > 0 && !severe;
    if ((severe || repeatedDistress) && !cooldownBlocksMove) {
      const toTier = (team.tier + 1) as TierId;
      movedThisSeason.add(team.teamId);
      events.push({
        teamId: team.teamId, fromTier: team.tier, toTier, reason: "financial_relegation",
        affordability: affordability(team, toTier),
      });
      working.set(team.teamId, {
        ...state, tier: toTier, affordability: affordability(team, toTier),
        nextMovementCooldown: MOVEMENT_COOLDOWN_SEASONS,
      });
    }
  }

  // Fill each upper-tier vacancy from the next tier, continuing downward as a chain.
  for (const upperTier of [1, 2, 3, 4, 5] as const) {
    const upperCount = [...working.values()].filter((team) => team.isActive && team.tier === upperTier).length;
    const vacancies = Math.max(0, 12 - upperCount);
    for (let slot = 0; slot < vacancies; slot += 1) {
      const lowerTier = (upperTier + 1) as TierId;
      const candidates = [...working.values()].filter((team) =>
        team.isActive && !team.isPlayerTeam && team.tier === lowerTier && !movedThisSeason.has(team.teamId));
      if (!candidates.length) continue;
      const ranked = candidates.map((team) => {
        const source = inputTeams.find((item) => item.teamId === team.teamId)!;
        return { team, source, targetAffordability: affordability(source, upperTier) };
      }).sort((a, b) => b.targetAffordability - a.targetAffordability || b.team.reputation - a.team.reputation || a.team.teamId.localeCompare(b.team.teamId));
      const eligible = ranked.filter((candidate) =>
        candidate.team.nextMovementCooldown === 0 &&
        candidate.targetAffordability >= PROMOTION_MIN_AFFORDABILITY &&
        candidate.team.reputation >= reputationThreshold(upperTier));
      const selected = eligible[0] ?? ranked.find((candidate) => candidate.team.nextMovementCooldown === 0) ?? ranked[0]!;
      const fromTier = selected.team.tier;
      movedThisSeason.add(selected.team.teamId);
      events.push({
        teamId: selected.team.teamId, fromTier, toTier: upperTier, reason: "financial_promotion",
        affordability: selected.targetAffordability,
      });
      working.set(selected.team.teamId, {
        ...selected.team,
        tier: upperTier,
        affordability: selected.targetAffordability,
        nextMovementCooldown: MOVEMENT_COOLDOWN_SEASONS,
      });
    }
  }

  // Bankruptcy and movement can leave Tier 6 short; a separate name/team generator fills these slots.
  const activeTier6Count = [...working.values()].filter((team) => team.isActive && team.tier === 6).length;
  const results = [...working.values()].map((team) => {
    const currentAffordability = affordability(team, team.tier);
    const moved = movedThisSeason.has(team.teamId);
    const source = inputTeams.find((item) => item.teamId === team.teamId)!;
    const nextDistressSeasons = !team.isActive ? 0
      : moved ? (currentAffordability < DISTRESS_THRESHOLD ? 1 : 0)
      : team.nextDistressSeasons;
    const nextSevereDistressSeasons = !team.isActive ? 0
      : moved ? (currentAffordability < SEVERE_THRESHOLD ? 1 : 0)
      : team.nextSevereDistressSeasons;
    const nextMovementCooldown = !team.isActive ? 0
      : moved ? team.nextMovementCooldown
      : Math.max(0, source.movementCooldown - 1);
    return {
      ...team,
      affordability: currentAffordability,
      nextDistressSeasons,
      nextSevereDistressSeasons,
      nextMovementCooldown,
    };
  }).sort((a, b) => a.tier - b.tier || a.teamId.localeCompare(b.teamId));

  for (const tier of [1, 2, 3, 4, 5] as const) {
    const count = results.filter((team) => team.isActive && team.tier === tier).length;
    if (count !== 12) {
      throw new Error("Financial movement could not preserve 12 teams in Tier " + tier + "; transition must roll back instead of saving an invalid world.");
    }
  }
  return { teams: results, events, newTier6SlotsNeeded: Math.max(0, 12 - activeTier6Count) };
}
