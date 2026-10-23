import type { IDatabase } from "../storage/IDatabase";
import type { TierId } from "./GameConfig";
import {
  calculateBalanceAfterTransaction,
  calculateCommercialRevenue,
  calculateFacilityMaintenancePerSeason,
  calculatePrizeMoney,
  calculateSeasonInterest,
} from "./EconomyEngine";
import { evaluateSponsorTarget, type SponsorFocus, type SponsorPerformance, type SponsorTier } from "./SponsorEngine";

type Row = Readonly<Record<string, unknown>>;
type SponsorTargetRecord = { sponsorId: string; name: string; focus: string; achieved: boolean; actual: number; required: number; payout: number };

export interface TeamSeasonSettlement {
  readonly teamId: string;
  readonly constructorPosition: number;
  readonly prizeMoney: number;
  readonly commercialRevenue: number;
  readonly sponsorRevenue: number;
  readonly interestCost: number;
  readonly facilityMaintenance: number;
  readonly netAmount: number;
  readonly closingCash: number;
  readonly sponsorTargets: readonly SponsorTargetRecord[];
}
export interface SeasonSettlementResult {
  readonly careerId: string;
  readonly season: number;
  readonly tier: TierId;
  readonly teamsSettled: number;
  readonly settlements: readonly TeamSeasonSettlement[];
}

function stableSettlementId(careerId: string, season: number, teamId: string): string {
  let hash = 2166136261;
  const value = careerId + "|" + season + "|" + teamId + "|settlement";
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "settle_" + hash.toString(16).padStart(8, "0");
}
function mapSponsorFocus(value: string): SponsorFocus {
  const mapping: Readonly<Record<string, SponsorFocus>> = {
    Poin: "points", Podium: "podium", Menang: "win", Finish: "finish", Popularitas: "popularity",
  };
  const focus = mapping[value];
  if (!focus) throw new Error("Fokus sponsor tidak dikenal: " + value);
  return focus;
}
function numberValue(row: Row, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}
function sponsorPerformanceFromRows(input: {
  pointsRounds: number; podiumRounds: number; winRounds: number; starts: number; finishes: number; leadPopularity: number;
}): SponsorPerformance {
  return {
    roundsWithPointsFinish: input.pointsRounds,
    roundsWithPodium: input.podiumRounds,
    roundsWon: input.winRounds,
    carStarts: input.starts,
    carFinishes: input.finishes,
    leadDriverPopularity: input.leadPopularity,
  };
}

async function loadExistingSettlement(
  database: IDatabase,
  careerId: string,
  season: number,
  tier: TierId,
): Promise<SeasonSettlementResult> {
  const rows = await database.query(
    "SELECT team_id, prize_money, commercial_revenue, sponsor_revenue, interest_cost, facility_maintenance, net_amount, closing_cash, settlement_json FROM season_settlements WHERE career_id = ? AND season = ? AND division_id = ?;",
    [careerId, season, "T" + tier],
  );
  if (rows.length !== 12) throw new Error("Settlement tersimpan tidak lengkap; pemulihan data diperlukan.");
  const settlements = rows.map((row): TeamSeasonSettlement => {
    let metadata: { constructorPosition?: unknown; sponsorTargets?: unknown };
    try { metadata = JSON.parse(String(row.settlement_json)) as typeof metadata; }
    catch { throw new Error("Metadata settlement tersimpan rusak."); }
    if (!Number.isSafeInteger(Number(metadata.constructorPosition)) || !Array.isArray(metadata.sponsorTargets)) {
      throw new Error("Metadata settlement tersimpan tidak valid.");
    }
    return {
      teamId: String(row.team_id),
      constructorPosition: Number(metadata.constructorPosition),
      prizeMoney: numberValue(row, "prize_money"),
      commercialRevenue: numberValue(row, "commercial_revenue"),
      sponsorRevenue: numberValue(row, "sponsor_revenue"),
      interestCost: numberValue(row, "interest_cost"),
      facilityMaintenance: numberValue(row, "facility_maintenance"),
      netAmount: numberValue(row, "net_amount"),
      closingCash: numberValue(row, "closing_cash"),
      sponsorTargets: metadata.sponsorTargets as SponsorTargetRecord[],
    };
  }).sort((left, right) => left.constructorPosition - right.constructorPosition);
  return { careerId, season, tier, teamsSettled: settlements.length, settlements };
}

/**
 * Closes one completed season's finances exactly once. Sponsor revenue is paid
 * only when the contract's source-defined target is achieved; settlement values
 * and each cash ledger entry are committed in the same transaction.
 */
export async function settleCareerSeason(
  database: IDatabase,
  input: { readonly careerId: string; readonly season: number; readonly tier: TierId },
): Promise<SeasonSettlementResult> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.season) || input.season < 1) {
    throw new RangeError("Career ID dan nomor season harus valid.");
  }
  const divisionId = "T" + input.tier;
  const [raceCounts, priorSettlement] = await Promise.all([
    database.query(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM races WHERE division_id = ? AND season = ?;",
      [divisionId, input.season],
    ),
    database.query("SELECT COUNT(*) AS count FROM season_settlements WHERE career_id = ? AND season = ? AND division_id = ?;", [input.careerId, input.season, divisionId]),
  ]);
  const totalRounds = Number(raceCounts[0]?.total ?? 0);
  const completedRounds = Number(raceCounts[0]?.completed ?? 0);
  if (totalRounds < 1 || completedRounds !== totalRounds) {
    throw new Error("Season belum bisa ditutup: semua ronde harus selesai terlebih dahulu.");
  }
  if (Number(priorSettlement[0]?.count ?? 0) > 0) {
    return loadExistingSettlement(database, input.careerId, input.season, input.tier);
  }

  const teamRows = await database.query(
    `SELECT t.team_id, t.cash, t.debt, t.reputation, t.aero_center_level, t.engine_dept_level,
      t.chassis_level, t.simulator_level, t.rnd_level, t.academy_level,
      COALESCE(st.points, 0) AS points, COALESCE(st.wins, 0) AS wins
     FROM teams t
     LEFT JOIN standings st ON st.team_id = t.team_id AND st.driver_id IS NULL AND st.season = ? AND st.division_id = ?
     WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1
     ORDER BY COALESCE(st.points, 0) DESC, COALESCE(st.wins, 0) DESC, t.reputation DESC, t.team_id;`,
    [input.season, divisionId, input.careerId, divisionId],
  );
  if (teamRows.length !== 12) throw new Error("Season settlement membutuhkan tepat 12 tim aktif di divisi.");

  const staged: TeamSeasonSettlement[] = [];
  for (let index = 0; index < teamRows.length; index += 1) {
    const team = teamRows[index]!;
    const teamId = String(team.team_id);
    const constructorPosition = index + 1;
    const driverRows = await database.query(
      `SELECT d.driver_id, d.fan_popularity, d.pace
       FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id
       WHERE dc.team_id = ? AND dc.start_season <= ? AND dc.end_season >= ?
         AND d.is_academy_driver = 0 AND d.is_retired = 0
       ORDER BY d.pace DESC, d.driver_id LIMIT 2;`,
      [teamId, input.season, input.season],
    );
    const leadPopularity = driverRows.length ? numberValue(driverRows[0]!, "fan_popularity") : 0;
    const commercialRevenue = calculateCommercialRevenue(input.tier,
      driverRows.length ? driverRows.reduce((sum, driver) => sum + numberValue(driver, "fan_popularity"), 0) / driverRows.length : 0);
    const prizeMoney = calculatePrizeMoney(input.tier, constructorPosition);
    const interestCost = calculateSeasonInterest(numberValue(team, "debt"));
    const facilityLevels = [
      "aero_center_level", "engine_dept_level", "chassis_level",
      "simulator_level", "rnd_level", "academy_level",
    ];
    const facilityMaintenance = facilityLevels.reduce(
      (sum, key) => sum + calculateFacilityMaintenancePerSeason(input.tier, numberValue(team, key)), 0,
    );

    const statsRows = await database.query(
      `SELECT
        COUNT(DISTINCT CASE WHEN rr.points > 0 THEN rr.race_id END) AS points_rounds,
        COUNT(DISTINCT CASE WHEN rr.finish_position <= 3 THEN rr.race_id END) AS podium_rounds,
        COUNT(DISTINCT CASE WHEN rr.finish_position = 1 THEN rr.race_id END) AS win_rounds,
        COUNT(*) AS starts,
        SUM(CASE WHEN rr.dnf = 0 THEN 1 ELSE 0 END) AS finishes
       FROM race_results rr
       JOIN races r ON r.race_id = rr.race_id
       WHERE rr.team_id = ? AND rr.session_type = 'race' AND r.division_id = ? AND r.season = ?;`,
      [teamId, divisionId, input.season],
    );
    const stats = statsRows[0] ?? {};
    const performance = sponsorPerformanceFromRows({
      pointsRounds: numberValue(stats, "points_rounds"),
      podiumRounds: numberValue(stats, "podium_rounds"),
      winRounds: numberValue(stats, "win_rounds"),
      starts: numberValue(stats, "starts"),
      finishes: numberValue(stats, "finishes"),
      leadPopularity,
    });
    const sponsorRows = await database.query(
      `SELECT ts.team_sponsor_id, ts.contract_value, ts.focus, s.sponsor_id, s.name, s.tier
       FROM team_sponsors ts JOIN sponsor_pool s ON s.sponsor_id = ts.sponsor_id
       WHERE ts.team_id = ? AND ts.is_active = 1 AND ts.start_season <= ? AND ts.end_season >= ?
       ORDER BY s.sponsor_id;`,
      [teamId, input.season, input.season],
    );
    const sponsorTargets: SponsorTargetRecord[] = [];
    let sponsorRevenue = 0;
    for (const sponsor of sponsorRows) {
      const outcome = evaluateSponsorTarget(
        Number(sponsor.tier) as SponsorTier,
        mapSponsorFocus(String(sponsor.focus)),
        performance,
        completedRounds,
      );
      const payout = outcome.achieved ? numberValue(sponsor, "contract_value") : 0;
      sponsorRevenue += payout;
      sponsorTargets.push({
        sponsorId: String(sponsor.sponsor_id), name: String(sponsor.name), focus: String(sponsor.focus),
        achieved: outcome.achieved, actual: outcome.actual, required: outcome.required, payout,
      });
    }
    const netAmount = prizeMoney + commercialRevenue + sponsorRevenue - interestCost - facilityMaintenance;
    staged.push({
      teamId, constructorPosition, prizeMoney, commercialRevenue, sponsorRevenue, interestCost,
      facilityMaintenance, netAmount, closingCash: 0, sponsorTargets,
    });
  }

  const committed: TeamSeasonSettlement[] = [];
  await database.transaction(async () => {
    const alreadySettled = await database.query("SELECT COUNT(*) AS count FROM season_settlements WHERE career_id = ? AND season = ?;", [input.careerId, input.season]);
    if (Number(alreadySettled[0]?.count ?? 0) > 0) throw new Error("Season ini sudah diselesaikan.");
    for (const settlement of staged) {
      const teamRows = await database.query("SELECT cash FROM teams WHERE team_id = ? AND career_id = ?;", [settlement.teamId, input.careerId]);
      if (!teamRows[0]) throw new Error("Tim settlement tidak ditemukan.");
      let balance = numberValue(teamRows[0]!, "cash");
      const categories = [
        { category: "prize-money", amount: settlement.prizeMoney },
        { category: "commercial-revenue", amount: settlement.commercialRevenue },
        { category: "sponsor-revenue", amount: settlement.sponsorRevenue },
        { category: "debt-interest", amount: -settlement.interestCost },
        { category: "facility-maintenance", amount: -settlement.facilityMaintenance },
      ];
      for (const item of categories) {
        if (item.amount === 0) continue;
        const next = calculateBalanceAfterTransaction({ currentBalance: balance, amount: item.amount, tier: input.tier });
        if (!next.withinOverdraft) {
          throw new Error("Settlement dibatalkan: transaksi " + item.category + " melewati batas overdraft untuk tim " + settlement.teamId + ".");
        }
        balance = next.balanceAfter;
        const transactionId = "season_" + input.season + "_" + settlement.teamId + "_" + item.category;
        await database.run(
          "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, ?, NULL, ?, ?, ?, ?);",
          [transactionId, settlement.teamId, input.season, item.amount >= 0 ? "income" : "expense", item.category, item.amount, balance],
        );
        await database.run("UPDATE teams SET cash = ? WHERE team_id = ?;", [balance, settlement.teamId]);
      }
      const settled: TeamSeasonSettlement = { ...settlement, closingCash: balance };
      await database.run(
        `INSERT INTO season_settlements
          (settlement_id, career_id, team_id, division_id, season, prize_money, commercial_revenue, sponsor_revenue,
           interest_cost, facility_maintenance, net_amount, closing_cash, settlement_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [stableSettlementId(input.careerId, input.season, settlement.teamId), input.careerId, settlement.teamId,
          divisionId, input.season, settlement.prizeMoney, settlement.commercialRevenue, settlement.sponsorRevenue,
          settlement.interestCost, settlement.facilityMaintenance, settlement.netAmount, balance,
          JSON.stringify({ constructorPosition: settlement.constructorPosition, sponsorTargets: settlement.sponsorTargets })],
      );
      committed.push(settled);
    }
  });
  return { careerId: input.careerId, season: input.season, tier: input.tier, teamsSettled: committed.length, settlements: committed };
}
