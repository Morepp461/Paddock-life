import type { IDatabase } from "../storage/IDatabase";
import type { TierId } from "./GameConfig";
import { createBoardObjectivesForTeam } from "./BoardObjectiveService";

type Row = Readonly<Record<string, unknown>>;

export interface BoardObjectiveMidseasonWarning {
  readonly careerId: string;
  readonly teamId: string;
  readonly season: number;
  readonly checkpointPercent: 50 | 80;
  readonly completedRounds: number;
  readonly totalRounds: number;
  readonly targetRank: number;
  readonly forecastRank: number;
  readonly atRisk: boolean;
  readonly message: string;
}

function numberValue(row: Row | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function warningId(careerId: string, teamId: string, season: number, checkpoint: number): string {
  let hash = 2166136261;
  for (const character of careerId + "|" + teamId + "|" + season + "|" + checkpoint) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "board_warning_" + hash.toString(16).padStart(8, "0");
}

/**
 * Evaluates the live constructor standing at the documented 50% and 80%
 * checkpoints. A warning is informational only and never changes confidence.
 */
export async function checkBoardObjectiveMidseason(
  database: IDatabase,
  input: { readonly careerId: string; readonly teamId: string; readonly season: number; readonly tier: TierId },
): Promise<BoardObjectiveMidseasonWarning | null> {
  if (!input.careerId.trim() || !input.teamId.trim() || !Number.isSafeInteger(input.season) || input.season < 1) {
    throw new RangeError("Career, team, dan season untuk board check harus valid.");
  }
  if (input.tier === 6) return null;

  const [raceRows, teamRows] = await Promise.all([
    database.query(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM races WHERE division_id = ? AND season = ?;",
      ["T" + input.tier, input.season],
    ),
    database.query(
      "SELECT team_id FROM teams WHERE career_id = ? AND team_id = ? AND is_player_team = 1 AND is_active = 1;",
      [input.careerId, input.teamId],
    ),
  ]);
  if (!teamRows[0]) return null;
  const totalRounds = numberValue(raceRows[0], "total");
  const completedRounds = numberValue(raceRows[0], "completed");
  if (totalRounds < 1 || completedRounds < 1) return null;
  const checkpoints = new Map<number, 50 | 80>([
    [Math.ceil(totalRounds * 0.5), 50],
    [Math.ceil(totalRounds * 0.8), 80],
  ]);
  const checkpointPercent = checkpoints.get(completedRounds);
  if (checkpointPercent === undefined) return null;

  const existing = await database.query(
    "SELECT * FROM board_objective_warnings WHERE career_id = ? AND team_id = ? AND season = ? AND checkpoint_percent = ?;",
    [input.careerId, input.teamId, input.season, checkpointPercent],
  );
  if (existing[0]) {
    const row = existing[0];
    return {
      careerId: input.careerId, teamId: input.teamId, season: input.season,
      checkpointPercent, completedRounds: numberValue(row, "completed_rounds"),
      totalRounds: numberValue(row, "total_rounds"), targetRank: numberValue(row, "target_rank"),
      forecastRank: numberValue(row, "forecast_rank"), atRisk: numberValue(row, "at_risk") === 1,
      message: String(row.message),
    };
  }

  await createBoardObjectivesForTeam(database, {
    careerId: input.careerId, teamId: input.teamId, season: input.season,
  });
  const objectives = await database.query(
    "SELECT target_value FROM board_objectives WHERE team_id = ? AND season = ? AND objective_type = 'standings' LIMIT 1;",
    [input.teamId, input.season],
  );
  if (!objectives[0]) return null;
  const targetRank = Math.max(1, Math.min(12, numberValue(objectives[0], "target_value", 6)));
  const standings = await database.query(
    `SELECT t.team_id, COALESCE(s.points, 0) AS points, COALESCE(s.wins, 0) AS wins
     FROM teams t
     LEFT JOIN standings s ON s.team_id = t.team_id AND s.season = ? AND s.division_id = ? AND s.driver_id IS NULL
     WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1
     ORDER BY points DESC, wins DESC, t.team_id ASC;`,
    [input.season, "T" + input.tier, input.careerId, "T" + input.tier],
  );
  if (standings.length !== 12) throw new Error("Board mid-season check membutuhkan tepat 12 tim aktif.");
  const index = standings.findIndex((row) => String(row.team_id) === input.teamId);
  if (index < 0) throw new Error("Tim pemain tidak ditemukan di klasemen saat board check.");
  const forecastRank = index + 1;
  const atRisk = forecastRank > targetRank;
  const message = atRisk
    ? "Board Objective at risk — " + checkpointPercent + "% season selesai. Posisi saat ini P" + forecastRank + ", target minimal P" + targetRank + "."
    : "Board Objective on track — " + checkpointPercent + "% season selesai. Posisi saat ini P" + forecastRank + ", target minimal P" + targetRank + ".";
  const warning: BoardObjectiveMidseasonWarning = {
    careerId: input.careerId, teamId: input.teamId, season: input.season, checkpointPercent,
    completedRounds, totalRounds, targetRank, forecastRank, atRisk, message,
  };
  await database.run(
    `INSERT OR IGNORE INTO board_objective_warnings
      (warning_id, career_id, team_id, season, checkpoint_percent, completed_rounds, total_rounds,
       target_rank, forecast_rank, at_risk, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [warningId(input.careerId, input.teamId, input.season, checkpointPercent), input.careerId,
      input.teamId, input.season, checkpointPercent, completedRounds, totalRounds, targetRank,
      forecastRank, atRisk ? 1 : 0, message],
  );
  return warning;
}

export async function listBoardObjectiveWarnings(
  database: IDatabase,
  input: { readonly careerId: string; readonly teamId: string; readonly season: number },
): Promise<readonly BoardObjectiveMidseasonWarning[]> {
  const rows = await database.query(
    "SELECT * FROM board_objective_warnings WHERE career_id = ? AND team_id = ? AND season = ? AND at_risk = 1 ORDER BY checkpoint_percent DESC;",
    [input.careerId, input.teamId, input.season],
  );
  return rows.map((row) => ({
    careerId: String(row.career_id), teamId: String(row.team_id), season: numberValue(row, "season"),
    checkpointPercent: numberValue(row, "checkpoint_percent") as 50 | 80,
    completedRounds: numberValue(row, "completed_rounds"), totalRounds: numberValue(row, "total_rounds"),
    targetRank: numberValue(row, "target_rank"), forecastRank: numberValue(row, "forecast_rank"),
    atRisk: true, message: String(row.message),
  }));
}
