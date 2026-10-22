import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "./CareerWorldGenerator";
import { seedStaticWorldDataFromPublic } from "./WorldSeeder";

async function makeDatabase() {
  const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SqlJsDatabase(new SQL.Database());
  await runMigrations(database);
  return database;
}

function seedFetcher(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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
      expect(result.driversCreated).toBe(270);
      expect(result.racesScheduled).toBeGreaterThan(0);
      expect(result.managersCreated).toBe(7);
      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ?;", [result.careerId])).toEqual([{ count: 72 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM cars;")).toEqual([{ count: 72 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM finances;")).toEqual([{ count: 144 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM drivers WHERE career_id = ?;", [result.careerId])).toEqual([{ count: 270 }]);
      expect(await database.query("SELECT COUNT(DISTINCT lower(name)) AS count FROM drivers WHERE career_id = ?;", [result.careerId])).toEqual([{ count: 270 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM drivers WHERE career_id = ? AND is_academy_driver = 1;", [result.careerId])).toEqual([{ count: 96 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM races;")).toEqual([{ count: result.racesScheduled }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND is_player_team = 1;", [result.careerId])).toEqual([{ count: 1 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM sponsor_offers WHERE career_id = ?;", [result.careerId])).toEqual([{ count: result.sponsorOffersCreated }]);
    } finally {
      await database.close();
    }
  });

  it("replaces a weak or medium AI team for a new team career", async () => {
    const database = await makeDatabase();
    try {
      await seedStaticWorldDataFromPublic(database, { fetcher: seedFetcher });
      const candidates = await database.query("SELECT pool_team_id FROM team_pool WHERE tier = 3 AND strength_class != 'Kuat' ORDER BY pool_team_id LIMIT 1;");
      const usedCodes = new Set((await database.query("SELECT code FROM team_pool;")).map((row) => String(row.code)));
      const teamCode = ["PDX", "PLX", "NXT", "PAX"].find((code) => !usedCodes.has(code));
      expect(candidates[0]).toBeDefined();
      expect(teamCode).toBeDefined();
      const result = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "new-team",
        worldSeed: "career-generation-new-team",
        newTeam: {
          name: "Paddock Dynamics",
          code: teamCode!,
          countryCode: "IDN",
          tier: 3,
          replacedTeamId: String(candidates[0]!.pool_team_id),
        },
      }, { fetcher: seedFetcher, managerGender: "male" });
      const playerTeam = await database.query("SELECT name, strength_grade, finance_grade, performance_grade, base_country FROM teams WHERE career_id = ? AND is_player_team = 1;", [result.careerId]);
      expect(playerTeam).toEqual([{ name: "Paddock Dynamics", strength_grade: "C", finance_grade: "C", performance_grade: "C", base_country: "Indonesia" }]);
      expect(await database.query("SELECT highest_unlocked_tier FROM career WHERE career_id = ?;", [result.careerId])).toEqual([{ highest_unlocked_tier: 3 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ?;", [result.careerId])).toEqual([{ count: 72 }]);
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
