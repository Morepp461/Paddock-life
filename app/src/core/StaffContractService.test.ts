import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import type { IDatabase } from "../storage/IDatabase";
import { expireStaffContractsForSeason, hireFreeAgentStaff } from "./StaffContractService";

describe("staff contract service", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
    await runMigrations(database);
    await database.run(
      "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ["staff-contract-career", "Staff Contract Test", 3, 3, "career", "normal", "staff-contract-seed"],
    );
    await database.run(
      "INSERT INTO divisions (division_id, tier, name, rounds_per_season, distance_factor, min_driver_age, max_driver_age, required_budget, is_playable, is_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      ["T3", 3, "Rising Series", 18, 0.9, 16, 19, 38_000_000, 1, 1],
    );
    await database.run(
      "INSERT INTO teams (team_id, career_id, division_id, name, is_player_team, base_country, origin, founded_season, strength_grade, finance_grade, performance_grade, personality, cash, debt, budget) VALUES (?, ?, ?, ?, 1, ?, 'generated', 1, 'B', 'B', 'B', 'balanced', 1000000, 0, 38000000);",
      ["staff-player-team", "staff-contract-career", "T3", "Player Team", "IDN"],
    );
    await database.run(
      "INSERT INTO staff (staff_id, career_id, team_id, role, name, nationality, name_culture, gender, age, skill, specialization, reputation, salary, potential, is_free_agent) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1);",
      ["staff-candidate-1", "staff-contract-career", "Mechanic", "Raka Test", "IDN", "N01", "male", 35, 72, "Pit Crew", 20, 240000, 80],
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it("hires a free agent at their listed salary and records the chosen contract end", async () => {
    const result = await hireFreeAgentStaff(database, {
      careerId: "staff-contract-career", teamId: "staff-player-team", staffId: "staff-candidate-1",
      currentSeason: 1, contractEndSeason: 2,
    });
    expect(result).toEqual({
      staffId: "staff-candidate-1", teamId: "staff-player-team",
      salary: 240000, contractEndSeason: 2,
    });
    expect(await database.query(
      "SELECT team_id, is_free_agent, contract_end FROM staff WHERE staff_id = ?;",
      ["staff-candidate-1"],
    )).toEqual([{ team_id: "staff-player-team", is_free_agent: 0, contract_end: 2 }]);
    expect(await database.query(
      "SELECT event_type, season, salary, contract_end FROM staff_contract_events WHERE staff_id = ?;",
      ["staff-candidate-1"],
    )).toEqual([{ event_type: "hired", season: 1, salary: 240000, contract_end: 2 }]);
  });

  it("expires contracts only after their end season and is idempotent", async () => {
    const first = await expireStaffContractsForSeason(database, {
      careerId: "staff-contract-career", newSeason: 2,
    });
    expect(first.expiredStaffIds).toEqual([]);
    const second = await expireStaffContractsForSeason(database, {
      careerId: "staff-contract-career", newSeason: 3,
    });
    expect(second.expiredStaffIds).toEqual(["staff-candidate-1"]);
    expect(await database.query(
      "SELECT team_id, is_free_agent, contract_end FROM staff WHERE staff_id = ?;",
      ["staff-candidate-1"],
    )).toEqual([{ team_id: null, is_free_agent: 1, contract_end: null }]);
    expect(await database.query(
      "SELECT event_type, season FROM staff_contract_events WHERE staff_id = ? ORDER BY season;",
      ["staff-candidate-1"],
    )).toEqual([{ event_type: "hired", season: 1 }, { event_type: "expired", season: 3 }]);
    await expect(expireStaffContractsForSeason(database, {
      careerId: "staff-contract-career", newSeason: 3,
    })).resolves.toEqual({ expiredStaffIds: [] });
    expect(await database.query(
      "SELECT COUNT(*) AS count FROM staff_contract_events WHERE staff_id = ? AND event_type = 'expired';",
      ["staff-candidate-1"],
    )).toEqual([{ count: 1 }]);
  });

  it("rejects hiring while the player team is in debt and leaves the candidate untouched", async () => {
    await database.run("UPDATE teams SET cash = -1 WHERE team_id = ?;", ["staff-player-team"]);
    await expect(hireFreeAgentStaff(database, {
      careerId: "staff-contract-career", teamId: "staff-player-team", staffId: "staff-candidate-1",
      currentSeason: 1, contractEndSeason: 1,
    })).rejects.toThrow("saldo kas negatif");
    expect(await database.query(
      "SELECT team_id, is_free_agent FROM staff WHERE staff_id = ?;",
      ["staff-candidate-1"],
    )).toEqual([{ team_id: null, is_free_agent: 1 }]);
    expect(await database.query("SELECT COUNT(*) AS count FROM staff_contract_events;"))
      .toEqual([{ count: 0 }]);
  });

  it("rejects contract end seasons before the active season", async () => {
    await expect(hireFreeAgentStaff(database, {
      careerId: "staff-contract-career", teamId: "staff-player-team", staffId: "staff-candidate-1",
      currentSeason: 3, contractEndSeason: 2,
    })).rejects.toThrow("sebelum season berjalan");
  });
});
