import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "./CareerWorldGenerator";

async function makeDatabase() {
  const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SqlJsDatabase(new SQL.Database());
  await runMigrations(database);
  return database;
}

function seedFetcher(url: string): Promise<Response> {
  const filename = url.replace(/^\/seed\//, "");
  try {
    const body = readFileSync(new URL("../../public/seed/" + filename, import.meta.url), "utf8");
    return Promise.resolve(new Response(body, { status: 200 }));
  } catch {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
}

describe("atomic career world generation", () => {
  it("creates a complete deterministic world from the canonical seed data", async () => {
    const database = await makeDatabase();
    try {
      const result = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "career-generation-test-01",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });

      expect(result.selectedTier).toBe(3);
      expect(result.teamsCreated).toBe(72);
      expect(result.driversCreated).toBe(174);
      expect(result.racesScheduled).toBeGreaterThan(0);
      expect(result.managersCreated).toBe(7);
      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ?;", [result.careerId])).toEqual([{ count: 72 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM cars;")).toEqual([{ count: 72 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM drivers WHERE career_id = ?;", [result.careerId])).toEqual([{ count: 174 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM races;")).toEqual([{ count: result.racesScheduled }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND is_player_team = 1;", [result.careerId])).toEqual([{ count: 1 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM sponsor_offers WHERE career_id = ?;", [result.careerId])).toEqual([{ count: result.sponsorOffersCreated }]);
    } finally {
      await database.close();
    }
  });

  it("does not create a career when setup validation fails", async () => {
    const database = await makeDatabase();
    try {
      await expect(generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "career-generation-invalid",
        takeoverTeamId: "D6-01",
      }, { fetcher: seedFetcher })).rejects.toThrow("Tier 6 tidak tersedia");
      expect(await database.query("SELECT COUNT(*) AS count FROM career;")).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});
