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
      "sponsor_pool", "team_sponsors", "sponsor_offers", "career_managers", "staff", "board_objectives", "season_settlements", "manager_job_offers", "development_projects", "development_history", "driver_negotiation_cooldowns", "team_division_history", "world_transition_steps", "board_objective_warnings", "division_promotion_offers", "game_config",
    ]));
    const versions = await database.query("SELECT version FROM schema_migrations;");
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 }, { version: 14 }, { version: 15 }, { version: 16 }]);
    const sourceConfigs = await database.query(
      "SELECT config_key, value_json, source_document FROM game_config WHERE config_key IN (?, ?, ?) ORDER BY config_key;",
      ["neutralization.safety_car_pace_multiplier", "pit.lane_speed_mps", "reliability.age_factor_cap"],
    );
    expect(sourceConfigs).toEqual([
      { config_key: "neutralization.safety_car_pace_multiplier", value_json: "1.4", source_document: "02_Simulation_Rules_Addendum_v1.docx" },
      { config_key: "pit.lane_speed_mps", value_json: "22.2", source_document: "02_Simulation_Rules_Addendum_v1.docx" },
      { config_key: "reliability.age_factor_cap", value_json: "1.5", source_document: "02_Simulation_Rules_Addendum_v1.docx" },
    ]);
    const gameConfigColumns = await database.query("PRAGMA table_info(game_config);");
    expect(gameConfigColumns.map((column) => column.name)).toContain("config_key");
    expect(gameConfigColumns.map((column) => column.name)).toContain("value_json");
    expect(gameConfigColumns.map((column) => column.name)).toContain("source_document");
    await database.run(
      "INSERT INTO game_config (config_key, scope, scope_id, value_json, source_document) VALUES (?, ?, ?, ?, ?);",
      ["example.test", "global", "global", JSON.stringify({ enabled: true }), "test fixture"],
    );
    await expect(database.run(
      "INSERT INTO game_config (config_key, scope, scope_id, value_json, source_document) VALUES (?, ?, ?, ?, ?);",
      ["example.test", "global", "global", JSON.stringify({ enabled: false }), "test fixture"],
    )).rejects.toThrow();
    await expect(database.run(
      "INSERT INTO game_config (config_key, scope, scope_id, value_json, source_document) VALUES (?, ?, ?, ?, ?);",
      ["example.invalid-json", "global", "global", "{", "test fixture"],
    )).rejects.toThrow();
    const circuitColumns = await database.query("PRAGMA table_info(circuits);");
    expect(circuitColumns.map((column) => column.name)).toContain("standard_laps");
    expect(circuitColumns.map((column) => column.name)).toContain("estimated_lap_seconds");
    const managerColumns = await database.query("PRAGMA table_info(career_managers);");
    expect(managerColumns.map((column) => column.name)).toContain("confidence");
    expect(managerColumns.map((column) => column.name)).toContain("consecutive_primary_misses");
    const teamColumns = await database.query("PRAGMA table_info(teams);");
    expect(teamColumns.map((column) => column.name)).toContain("severe_distress_seasons");
    const movementColumns = await database.query("PRAGMA table_info(team_division_history);");
    expect(movementColumns.map((column) => column.name)).toContain("from_tier");
    expect(movementColumns.map((column) => column.name)).toContain("to_tier");
    expect(movementColumns.map((column) => column.name)).toContain("reason");
    const transitionColumns = await database.query("PRAGMA table_info(world_transition_steps);");
    expect(transitionColumns.map((column) => column.name)).toContain("step");
    expect(transitionColumns.map((column) => column.name)).toContain("result_json");
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
