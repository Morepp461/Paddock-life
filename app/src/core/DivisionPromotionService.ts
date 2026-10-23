import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import type { TierId } from "./GameConfig";

type Row = Readonly<Record<string, unknown>>;
export interface DivisionPromotionOffer {
  readonly offerId: string;
  readonly careerId: string;
  readonly teamId: string;
  readonly season: number;
  readonly currentTier: TierId;
  readonly targetTier: TierId;
  readonly unlockAwarded: boolean;
  readonly status: "pending" | "promoted" | "stayed";
  readonly currentTeamName: string;
  readonly targetTeamName: string;
  readonly targetTeamCash: number;
  readonly targetTeamPosition: number;
}

function numberValue(row: Row | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function tierValue(value: unknown): TierId {
  const tier = Number(String(value).replace(/^T/, ""));
  if (![1, 2, 3, 4, 5, 6].includes(tier)) throw new Error("Tier promosi tidak valid.");
  return tier as TierId;
}
function stableId(careerId: string, teamId: string, season: number): string {
  let hash = 2166136261;
  for (const character of careerId + "|" + teamId + "|" + season + "|division-promotion") {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "promotion_" + hash.toString(16).padStart(8, "0");
}

async function readOffer(database: IDatabase, offerId: string): Promise<DivisionPromotionOffer | null> {
  const rows = await database.query(
    `SELECT o.offer_id, o.career_id, o.team_id, o.season, o.current_tier, o.target_tier,
       o.unlock_awarded, o.status, player.name AS current_team_name,
       target.name AS target_team_name, target.cash AS target_team_cash,
       COALESCE(target_st.points, 0) AS target_points, COALESCE(target_st.wins, 0) AS target_wins
     FROM division_promotion_offers o
     JOIN teams player ON player.team_id = o.team_id
     LEFT JOIN teams target ON target.career_id = o.career_id AND target.division_id = 'T' || o.target_tier
       AND target.is_active = 1 AND target.is_player_team = 0
     LEFT JOIN standings target_st ON target_st.team_id = target.team_id AND target_st.season = o.season
       AND target_st.division_id = 'T' || o.target_tier AND target_st.driver_id IS NULL
     WHERE o.offer_id = ?
     ORDER BY target_points ASC, target_wins ASC, target.team_id DESC LIMIT 1;`,
    [offerId],
  );
  const row = rows[0];
  if (!row) return null;
  const targetTeamRows = await database.query(
    `SELECT t.team_id, t.name, t.cash, COALESCE(s.points, 0) AS points, COALESCE(s.wins, 0) AS wins
     FROM teams t LEFT JOIN standings s ON s.team_id = t.team_id AND s.season = ? AND s.division_id = t.division_id AND s.driver_id IS NULL
     WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1 AND t.is_player_team = 0
     ORDER BY points ASC, wins ASC, t.team_id DESC LIMIT 1;`,
    [numberValue(row, "season"), String(row.career_id), "T" + numberValue(row, "target_tier")],
  );
  const target = targetTeamRows[0];
  const allTargetTeams = await database.query(
    "SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND division_id = ? AND is_active = 1;",
    [String(row.career_id), "T" + numberValue(row, "target_tier")],
  );
  const targetPosition = numberValue(allTargetTeams[0], "count") === 12 ? 12 : 0;
  return {
    offerId: String(row.offer_id), careerId: String(row.career_id), teamId: String(row.team_id),
    season: numberValue(row, "season"), currentTier: tierValue(row.current_tier), targetTier: tierValue(row.target_tier),
    unlockAwarded: numberValue(row, "unlock_awarded") === 1, status: String(row.status) as DivisionPromotionOffer["status"],
    currentTeamName: String(row.current_team_name),
    targetTeamName: target ? String(target.name) : "Bottom-ranked team",
    targetTeamCash: numberValue(target ?? row, "cash", numberValue(row, "target_team_cash")),
    targetTeamPosition: targetPosition,
  };
}

/**
 * Opens a promotion decision after the season is settled. Winning unlocks the
 * next tier only when it was still locked; already-unlocked tiers remain available.
 */
export async function prepareDivisionPromotionOffer(
  database: IDatabase,
  input: { readonly careerId: string; readonly completedSeason: number },
): Promise<DivisionPromotionOffer | null> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.completedSeason) || input.completedSeason < 1) {
    throw new RangeError("Career ID dan completed season harus valid.");
  }
  const [careerRows, playerRows] = await Promise.all([
    database.query("SELECT current_season, highest_unlocked_tier, current_division_tier FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT team_id, name, division_id FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;", [input.careerId]),
  ]);
  const career = careerRows[0], player = playerRows[0];
  if (!career || !player) throw new Error("Career atau tim pemain tidak ditemukan untuk keputusan promosi.");
  if (numberValue(career, "current_season", 1) !== input.completedSeason) {
    throw new Error("Keputusan promosi harus dibuat sebelum season berpindah.");
  }
  const currentTier = tierValue(player.division_id);
  if (currentTier === 1) return null;

  const teamId = String(player.team_id);
  const existing = await database.query(
    "SELECT offer_id, status FROM division_promotion_offers WHERE career_id = ? AND team_id = ? AND season = ?;",
    [input.careerId, teamId, input.completedSeason],
  );
  if (existing[0]) {
    if (String(existing[0].status) === "pending") return readOffer(database, String(existing[0].offer_id));
    return null;
  }

  const standings = await database.query(
    `SELECT t.team_id, COALESCE(s.points, 0) AS points, COALESCE(s.wins, 0) AS wins
     FROM teams t LEFT JOIN standings s ON s.team_id = t.team_id AND s.season = ? AND s.division_id = ? AND s.driver_id IS NULL
     WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1
     ORDER BY points DESC, wins DESC, t.team_id ASC;`,
    [input.completedSeason, "T" + currentTier, input.careerId, "T" + currentTier],
  );
  if (standings.length !== 12) throw new Error("Keputusan promosi membutuhkan 12 tim aktif di divisi pemain.");
  const champion = String(standings[0]?.team_id) === teamId;
  let highestUnlockedTier = numberValue(career, "highest_unlocked_tier", currentTier);
  let unlockAwarded = false;
  if (champion && highestUnlockedTier >= currentTier) {
    highestUnlockedTier = currentTier - 1;
    unlockAwarded = true;
  }
  if (currentTier <= highestUnlockedTier) return null;

  const offerId = stableId(input.careerId, teamId, input.completedSeason);
  await database.transaction(async () => {
    if (unlockAwarded) {
      await database.run("UPDATE career SET highest_unlocked_tier = ?, updated_at = CURRENT_TIMESTAMP WHERE career_id = ?;", [highestUnlockedTier, input.careerId]);
    }
    await database.run(
      `INSERT INTO division_promotion_offers
        (offer_id, career_id, team_id, season, current_tier, target_tier, unlock_awarded, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending');`,
      [offerId, input.careerId, teamId, input.completedSeason, currentTier, currentTier - 1, unlockAwarded ? 1 : 0],
    );
  });
  return readOffer(database, offerId);
}

export async function getPendingDivisionPromotionOffer(
  database: IDatabase,
  input: { readonly careerId: string; readonly teamId: string; readonly season: number },
): Promise<DivisionPromotionOffer | null> {
  const rows = await database.query(
    "SELECT offer_id FROM division_promotion_offers WHERE career_id = ? AND team_id = ? AND season = ? AND status = 'pending' LIMIT 1;",
    [input.careerId, input.teamId, input.season],
  );
  return rows[0] ? readOffer(database, String(rows[0].offer_id)) : null;
}

export async function resolveDivisionPromotionChoice(
  database: IDatabase,
  input: { readonly careerId: string; readonly offerId: string; readonly choice: "promote" | "stay" },
): Promise<{ readonly teamId: string; readonly tier: TierId; readonly promoted: boolean; readonly exchangedTeamId: string | null }> {
  if (!input.careerId.trim() || !input.offerId.trim()) throw new Error("Career dan offer ID wajib diisi.");
  const offerRows = await database.query(
    "SELECT * FROM division_promotion_offers WHERE offer_id = ? AND career_id = ?;",
    [input.offerId, input.careerId],
  );
  const offer = offerRows[0];
  if (!offer) throw new Error("Promotion offer tidak ditemukan.");
  if (String(offer.status) !== "pending") throw new Error("Keputusan promosi ini sudah diproses.");
  const currentTier = tierValue(offer.current_tier);
  const targetTier = tierValue(offer.target_tier);
  const teamId = String(offer.team_id);
  if (input.choice === "stay") {
    await database.run(
      "UPDATE division_promotion_offers SET status = 'stayed', resolved_at = CURRENT_TIMESTAMP WHERE offer_id = ? AND status = 'pending';",
      [input.offerId],
    );
    return { teamId, tier: currentTier, promoted: false, exchangedTeamId: null };
  }

  const careerRows = await database.query("SELECT highest_unlocked_tier FROM career WHERE career_id = ?;", [input.careerId]);
  const highestUnlockedTier = numberValue(careerRows[0], "highest_unlocked_tier", currentTier);
  if (targetTier < highestUnlockedTier) {
    throw new Error("Divisi target belum terbuka untuk save ini.");
  }
  const bottomRows = await database.query(
    `SELECT t.team_id, t.affordability FROM teams t
     LEFT JOIN standings s ON s.team_id = t.team_id AND s.season = ? AND s.division_id = ? AND s.driver_id IS NULL
     WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1 AND t.is_player_team = 0
     ORDER BY COALESCE(s.points, 0) ASC, COALESCE(s.wins, 0) ASC, t.team_id DESC LIMIT 1;`,
    [numberValue(offer, "season"), "T" + targetTier, input.careerId, "T" + targetTier],
  );
  const bottom = bottomRows[0];
  if (!bottom) throw new Error("Tim terbawah di divisi target tidak ditemukan.");
  await database.transaction(async () => {
    const currentTeamRows = await database.query(
      "SELECT division_id FROM teams WHERE career_id = ? AND team_id = ? AND is_player_team = 1 AND is_active = 1;",
      [input.careerId, teamId],
    );
    if (!currentTeamRows[0] || tierValue(currentTeamRows[0].division_id) !== currentTier) {
      throw new Error("Divisi tim pemain berubah sejak promotion offer dibuat.");
    }
    await database.run("UPDATE teams SET division_id = ? WHERE team_id = ?;", ["T" + currentTier, String(bottom.team_id)]);
    await database.run("UPDATE teams SET division_id = ? WHERE team_id = ?;", ["T" + targetTier, teamId]);
    await database.run("UPDATE career SET current_division_tier = ?, updated_at = CURRENT_TIMESTAMP WHERE career_id = ?;", [targetTier, input.careerId]);
    await database.run(
      "INSERT INTO team_division_history (history_id, career_id, team_id, season, from_tier, to_tier, reason, affordability) VALUES (?, ?, ?, ?, ?, ?, 'player_move', ?);",
      [stableId(input.careerId, teamId, numberValue(offer, "season")) + "_player", input.careerId, teamId,
        numberValue(offer, "season") + 1, currentTier, targetTier, numberValue(bottom, "affordability", 1)],
    );
    await database.run(
      "INSERT INTO team_division_history (history_id, career_id, team_id, season, from_tier, to_tier, reason, affordability) VALUES (?, ?, ?, ?, ?, ?, 'player_move', ?);",
      [stableId(input.careerId, String(bottom.team_id), numberValue(offer, "season")) + "_exchange", input.careerId,
        String(bottom.team_id), numberValue(offer, "season") + 1, targetTier, currentTier, numberValue(bottom, "affordability", 1)],
    );
    await database.run(
      "UPDATE division_promotion_offers SET status = 'promoted', resolved_at = CURRENT_TIMESTAMP WHERE offer_id = ? AND status = 'pending';",
      [input.offerId],
    );
  });
  return { teamId, tier: targetTier, promoted: true, exchangedTeamId: String(bottom.team_id) };
}
