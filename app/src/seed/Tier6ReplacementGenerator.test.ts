import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld, generateTier6ReplacementTeams } from "./CareerWorldGenerator";

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
    return Promise.resolve(new Response(readFileSync(new URL("../../public/seed/" + filename, import.meta.url), "utf8"), { status: 200 }));
  } catch {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
}

describe("Tier 6 replacement team generation", () => {
  it("fills a bankrupt Tier 6 slot with a complete, deterministic generated team", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "tier6-replacement-test",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const bankrupt = await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T6' AND is_active = 1 ORDER BY team_id LIMIT 1;",
        [career.careerId],
      );
      const bankruptTeamId = String(bankrupt[0]!.team_id);
      await database.run("UPDATE teams SET is_active = 0 WHERE team_id = ?;", [bankruptTeamId]);
      await database.run(
        "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, 2, 'financial-movement', ?);",
        [career.careerId, JSON.stringify({ newTier6SlotsNeeded: 1 })],
      );

      const result = await generateTier6ReplacementTeams(database, { careerId: career.careerId, season: 2 });
      expect(result.slotsFilled).toBe(1);
      expect(result.createdTeamIds).toHaveLength(1);
      const teamId = result.createdTeamIds[0]!;
      const teamRows = await database.query(
        "SELECT name, division_id, origin, founded_season, finance_grade, performance_grade, budget, cash FROM teams WHERE team_id = ?;",
        [teamId],
      );
      expect(teamRows).toHaveLength(1);
      expect(teamRows[0]?.division_id).toBe("T6");
      expect(teamRows[0]?.origin).toBe("generated");
      expect(teamRows[0]?.founded_season).toBe(2);
      expect(["C", "D"]).toContain(teamRows[0]?.finance_grade);
      expect(["C", "D"]).toContain(teamRows[0]?.performance_grade);
      expect(Number(teamRows[0]?.budget)).toBe(3_000_000);
      expect(Number(teamRows[0]?.cash)).toBeGreaterThanOrEqual(0);

      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND division_id = 'T6' AND is_active = 1;", [career.careerId]))
        .toEqual([{ count: 12 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM cars WHERE team_id = ? AND season = 2;", [teamId]))
        .toEqual([{ count: 1 }]);
      const drivers = await database.query(
        "SELECT d.age, d.is_academy_driver, dc.start_season, dc.end_season FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id WHERE dc.team_id = ? AND dc.start_season = 2 AND dc.end_season = 2;",
        [teamId],
      );
      expect(drivers).toHaveLength(2);
      for (const driver of drivers) {
        expect(Number(driver.age)).toBeGreaterThanOrEqual(8);
        expect(Number(driver.age)).toBeLessThanOrEqual(11);
        expect(driver.is_academy_driver).toBe(0);
      }
      expect(await database.query("SELECT COUNT(*) AS count FROM staff WHERE team_id = ?;", [teamId]))
        .toEqual([{ count: 3 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM finances WHERE team_id = ?;", [teamId]))
        .toEqual([{ count: 2 }]);
      expect(await database.query("SELECT reason FROM team_division_history WHERE team_id = ? AND season = 2;", [teamId]))
        .toEqual([{ reason: "new_entrant" }]);
      expect(await database.query("SELECT step FROM world_transition_steps WHERE career_id = ? AND season = 2 AND step = 'tier6-replacement';", [career.careerId]))
        .toHaveLength(1);

      await expect(generateTier6ReplacementTeams(database, { careerId: career.careerId, season: 2 }))
        .rejects.toThrow("sudah dijalankan");
    } finally {
      await database.close();
    }
  });

  it("does not generate a replacement without the financial movement step", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "tier6-replacement-guard",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      await expect(generateTier6ReplacementTeams(database, { careerId: career.careerId, season: 2 }))
        .rejects.toThrow("Financial division movement");
      expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND origin = 'generated';", [career.careerId]))
        .toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});
