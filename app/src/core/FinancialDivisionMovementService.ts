import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { calculateFinancialIncomeProjections } from "./FinancialIncomeProjectionEngine";
import { INITIAL_DISTRIBUTIONS } from "./InitialDistributions";
import { resolveFinancialDivisionMovement, type FinancialDivisionMovementResult, type FinancialMovementTeam } from "./FinancialDivisionMovementEngine";
import type { TierId } from "./GameConfig";
import { hashSeed } from "./RandomDistributions";

function n(row: DatabaseRow | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function tierFromDivisionId(value: unknown): TierId {
  const tier = Number(String(value).replace(/^T/, ""));
  if (![1, 2, 3, 4, 5, 6].includes(tier)) throw new Error("Team memiliki division_id yang tidak valid: " + String(value));
  return tier as TierId;
}

/**
 * Applies the source-defined AI team financial movement after every division has
 * completed and settled the season. All team updates, history rows, and the
 * idempotency marker commit atomically.
 */
export async function applyFinancialDivisionMovement(
  database: IDatabase,
  input: { readonly careerId: string; readonly completedSeason: number },
): Promise<FinancialDivisionMovementResult> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.completedSeason) || input.completedSeason < 1) {
    throw new RangeError("Career ID dan completed season harus valid.");
  }
  const nextSeason = input.completedSeason + 1;
  const [raceCounts, settlementCount, priorStep, teamRows, sponsorRows, popularityRows] = await Promise.all([
    database.query(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM races WHERE season = ?;",
      [input.completedSeason],
    ),
    database.query("SELECT COUNT(*) AS count FROM season_settlements WHERE career_id = ? AND season = ?;", [input.careerId, input.completedSeason]),
    database.query("SELECT step FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'financial-movement';", [input.careerId, nextSeason]),
    database.query(
      `SELECT team_id, division_id, is_player_team, is_active, cash, debt, reputation,
        distress_seasons, severe_distress_seasons, movement_cooldown
       FROM teams WHERE career_id = ? AND is_active = 1 ORDER BY team_id;`,
      [input.careerId],
    ),
    database.query(
      `SELECT ts.team_id, SUM(ts.contract_value) AS sponsor_revenue
       FROM team_sponsors ts
       JOIN sponsor_pool sp ON sp.sponsor_id = ts.sponsor_id
       JOIN teams t ON t.team_id = ts.team_id
       WHERE t.career_id = ? AND t.is_active = 1 AND ts.is_active = 1
         AND ts.start_season <= ? AND ts.end_season >= ?
         AND t.reputation >= sp.min_team_reputation
       GROUP BY ts.team_id;`,
      [input.careerId, nextSeason, nextSeason],
    ),
    database.query(
      `SELECT t.team_id, AVG(d.fan_popularity) AS average_popularity
       FROM teams t
       JOIN driver_contracts dc ON dc.team_id = t.team_id AND dc.start_season <= ? AND dc.end_season >= ?
       JOIN drivers d ON d.driver_id = dc.driver_id AND d.is_retired = 0 AND d.is_academy_driver = 0
       WHERE t.career_id = ? AND t.is_active = 1
       GROUP BY t.team_id;`,
      [input.completedSeason, input.completedSeason, input.careerId],
    ),
  ]);

  const totalRaces = n(raceCounts[0], "total");
  const completedRaces = n(raceCounts[0], "completed");
  if (totalRaces < 1 || completedRaces !== totalRaces) {
    throw new Error("Financial division movement requires all six divisions to finish every race first.");
  }
  if (n(settlementCount[0], "count") !== 72) {
    throw new Error("Financial division movement requires all 72 team season settlements to be committed first.");
  }
  if (priorStep.length) throw new Error("Financial division movement has already been applied for season " + nextSeason + ".");
  if (teamRows.length !== 72) throw new Error("Expected exactly 72 active AI/player teams before division movement.");

  const sponsorByTeam = new Map(sponsorRows.map((row) => [String(row.team_id), n(row, "sponsor_revenue")]));
  const popularityByTeam = new Map(popularityRows.map((row) => [String(row.team_id), n(row, "average_popularity")]));
  const movementInput: FinancialMovementTeam[] = teamRows.map((row) => {
    const teamId = String(row.team_id);
    const projections = calculateFinancialIncomeProjections({
      activeSponsorRevenue: sponsorByTeam.get(teamId) ?? 0,
      averageDriverFanPopularity: popularityByTeam.get(teamId) ?? 0,
    });
    return {
      teamId,
      tier: tierFromDivisionId(row.division_id),
      isPlayerTeam: n(row, "is_player_team") === 1,
      isActive: n(row, "is_active") === 1,
      cash: n(row, "cash"),
      debt: n(row, "debt"),
      projectedIncomeByTier: projections.byTier,
      reputation: n(row, "reputation"),
      distressSeasons: n(row, "distress_seasons"),
      severeDistressSeasons: n(row, "severe_distress_seasons"),
      movementCooldown: n(row, "movement_cooldown"),
    };
  });
  const result = resolveFinancialDivisionMovement(movementInput);

  await database.transaction(async () => {
    const concurrentStep = await database.query(
      "SELECT step FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'financial-movement';",
      [input.careerId, nextSeason],
    );
    if (concurrentStep.length) throw new Error("Financial division movement has already been applied for season " + nextSeason + ".");

    for (const team of result.teams) {
      await database.run(
        `UPDATE teams
         SET division_id = ?, is_active = ?, affordability = ?, distress_seasons = ?,
             severe_distress_seasons = ?, movement_cooldown = ?, budget = ?
         WHERE team_id = ? AND career_id = ?;`,
        ["T" + team.tier, team.isActive ? 1 : 0, team.affordability, team.nextDistressSeasons,
          team.nextSevereDistressSeasons, team.nextMovementCooldown,
          INITIAL_DISTRIBUTIONS[team.tier].requiredBudget, team.teamId, input.careerId],
      );
    }

    for (const event of result.events) {
      const historyId = "division_" + hashSeed([
        input.careerId, nextSeason, event.teamId, event.fromTier, event.toTier ?? "bankruptcy", event.reason,
      ]).toString(16).padStart(8, "0");
      await database.run(
        `INSERT INTO team_division_history
          (history_id, career_id, team_id, season, from_tier, to_tier, reason, affordability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [historyId, input.careerId, event.teamId, nextSeason, event.fromTier, event.toTier, event.reason, event.affordability],
      );
    }

    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, 'financial-movement', ?);",
      [input.careerId, nextSeason, JSON.stringify({
        events: result.events,
        newTier6SlotsNeeded: result.newTier6SlotsNeeded,
        activeTeamsByTier: [1, 2, 3, 4, 5, 6].map((tier) => ({
          tier,
          count: result.teams.filter((team) => team.isActive && team.tier === tier).length,
        })),
      })],
    );
  });

  return result;
}
