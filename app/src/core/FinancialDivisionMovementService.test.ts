import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { applyFinancialDivisionMovement } from "./FinancialDivisionMovementService";

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
async function makeCareer(database: SqlJsDatabase, seed: string) {
  return generateCareerWorld(database, {
    managerName: "Mata Dewa",
    managerCountryCode: "IDN",
    difficulty: "normal",
    path: "takeover",
    worldSeed: seed,
    takeoverTeamId: "D3-01",
  }, { fetcher: seedFetcher, managerGender: "male" });
}
async function completeSeasonAndSettle(database: SqlJsDatabase, careerId: string) {
  await database.run("UPDATE races SET status = 'completed';");
  const teams = await database.query("SELECT team_id, division_id, cash FROM teams WHERE career_id = ? ORDER BY team_id;", [careerId]);
  for (const team of teams) {
    const teamId = String(team.team_id);
    await database.run(
      `INSERT INTO season_settlements
        (settlement_id, career_id, team_id, division_id, season, prize_money, commercial_revenue, sponsor_revenue,
         interest_cost, facility_maintenance, net_amount, closing_cash, settlement_json)
       VALUES (?, ?, ?, ?, 1, 0, 0, 0, 0, 0, 0, ?, '{}');`,
      ["test_settle_" + teamId, careerId, teamId, String(team.division_id), Number(team.cash)],
    );
  }
}

describe("financial division movement persistence", () => {
  it("persists movements and history atomically, then rejects duplicate execution", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "movement-service-test");
      await completeSeasonAndSettle(database, career.careerId);
      const targetRows = await database.query("SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T1' ORDER BY team_id LIMIT 1;", [career.careerId]);
      const distressedTeamId = String(targetRows[0]!.team_id);
      await database.run("UPDATE teams SET cash = -200000000 WHERE team_id = ?;", [distressedTeamId]);

      const result = await applyFinancialDivisionMovement(database, { careerId: career.careerId, completedSeason: 1 });
      expect(result.events.some((event) => event.teamId === distressedTeamId && event.reason === "financial_relegation")).toBe(true);
      expect((await database.query("SELECT division_id FROM teams WHERE team_id = ?;", [distressedTeamId]))[0]?.division_id).toBe("T2");
      expect((await database.query("SELECT COUNT(*) AS count FROM team_division_history WHERE career_id = ? AND team_id = ? AND season = 2;", [career.careerId, distressedTeamId]))[0]?.count).toBe(1);
      expect((await database.query("SELECT step FROM world_transition_steps WHERE career_id = ? AND season = 2;", [career.careerId]))[0]?.step).toBe("financial-movement");
      for (const tier of [1, 2, 3, 4, 5] as const) {
        expect(await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND division_id = ? AND is_active = 1;", [career.careerId, "T" + tier])).toEqual([{ count: 12 }]);
      }
      await expect(applyFinancialDivisionMovement(database, { careerId: career.careerId, completedSeason: 1 }))
        .rejects.toThrow("already been applied");
    } finally {
      await database.close();
    }
  });

  it("refuses movement until all races and financial settlements are complete", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "movement-service-guard-test");
      await expect(applyFinancialDivisionMovement(database, { careerId: career.careerId, completedSeason: 1 }))
        .rejects.toThrow("finish every race first");
      expect(await database.query("SELECT COUNT(*) AS count FROM team_division_history;")).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});
