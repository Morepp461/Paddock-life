import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { calculateTeamRacePayrollCosts } from "./RaceFinanceService";
import { TIER_CONFIG } from "./GameConfig";

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

describe("team race payroll", () => {
  it("uses the team's active contracts and distributes every salary exactly across the season", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa", managerCountryCode: "IDN", difficulty: "normal",
        path: "takeover", worldSeed: "team-payroll-integration", takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const team = (await database.query(
        "SELECT team_id, division_id FROM teams WHERE career_id = ? AND is_player_team = 1;",
        [career.careerId],
      ))[0]!;
      const teamId = String(team.team_id);
      const tier = Number(String(team.division_id).replace("T", "")) as 1 | 2 | 3 | 4 | 5 | 6;
      await database.run(
        `UPDATE driver_contracts SET salary = CASE driver_id
          WHEN (SELECT d.driver_id FROM drivers d JOIN driver_contracts x ON x.driver_id = d.driver_id WHERE x.team_id = ? AND d.is_academy_driver = 0 ORDER BY d.driver_id LIMIT 1) THEN 101
          ELSE 202 END
         WHERE team_id = ? AND start_season <= 1 AND end_season >= 1
           AND driver_id IN (SELECT driver_id FROM drivers WHERE is_academy_driver = 0 AND is_retired = 0);`,
        [teamId, teamId],
      );
      await database.run("UPDATE staff SET salary = 1001 WHERE team_id = ? AND is_free_agent = 0;", [teamId]);
      const annualDriver = Number((await database.query(
        `SELECT COALESCE(SUM(dc.salary), 0) AS total FROM driver_contracts dc JOIN drivers d ON d.driver_id = dc.driver_id
         WHERE dc.team_id = ? AND dc.start_season <= 1 AND dc.end_season >= 1 AND d.is_retired = 0 AND d.is_academy_driver = 0;`,
        [teamId],
      ))[0]?.total ?? 0);
      const annualStaff = Number((await database.query(
        "SELECT COALESCE(SUM(salary), 0) AS total FROM staff WHERE team_id = ? AND is_free_agent = 0 AND (contract_end IS NULL OR contract_end >= 1);",
        [teamId],
      ))[0]?.total ?? 0);
      let driverTotal = 0;
      let staffTotal = 0;
      for (let round = 1; round <= TIER_CONFIG[tier].roundsPerSeason; round += 1) {
        const costs = await calculateTeamRacePayrollCosts(database, { teamId, season: 1, tier, round });
        driverTotal += costs.driverPayroll;
        staffTotal += costs.staffPayroll;
      }
      if (tier === 6) {
        expect(driverTotal).toBe(0);
        expect(staffTotal).toBe(0);
      } else {
        expect(driverTotal).toBe(annualDriver);
        expect(staffTotal).toBe(annualStaff);
      }
    } finally {
      await database.close();
    }
  });

  it("rejects rounds outside the active season", async () => {
    const database = await makeDatabase();
    try {
      await expect(calculateTeamRacePayrollCosts(database, {
        teamId: "team", season: 1, tier: 1, round: 25,
      })).rejects.toThrow("Round harus");
    } finally {
      await database.close();
    }
  });
});
