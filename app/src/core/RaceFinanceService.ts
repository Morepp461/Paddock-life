import type { IDatabase } from "../storage/IDatabase";
import { calculateProratedRoundCost } from "./EconomyEngine";
import { TIER_CONFIG, type TierId } from "./GameConfig";

export interface TeamRacePayrollCosts {
  readonly driverPayroll: number;
  readonly staffPayroll: number;
}

/** Reads actual contracted annual salaries and prorates them exactly over the season. */
export async function calculateTeamRacePayrollCosts(
  database: IDatabase,
  input: { readonly teamId: string; readonly season: number; readonly tier: TierId; readonly round: number },
): Promise<TeamRacePayrollCosts> {
  if (!input.teamId.trim()) throw new Error("Team ID wajib diisi.");
  if (!Number.isSafeInteger(input.season) || input.season < 1) throw new RangeError("Season harus integer positif.");
  const totalRounds = TIER_CONFIG[input.tier].roundsPerSeason;
  if (!Number.isSafeInteger(input.round) || input.round < 1 || input.round > totalRounds) {
    throw new RangeError("Round harus berada dalam rentang season aktif.");
  }
  // Tier 6 is amateur karting: the final economy specification does not assign
  // driver/staff salary budgets to it, so its payroll expense remains zero.
  if (input.tier === 6) return { driverPayroll: 0, staffPayroll: 0 };

  const [driverRows, loanedInRows, staffRows] = await Promise.all([
    database.query(
      `SELECT COALESCE(SUM(CASE WHEN EXISTS (
          SELECT 1 FROM driver_loans l
          WHERE l.career_id = d.career_id AND l.driver_id = d.driver_id
            AND l.owner_team_id = dc.team_id AND l.status = 'active'
            AND l.start_season <= ? AND l.end_season >= ?
        ) THEN ROUND(dc.salary * 0.8) ELSE dc.salary END), 0) AS total
       FROM driver_contracts dc JOIN drivers d ON d.driver_id = dc.driver_id
       WHERE dc.team_id = ? AND dc.start_season <= ? AND dc.end_season >= ?
         AND d.is_retired = 0
         AND (d.is_academy_driver = 0 OR EXISTS (
           SELECT 1 FROM driver_loans l
           WHERE l.career_id = d.career_id AND l.driver_id = d.driver_id
             AND l.owner_team_id = dc.team_id AND l.status = 'active'
             AND l.start_season <= ? AND l.end_season >= ?
         ));`,
      [input.season, input.season, input.teamId, input.season, input.season, input.season, input.season],
    ),
    database.query(
      `SELECT COALESCE(SUM(ROUND(dc.salary * 0.2)), 0) AS total
       FROM driver_loans l
       JOIN driver_contracts dc ON dc.driver_id = l.driver_id AND dc.team_id = l.owner_team_id
         AND dc.start_season <= ? AND dc.end_season >= ?
       JOIN drivers d ON d.driver_id = l.driver_id
       WHERE l.loan_team_id = ? AND l.status = 'active' AND l.start_season <= ? AND l.end_season >= ?
         AND d.is_retired = 0;`,
      [input.season, input.season, input.teamId, input.season, input.season],
    ),
    database.query(
      `SELECT COALESCE(SUM(salary), 0) AS total
       FROM staff
       WHERE team_id = ? AND is_free_agent = 0 AND (contract_end IS NULL OR contract_end >= ?);`,
      [input.teamId, input.season],
    ),
  ]);
  const annualDriverPayroll = Number(driverRows[0]?.total ?? 0) + Number(loanedInRows[0]?.total ?? 0);
  const annualStaffPayroll = Number(staffRows[0]?.total ?? 0);
  if (![annualDriverPayroll, annualStaffPayroll].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Payroll kontrak tim tidak valid.");
  }
  return {
    driverPayroll: calculateProratedRoundCost(annualDriverPayroll, input.round, totalRounds),
    staffPayroll: calculateProratedRoundCost(annualStaffPayroll, input.round, totalRounds),
  };
}
