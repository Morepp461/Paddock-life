import type { IDatabase } from "../storage/IDatabase";
import { calculateBalanceAfterTransaction, calculateFacilityUpgradeCost, type EconomyTierId } from "./EconomyEngine";

export type FacilityId = "aero_center" | "engine_dept" | "chassis" | "simulator" | "rnd" | "academy";

export interface FacilityDefinition {
  readonly id: FacilityId;
  readonly label: string;
  readonly column: "aero_center_level" | "engine_dept_level" | "chassis_level" | "simulator_level" | "rnd_level" | "academy_level";
}

export const FACILITY_CATALOG: readonly FacilityDefinition[] = [
  { id: "aero_center", label: "Aero Center", column: "aero_center_level" },
  { id: "engine_dept", label: "Engine Department", column: "engine_dept_level" },
  { id: "chassis", label: "Chassis Workshop", column: "chassis_level" },
  { id: "simulator", label: "Driver Simulator", column: "simulator_level" },
  { id: "rnd", label: "R&D Department", column: "rnd_level" },
  { id: "academy", label: "Driver Academy", column: "academy_level" },
] as const;

export interface FacilityUpgradeResult {
  readonly teamId: string;
  readonly facility: FacilityId;
  readonly previousLevel: number;
  readonly newLevel: number;
  readonly cost: number;
  readonly balanceAfter: number;
}

function definitionFor(facility: FacilityId): FacilityDefinition {
  const definition = FACILITY_CATALOG.find((item) => item.id === facility);
  if (!definition) throw new Error("Fasilitas tidak dikenal.");
  return definition;
}

/** Upgrades a player-team facility and posts the cash/ledger mutation atomically. */
export async function upgradeTeamFacility(
  database: IDatabase,
  input: {
    readonly teamId: string;
    readonly facility: FacilityId;
    readonly season: number;
  },
): Promise<FacilityUpgradeResult> {
  if (!input.teamId.trim() || !Number.isSafeInteger(input.season) || input.season < 1) {
    throw new RangeError("Team ID dan season harus valid.");
  }
  const definition = definitionFor(input.facility);
  return database.transaction(async () => {
    const rows = await database.query(
      `SELECT t.cash, t.is_player_team, t.${definition.column} AS facility_level, d.tier
       FROM teams t JOIN divisions d ON d.division_id = t.division_id WHERE t.team_id = ?;`,
      [input.teamId],
    );
    const row = rows[0];
    if (!row) throw new Error("Tim tidak ditemukan.");
    if (Number(row.is_player_team) !== 1) throw new Error("Fasilitas hanya bisa ditingkatkan pada tim pemain.");
    const tier = Number(row.tier) as EconomyTierId;
    const previousLevel = Number(row.facility_level);
    const currentCash = Number(row.cash);
    if (currentCash < 0) throw new Error("Upgrade ditolak: lunasi saldo negatif sebelum mengembangkan fasilitas.");
    if (!Number.isSafeInteger(previousLevel) || previousLevel < 1 || previousLevel >= 10) {
      throw new Error("Fasilitas sudah mencapai level maksimum 10.");
    }
    const cost = calculateFacilityUpgradeCost(tier, previousLevel);
    const nextBalance = calculateBalanceAfterTransaction({ currentBalance: currentCash, amount: -cost, tier });
    if (!nextBalance.withinOverdraft) throw new Error("Upgrade ditolak karena melewati batas overdraft.");
    const newLevel = previousLevel + 1;
    const transactionId = `facility_${input.teamId}_S${input.season}_${input.facility}_L${newLevel}`;
    const existing = await database.query("SELECT amount FROM finances WHERE transaction_id = ?;", [transactionId]);
    if (existing.length) throw new Error("Upgrade ini sudah tercatat di ledger.");
    await database.run(`UPDATE teams SET ${definition.column} = ?, cash = ? WHERE team_id = ?;`, [newLevel, nextBalance.balanceAfter, input.teamId]);
    await database.run(
      "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, ?, NULL, 'expense', 'facility-upgrade', ?, ?);",
      [transactionId, input.teamId, input.season, -cost, nextBalance.balanceAfter],
    );
    return { teamId: input.teamId, facility: input.facility, previousLevel, newLevel, cost, balanceAfter: nextBalance.balanceAfter };
  });
}
