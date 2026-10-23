import type { IDatabase } from "../storage/IDatabase";
import { evaluateBoardSeason, type BoardDifficulty } from "./BoardObjectiveEngine";
import { INITIAL_DISTRIBUTIONS } from "./InitialDistributions";
import type { TierId } from "./GameConfig";
import { hashSeed } from "./RandomDistributions";

type Row = Readonly<Record<string, unknown>>;
type PlayableTier = Exclude<TierId, 6>;

const GRADE_ORDER: Readonly<Record<string, number>> = { A: 0, B: 1, C: 2, D: 3 };

function num(row: Row | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function asTier(value: unknown): TierId {
  const tier = Number(String(value).replace(/^T/, ""));
  if (![1, 2, 3, 4, 5, 6].includes(tier)) throw new Error("Tier board objective tidak valid.");
  return tier as TierId;
}
function stableId(seed: string, kind: string, key: string | number): string {
  return kind + "_" + hashSeed([seed, kind, key]).toString(16).padStart(8, "0");
}

async function expectedTeamRank(
  database: IDatabase,
  input: { careerId: string; teamId: string; tier: PlayableTier; season: number },
): Promise<number> {
  const rows = await database.query(
    `SELECT t.team_id, t.strength_grade, t.performance_grade, t.finance_grade,
      CASE WHEN t.budget > 0 THEN t.cash * 1.0 / t.budget ELSE 0 END AS cash_ratio,
      AVG((COALESCE(c.engine_power, 0) + COALESCE(c.aero, 0) + COALESCE(c.high_speed, 0) +
           COALESCE(c.medium_speed, 0) + COALESCE(c.low_speed, 0) + COALESCE(c.mechanical_grip, 0) +
           COALESCE(c.traction, 0) + COALESCE(c.braking, 0) + COALESCE(c.tyre_management, 0)) / 9.0) AS car_score,
      AVG((COALESCE(d.pace, 0) + COALESCE(d.qualifying, 0) + COALESCE(d.racecraft, 0) +
           COALESCE(d.consistency, 0) + COALESCE(d.wet_skill, 0) + COALESCE(d.tyre_management, 0) +
           COALESCE(d.overtaking, 0) + COALESCE(d.defending, 0) + COALESCE(d.starts, 0) +
           COALESCE(d.adaptability, 0)) / 10.0) AS driver_score
     FROM teams t
     LEFT JOIN cars c ON c.team_id = t.team_id AND c.season = ?
     LEFT JOIN driver_contracts dc ON dc.team_id = t.team_id AND dc.start_season <= ? AND dc.end_season >= ?
     LEFT JOIN drivers d ON d.driver_id = dc.driver_id AND d.is_retired = 0 AND d.is_academy_driver = 0
     WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1
     GROUP BY t.team_id
     ORDER BY t.team_id;`,
    [input.season, input.season, input.season, input.careerId, "T" + input.tier],
  );
  if (rows.length !== 12) throw new Error("Board objective mengharapkan tepat 12 tim aktif di divisi.");
  const ordered = [...rows].sort((left, right) =>
    (GRADE_ORDER[String(left.strength_grade)] ?? 9) - (GRADE_ORDER[String(right.strength_grade)] ?? 9) ||
    (GRADE_ORDER[String(left.performance_grade)] ?? 9) - (GRADE_ORDER[String(right.performance_grade)] ?? 9) ||
    (GRADE_ORDER[String(left.finance_grade)] ?? 9) - (GRADE_ORDER[String(right.finance_grade)] ?? 9) ||
    num(right, "driver_score") - num(left, "driver_score") ||
    num(right, "car_score") - num(left, "car_score") ||
    num(right, "cash_ratio") - num(left, "cash_ratio") ||
    String(left.team_id).localeCompare(String(right.team_id)),
  );
  const index = ordered.findIndex((row) => String(row.team_id) === input.teamId);
  if (index < 0) throw new Error("Tim pemain tidak ditemukan dalam ranking kekuatan divisi.");
  return index + 1;
}

/** Creates season objectives from source-defined team strength grades and actual car, finance, and driver attributes. */
export async function createBoardObjectivesForTeam(
  database: IDatabase,
  input: { readonly careerId: string; readonly teamId: string; readonly season: number },
): Promise<{ readonly expectedRank: number; readonly primaryTargetRank: number; readonly hasUnlockObjective: boolean } | null> {
  const [careerRows, teamRows, managerRows] = await Promise.all([
    database.query("SELECT world_seed, difficulty, highest_unlocked_tier, game_mode FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT division_id, is_active FROM teams WHERE career_id = ? AND team_id = ?;", [input.careerId, input.teamId]),
    database.query("SELECT confidence, reputation, consecutive_primary_misses FROM career_managers WHERE career_id = ? AND is_player = 1 AND team_id = ? AND status = 'active';", [input.careerId, input.teamId]),
  ]);
  const career = careerRows[0], team = teamRows[0], manager = managerRows[0];
  if (!career || !team || !Number(team.is_active)) throw new Error("Career atau tim board objective tidak ditemukan.");
  if (!manager) return null;
  const tier = asTier(team.division_id);
  if (tier === 6) return null;
  const playableTier = tier as PlayableTier;
  const expectedRank = await expectedTeamRank(database, {
    careerId: input.careerId, teamId: input.teamId, tier: playableTier, season: input.season,
  });
  const requiredBudget = INITIAL_DISTRIBUTIONS[playableTier].requiredBudget;
  const higherDivisionUnlocked = num(career, "highest_unlocked_tier", 3) < playableTier;
  const evaluation = evaluateBoardSeason({
    tier: playableTier,
    difficulty: String(career.difficulty) as BoardDifficulty,
    expectedRank,
    constructorPosition: expectedRank,
    closingCash: num(team, "cash", requiredBudget),
    requiredBudget,
    currentConfidence: num(manager, "confidence", 60),
    currentManagerReputation: num(manager, "reputation"),
    previousPrimaryMisses: num(manager, "consecutive_primary_misses"),
    season: input.season,
    isSandbox: String(career.game_mode) === "sandbox",
    higherDivisionUnlocked,
  });
  const seed = String(career.world_seed);
  const objectives = [
    { type: "standings", target: evaluation.primaryTargetRank },
    { type: "financial", target: Math.round(requiredBudget * 0.5) },
    ...(evaluation.unlockDivisionObjective ? [{ type: "unlock_division", target: 1 }] : []),
  ] as const;
  await database.transaction(async () => {
    for (const objective of objectives) {
      await database.run(
        "INSERT OR IGNORE INTO board_objectives (objective_id, team_id, season, objective_type, target_value, expected_rank) VALUES (?, ?, ?, ?, ?, ?);",
        [stableId(seed, "board-objective", input.teamId + "-" + input.season + "-" + objective.type),
          input.teamId, input.season, objective.type, objective.target, expectedRank],
      );
    }
  });
  return { expectedRank, primaryTargetRank: evaluation.primaryTargetRank, hasUnlockObjective: evaluation.unlockDivisionObjective };
}

export async function createInitialPlayerBoardObjectives(database: IDatabase, careerId: string): Promise<void> {
  const rows = await database.query(
    "SELECT t.team_id, c.current_season FROM teams t JOIN career c ON c.career_id = t.career_id WHERE t.career_id = ? AND t.is_player_team = 1;",
    [careerId],
  );
  if (!rows[0]) throw new Error("Tim pemain belum tersedia untuk board objective awal.");
  await createBoardObjectivesForTeam(database, {
    careerId, teamId: String(rows[0].team_id), season: num(rows[0], "current_season", 1),
  });
}

export interface BoardSeasonResolution {
  readonly careerId: string;
  readonly season: number;
  readonly teamId: string | null;
  readonly managerFired: boolean;
  readonly reason: "low-confidence" | "consecutive-primary-misses" | null;
  readonly managerReputation: number;
  readonly confidence: number;
}

export async function resolveBoardObjectivesForSeason(
  database: IDatabase,
  input: { readonly careerId: string; readonly season: number },
): Promise<BoardSeasonResolution> {
  const existing = await database.query(
    "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'board-objectives-resolved';",
    [input.careerId, input.season],
  );
  if (existing[0]) return JSON.parse(String(existing[0].result_json)) as BoardSeasonResolution;

  const [careerRows, teamRows, managerRows] = await Promise.all([
    database.query("SELECT difficulty, highest_unlocked_tier, game_mode FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT team_id, division_id, cash FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;", [input.careerId]),
    database.query("SELECT manager_id, team_id, confidence, reputation, consecutive_primary_misses, status FROM career_managers WHERE career_id = ? AND is_player = 1;", [input.careerId]),
  ]);
  const career = careerRows[0], team = teamRows[0], manager = managerRows[0];
  if (!career || !manager) throw new Error("Career atau player manager untuk board resolution tidak ditemukan.");
  if (!team || manager.status !== "active" || String(manager.team_id) !== String(team.team_id)) {
    const skipped: BoardSeasonResolution = {
      careerId: input.careerId, season: input.season, teamId: team ? String(team.team_id) : null,
      managerFired: false, reason: null, managerReputation: num(manager, "reputation"), confidence: num(manager, "confidence"),
    };
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, 'board-objectives-resolved', ?);",
      [input.careerId, input.season, JSON.stringify(skipped)],
    );
    return skipped;
  }
  const tier = asTier(team.division_id);
  if (tier === 6) {
    const skipped: BoardSeasonResolution = {
      careerId: input.careerId, season: input.season, teamId: String(team.team_id),
      managerFired: false, reason: null, managerReputation: num(manager, "reputation"), confidence: num(manager, "confidence"),
    };
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, 'board-objectives-resolved', ?);",
      [input.careerId, input.season, JSON.stringify(skipped)],
    );
    return skipped;
  }

  const teamId = String(team.team_id);
  await createBoardObjectivesForTeam(database, { careerId: input.careerId, teamId, season: input.season });
  const requiredBudget = INITIAL_DISTRIBUTIONS[tier].requiredBudget;
  const settlementRows = await database.query(
    "SELECT closing_cash FROM season_settlements WHERE career_id = ? AND team_id = ? AND season = ?;",
    [input.careerId, teamId, input.season],
  );
  if (!settlementRows[0]) throw new Error("Board objective tidak bisa resolve sebelum financial settlement tim pemain.");
  const objectiveRows = await database.query(
    "SELECT objective_type, target_value, expected_rank FROM board_objectives WHERE team_id = ? AND season = ?;",
    [teamId, input.season],
  );
  const standingsRows = await database.query(
    "SELECT team_id, points, wins FROM standings WHERE season = ? AND division_id = ? AND team_id IS NOT NULL AND driver_id IS NULL ORDER BY points DESC, wins DESC, team_id;",
    [input.season, "T" + tier],
  );
  const position = Math.max(1, standingsRows.findIndex((row) => String(row.team_id) === teamId) + 1);
  const standingsObjective = objectiveRows.find((row) => row.objective_type === "standings");
  const expectedRank = num(standingsObjective, "expected_rank", 6);
  const currentConfidence = num(manager, "confidence", 60);
  const currentReputation = num(manager, "reputation");
  const previousPrimaryMisses = num(manager, "consecutive_primary_misses");
  const closingCash = num(settlementRows[0], "closing_cash");
  const higherDivisionUnlocked = num(career, "highest_unlocked_tier", 3) < tier;
  const result = evaluateBoardSeason({
    tier,
    difficulty: String(career.difficulty) as BoardDifficulty,
    expectedRank,
    constructorPosition: position,
    closingCash,
    requiredBudget,
    currentConfidence,
    currentManagerReputation: currentReputation,
    previousPrimaryMisses,
    season: input.season,
    isSandbox: String(career.game_mode) === "sandbox",
    higherDivisionUnlocked,
  });
  const managerReputation = result.managerFired ? Math.round(result.managerReputationAfter * 0.9) : result.managerReputationAfter;
  const managerRowResult = {
    ...result,
    managerReputationAfter: managerReputation,
    constructorPosition: position,
    expectedRank,
    closingCash,
    requiredBudget,
  };
  await database.transaction(async () => {
    for (const objective of objectiveRows) {
      let objectiveResult: Record<string, unknown>;
      if (objective.objective_type === "standings") {
        objectiveResult = { achieved: result.primaryAchieved, targetRank: result.primaryTargetRank, actualRank: position };
      } else if (objective.objective_type === "financial") {
        objectiveResult = { achieved: result.financialAchieved, targetCash: Number(objective.target_value), closingCash };
      } else {
        objectiveResult = { achieved: result.unlockDivisionAchieved, targetRank: 1, actualRank: position };
      }
      await database.run(
        "UPDATE board_objectives SET result = ?, manager_fired = ? WHERE team_id = ? AND season = ? AND objective_type = ?;",
        [JSON.stringify(objectiveResult), result.managerFired ? 1 : 0, teamId, input.season, String(objective.objective_type)],
      );
    }
    await database.run(
      "UPDATE career_managers SET confidence = ?, reputation = ?, consecutive_primary_misses = ?, status = ?, team_id = ? WHERE manager_id = ?;",
      [result.confidenceAfter, managerReputation, result.consecutivePrimaryMisses,
        result.managerFired ? "free_agent" : "active", result.managerFired ? null : teamId, String(manager.manager_id)],
    );
    const resolution: BoardSeasonResolution = {
      careerId: input.careerId, season: input.season, teamId,
      managerFired: result.managerFired, reason: result.firingReason,
      managerReputation, confidence: result.confidenceAfter,
    };
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, 'board-objectives-resolved', ?);",
      [input.careerId, input.season, JSON.stringify({ ...resolution, evaluation: managerRowResult })],
    );
  });
  return {
    careerId: input.careerId, season: input.season, teamId,
    managerFired: result.managerFired, reason: result.firingReason,
    managerReputation, confidence: result.confidenceAfter,
  };
}

export async function createManagerJobOffers(
  database: IDatabase,
  input: { readonly careerId: string; readonly completedSeason: number; readonly nextSeason: number; readonly resolution: BoardSeasonResolution },
): Promise<{ readonly created: number; readonly reason: "dismissal" | "reputation" | null }> {
  const step = "manager-job-offers-created";
  const existing = await database.query(
    "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
    [input.careerId, input.nextSeason, step],
  );
  if (existing[0]) return JSON.parse(String(existing[0].result_json)) as { created: number; reason: "dismissal" | "reputation" | null };

  const [careerRows, managerRows, playerTeamRows] = await Promise.all([
    database.query("SELECT world_seed, current_division_tier FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT manager_id, reputation, status FROM career_managers WHERE career_id = ? AND is_player = 1;", [input.careerId]),
    database.query("SELECT team_id, division_id FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;", [input.careerId]),
  ]);
  const career = careerRows[0], manager = managerRows[0], playerTeam = playerTeamRows[0];
  if (!career || !manager || !playerTeam) throw new Error("Data manager atau tim untuk job offers tidak lengkap.");
  const currentTier = asTier(playerTeam.division_id);
  if (currentTier === 6) {
    const skipped = { created: 0, reason: null as "dismissal" | "reputation" | null };
    await database.run("INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
      [input.careerId, input.nextSeason, step, JSON.stringify(skipped)]);
    return skipped;
  }
  const managerReputation = num(manager, "reputation");
  const reputationThreshold = INITIAL_DISTRIBUTIONS[currentTier].reputationRange[1];
  const reason = input.resolution.managerFired ? "dismissal" : managerReputation >= reputationThreshold ? "reputation" : null;
  if (!reason) {
    const skipped = { created: 0, reason: null as "dismissal" | "reputation" | null };
    await database.run("INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
      [input.careerId, input.nextSeason, step, JSON.stringify(skipped)]);
    return skipped;
  }

  const targetTiers = [currentTier, ...(currentTier > 1 ? [currentTier - 1] : [])];
  const candidates = await database.query(
    `SELECT t.team_id, t.division_id, t.reputation, t.personality, COALESCE(st.points, 0) AS points,
      COALESCE(st.wins, 0) AS wins
     FROM teams t
     LEFT JOIN standings st ON st.team_id = t.team_id AND st.season = ? AND st.division_id = t.division_id
       AND st.driver_id IS NULL
     WHERE t.career_id = ? AND t.is_active = 1 AND t.team_id <> ?
       AND t.division_id IN (${targetTiers.map(() => "?").join(",")})
       AND t.reputation <= ? * 1.2
     ORDER BY t.division_id, points ASC, wins ASC, t.team_id;`,
    [input.completedSeason, input.careerId, String(playerTeam.team_id), ...targetTiers.map((tier) => "T" + tier), managerReputation],
  );
  const ranked = candidates.map((row) => ({ ...row, tier: asTier(row.division_id) }));
  for (const tier of targetTiers) {
    const inTier = ranked.filter((row) => row.tier === tier).sort((a, b) =>
      num(a, "points") - num(b, "points") || num(a, "wins") - num(b, "wins") || String(a.team_id).localeCompare(String(b.team_id)));
    inTier.forEach((row, index) => { (row as { rank?: number }).rank = index + 1; });
  }
  const eligible = ranked
    .filter((row) => Number((row as { rank?: number }).rank ?? 99) >= 7 || String(row.personality).toLowerCase().includes("championship"))
    .sort((a, b) =>
      ((a as { rank?: number }).rank ?? 99) - ((b as { rank?: number }).rank ?? 99) ||
      String(a.team_id).localeCompare(String(b.team_id)),
    )
    .slice(0, 3);

  let created = 0;
  await database.transaction(async () => {
    for (const candidate of eligible) {
      await database.run(
        "INSERT OR IGNORE INTO manager_job_offers (offer_id, career_id, manager_id, team_id, offered_season, reason, status) VALUES (?, ?, ?, ?, ?, ?, 'pending');",
        [stableId(String(career.world_seed), "job-offer", input.nextSeason + "-" + String(manager.manager_id) + "-" + String(candidate.team_id)),
          input.careerId, String(manager.manager_id), String(candidate.team_id), input.nextSeason, reason],
      );
      created += 1;
    }
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
      [input.careerId, input.nextSeason, step, JSON.stringify({ created, reason })],
    );
  });
  return { created, reason };
}
