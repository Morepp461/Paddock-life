import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIER_CONFIG } from "../core/GameConfig";
import { runMigrations } from "../storage/Migrations";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import type { IDatabase } from "../storage/IDatabase";
import { seedDivisions } from "./WorldSeeder";

describe("static world bootstrap", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
    await runMigrations(database);
  });

  afterAll(async () => {
    await database.close();
  });

  it("seeds all six divisions with source-backed round counts and unlock visibility", async () => {
    await seedDivisions(database);
    await seedDivisions(database);
    const rows = await database.query("SELECT tier, rounds_per_season, is_playable, is_visible FROM divisions ORDER BY tier;");
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => [row.tier, row.rounds_per_season])).toEqual([
      [1, 24], [2, 24], [3, 18], [4, 12], [5, 10], [6, 8],
    ]);
    expect(rows.map((row) => [row.is_playable, row.is_visible])).toEqual([
      [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [0, 0],
    ]);
    expect(rows[0].rounds_per_season).toBe(TIER_CONFIG[1].roundsPerSeason);
  });
});
