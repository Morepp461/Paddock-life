import type { IDatabase } from "../storage/IDatabase";

export interface HireStaffContractInput {
  readonly careerId: string;
  readonly teamId: string;
  readonly staffId: string;
  readonly currentSeason: number;
  readonly contractEndSeason: number;
}
export interface HireStaffContractResult {
  readonly staffId: string;
  readonly teamId: string;
  readonly salary: number;
  readonly contractEndSeason: number;
}
export interface ExpireStaffContractsResult {
  readonly expiredStaffIds: readonly string[];
}

function assertSeason(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(label + " harus integer positif.");
}
function stableEventId(type: "hired" | "expired", careerId: string, staffId: string, season: number): string {
  const value = [type, careerId, staffId, season].join("|");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "staff_contract_" + type + "_" + hash.toString(16).padStart(8, "0");
}

/** Hires a listed free agent at their generated asking salary. Salary is charged by RaceFinanceService per round. */
export async function hireFreeAgentStaff(
  database: IDatabase,
  input: HireStaffContractInput,
): Promise<HireStaffContractResult> {
  if (!input.careerId.trim() || !input.teamId.trim() || !input.staffId.trim()) {
    throw new Error("Career, team, dan staff ID wajib diisi.");
  }
  assertSeason(input.currentSeason, "Current season");
  assertSeason(input.contractEndSeason, "Contract end season");
  if (input.contractEndSeason < input.currentSeason) {
    throw new RangeError("Kontrak staf tidak boleh berakhir sebelum season berjalan.");
  }

  return database.transaction(async () => {
    const [teamRows, staffRows] = await Promise.all([
      database.query(
        "SELECT team_id, cash, is_active, is_player_team FROM teams WHERE team_id = ? AND career_id = ?;",
        [input.teamId, input.careerId],
      ),
      database.query(
        "SELECT staff_id, team_id, salary, is_free_agent, is_retired FROM staff WHERE staff_id = ? AND career_id = ?;",
        [input.staffId, input.careerId],
      ),
    ]);
    const team = teamRows[0];
    const staff = staffRows[0];
    if (!team) throw new Error("Tim pemain tidak ditemukan di career ini.");
    if (Number(team.is_active) !== 1 || Number(team.is_player_team) !== 1) {
      throw new Error("Staf hanya dapat direkrut oleh tim pemain yang aktif.");
    }
    if (Number(team.cash) < 0) throw new Error("Tim tidak dapat merekrut staf saat saldo kas negatif.");
    if (!staff) throw new Error("Kandidat staf tidak ditemukan di career ini.");
    if (Number(staff.is_retired) === 1) throw new Error("Staf sudah pensiun dan tidak bisa direkrut.");
    if (Number(staff.is_free_agent) !== 1 || staff.team_id !== null) {
      throw new Error("Kandidat staf tidak lagi tersedia di pasar.");
    }
    const salary = Number(staff.salary);
    if (!Number.isSafeInteger(salary) || salary < 0) throw new Error("Gaji kandidat staf tidak valid.");

    await database.run(
      "UPDATE staff SET team_id = ?, is_free_agent = 0, contract_end = ? WHERE staff_id = ? AND career_id = ? AND team_id IS NULL AND is_free_agent = 1 AND is_retired = 0;",
      [input.teamId, input.contractEndSeason, input.staffId, input.careerId],
    );
    const confirmed = await database.query(
      "SELECT team_id, is_free_agent FROM staff WHERE staff_id = ? AND career_id = ?;",
      [input.staffId, input.careerId],
    );
    if (!confirmed[0] || String(confirmed[0].team_id) !== input.teamId || Number(confirmed[0].is_free_agent) !== 0) {
      throw new Error("Kandidat staf berubah status selama proses perekrutan.");
    }
    await database.run(
      "INSERT INTO staff_contract_events (event_id, career_id, staff_id, team_id, event_type, season, salary, contract_end) VALUES (?, ?, ?, ?, 'hired', ?, ?, ?);",
      [stableEventId("hired", input.careerId, input.staffId, input.currentSeason), input.careerId,
        input.staffId, input.teamId, input.currentSeason, salary, input.contractEndSeason],
    );
    return {
      staffId: input.staffId,
      teamId: input.teamId,
      salary,
      contractEndSeason: input.contractEndSeason,
    };
  });
}

/** Internal helper for callers already inside the season-rollover transaction. */
export async function expireStaffContractsInTransaction(
  database: IDatabase,
  input: { readonly careerId: string; readonly newSeason: number },
): Promise<ExpireStaffContractsResult> {
  if (!input.careerId.trim()) throw new Error("Career ID wajib diisi.");
  assertSeason(input.newSeason, "New season");
  const rows = await database.query(
    "SELECT staff_id, team_id, salary, contract_end FROM staff WHERE career_id = ? AND team_id IS NOT NULL AND is_free_agent = 0 AND is_retired = 0 AND contract_end IS NOT NULL AND contract_end < ? ORDER BY staff_id;",
    [input.careerId, input.newSeason],
  );
  const expiredStaffIds: string[] = [];
  for (const row of rows) {
    const staffId = String(row.staff_id);
    const teamId = String(row.team_id);
    const salary = Number(row.salary);
    const contractEnd = Number(row.contract_end);
    await database.run(
      "UPDATE staff SET team_id = NULL, is_free_agent = 1, contract_end = NULL WHERE staff_id = ? AND career_id = ? AND team_id = ? AND is_free_agent = 0 AND contract_end < ?;",
      [staffId, input.careerId, teamId, input.newSeason],
    );
    const current = await database.query(
      "SELECT team_id, is_free_agent FROM staff WHERE staff_id = ? AND career_id = ?;",
      [staffId, input.careerId],
    );
    if (!current[0] || current[0].team_id !== null || Number(current[0].is_free_agent) !== 1) continue;
    await database.run(
      "INSERT OR IGNORE INTO staff_contract_events (event_id, career_id, staff_id, team_id, event_type, season, salary, contract_end) VALUES (?, ?, ?, ?, 'expired', ?, ?, ?);",
      [stableEventId("expired", input.careerId, staffId, input.newSeason), input.careerId,
        staffId, teamId, input.newSeason, salary, contractEnd],
    );
    expiredStaffIds.push(staffId);
  }
  return { expiredStaffIds };
}

/** Standalone idempotent contract expiry entry point, also used by tests and maintenance tooling. */
export async function expireStaffContractsForSeason(
  database: IDatabase,
  input: { readonly careerId: string; readonly newSeason: number },
): Promise<ExpireStaffContractsResult> {
  return database.transaction(() => expireStaffContractsInTransaction(database, input));
}
