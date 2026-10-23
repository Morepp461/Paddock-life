import initSqlJs from "sql.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { SqlJsDatabase } from "./SqlJsDatabase";
import { runMigrations } from "./Migrations";
import type { IDatabase } from "./IDatabase";

describe("local schema migrations", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
  });

  afterAll(async () => {
    await database.close();
  });

  it("creates the core PRD tables and applies migration only once", async () => {
    await runMigrations(database);
    await runMigrations(database);
    const rows = await database.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    );
    const tableNames = rows.map((row) => row.name);
    expect(tableNames).toEqual(expect.arrayContaining([
      "career", "divisions", "teams", "drivers", "driver_contracts",
      "cars", "circuits", "races", "race_results", "finances", "standings",
      "schema_migrations", "team_pool", "name_culture_pool", "nationality_name_cultures", "blocked_names",
      "sponsor_pool", "team_sponsors", "sponsor_offers", "career_managers", "staff", "board_objectives", "season_settlements", "development_projects", "development_history", "driver_negotiation_cooldowns",
    ]));
    const versions = await database.query("SELECT version FROM schema_migrations;");
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }]);
    const circuitColumns = await database.query("PRAGMA table_info(circuits);");
    expect(circuitColumns.map((column) => column.name)).toContain("standard_laps");
    expect(circuitColumns.map((column) => column.name)).toContain("estimated_lap_seconds");
    const managerColumns = await database.query("PRAGMA table_info(career_managers);");
    expect(managerColumns.map((column) => column.name)).toContain("confidence");
    expect(managerColumns.map((column) => column.name)).toContain("consecutive_primary_misses");
  });

  it("enforces documented career mode and tier constraints", async () => {
    await expect(database.run(
      "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ["career-invalid", "Invalid", 7, 3, "career", "normal", "seed"],
    )).rejects.toThrow();

    await database.run(
      "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ["career-valid", "Test Career", 3, 3, "career", "normal", "seed-1"],
    );
    const rows = await database.query("SELECT career_id, current_division_tier FROM career;");
    expect(rows).toEqual([{ career_id: "career-valid", current_division_tier: 3 }]);
  });

  it("rolls back all changes when a transaction fails", async () => {
    await expect(database.transaction(async () => {
      await database.run(
        "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["career-rollback", "Rollback", 3, 3, "career", "normal", "seed-2"],
      );
      throw new Error("intentional test failure");
    })).rejects.toThrow("intentional test failure");

    const rows = await database.query("SELECT career_id FROM career WHERE career_id = ?;", ["career-rollback"]);
    expect(rows).toHaveLength(0);
  });
});
