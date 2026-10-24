import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { TIER_CONFIG, type TierId } from "./GameConfig";

/**
 * Loads the actual grid for one career division. A valid active Youth Loan moves
 * the driver's race seat to the borrower while the professional contract remains
 * attached to the owner team for payroll and development records.
 */
export async function loadCareerRaceRoster(
  database: IDatabase,
  input: { readonly careerId: string; readonly season: number; readonly tier: TierId },
): Promise<DatabaseRow[]> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.season) || input.season < 1) {
    throw new RangeError("Career ID dan season roster harus valid.");
  }
  const tierConfig = TIER_CONFIG[input.tier];
  const rows = await database.query(
    `SELECT d.driver_id, d.name, d.pace, d.qualifying, d.racecraft, d.consistency,
       d.wet_skill, d.adaptability, d.tyre_management, d.aggression, d.overtaking,
       d.defending, d.starts, t.team_id, t.is_player_team,
       c.engine_power, c.aero, c.high_speed, c.medium_speed, c.low_speed,
       c.mechanical_grip, c.traction, c.braking, c.tyre_management AS car_tyre_management
     FROM drivers d
     JOIN driver_contracts dc ON dc.driver_id = d.driver_id
       AND dc.start_season <= ? AND dc.end_season >= ?
     JOIN teams t ON t.team_id = CASE
       WHEN d.loaned_to_team_id IS NOT NULL THEN d.loaned_to_team_id
       ELSE dc.team_id
     END
       AND t.career_id = ? AND t.division_id = ? AND t.is_active = 1
     JOIN cars c ON c.team_id = t.team_id AND c.season = ?
     WHERE d.career_id = ? AND d.is_retired = 0
       AND d.age BETWEEN ? AND ?
       AND (
         (d.is_academy_driver = 0 AND d.loaned_to_team_id IS NULL)
         OR EXISTS (
           SELECT 1 FROM driver_loans l
           WHERE l.career_id = d.career_id AND l.driver_id = d.driver_id
             AND l.loan_team_id = t.team_id AND l.status = 'active'
             AND l.start_season <= ? AND l.end_season >= ?
         )
       )
     ORDER BY t.team_id, d.driver_id;`,
    [
      input.season, input.season, input.careerId, "T" + input.tier, input.season,
      input.careerId, tierConfig.driverAge.min, tierConfig.driverAge.max,
      input.season, input.season,
    ],
  );
  if (rows.length !== tierConfig.gridSize) {
    throw new Error(
      "Grid race Tier " + input.tier + " harus berisi " + tierConfig.gridSize
      + " driver yang memenuhi syarat; ditemukan " + rows.length + ".",
    );
  }
  const uniqueDrivers = new Set(rows.map((row) => String(row.driver_id)));
  if (uniqueDrivers.size !== rows.length) throw new Error("Race roster memiliki driver duplikat.");
  return rows;
}
