import initSqlJs from "sql.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { incrementComponentServiceAgeForRace } from "./CarComponentService";
import type { IDatabase } from "../storage/IDatabase";

describe("car component service age", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
    await runMigrations(database);
    await database.run(
      "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ["career-service-age", "Service Age Test", 1, 1, "career", "normal", "service-age-seed"],
    );
    await database.run(
      "INSERT INTO divisions (division_id, tier, name, rounds_per_season, distance_factor, min_driver_age, max_driver_age, required_budget, is_playable, is_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      ["T1", 1, "Test Tier", 24, 1, 18, 45, 1000, 1, 1],
    );
    await database.run(
      "INSERT INTO teams (team_id, career_id, division_id, name, base_country, origin, founded_season, strength_grade, finance_grade, performance_grade, personality, cash, debt, budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      ["team-service-age", "career-service-age", "T1", "Test Team", "GBR", "generated", 1, "B", "B", "B", "balanced", 1000, 0, 1000],
    );
    await database.run(
      "INSERT INTO cars (car_id, team_id, season, engine_power, aero, high_speed, medium_speed, low_speed, mechanical_grip, traction, braking, tyre_management, engine_reliability, gearbox_reliability, brake_reliability, suspension_reliability, electronics_reliability) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      ["car-service-age", "team-service-age", 1, 50, 50, 50, 50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 75],
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it("increments each component age for the completed race's active tier cars", async () => {
    await incrementComponentServiceAgeForRace(database, { careerId: "career-service-age", tier: 1, season: 1 });
    const rows = await database.query(
      "SELECT component, races_since_reset FROM car_component_service WHERE car_id = ? ORDER BY component;",
      ["car-service-age"],
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.races_since_reset === 1)).toBe(true);
    await incrementComponentServiceAgeForRace(database, { careerId: "career-service-age", tier: 1, season: 1 });
    const secondRead = await database.query(
      "SELECT races_since_reset FROM car_component_service WHERE car_id = ?;",
      ["car-service-age"],
    );
    expect(secondRead.every((row) => row.races_since_reset === 2)).toBe(true);
  });

  it("rejects invalid career, tier, and season inputs", async () => {
    await expect(incrementComponentServiceAgeForRace(database, { careerId: " ", tier: 1, season: 1 })).rejects.toThrow("Career ID");
    await expect(incrementComponentServiceAgeForRace(database, { careerId: "career-service-age", tier: 1, season: 0 })).rejects.toThrow(RangeError);
    await expect(incrementComponentServiceAgeForRace(database, { careerId: "career-service-age", tier: 7 as never, season: 1 })).rejects.toThrow(RangeError);
  });
});
