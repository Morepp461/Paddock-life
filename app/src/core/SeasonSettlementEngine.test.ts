import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { settleCareerSeason } from "./SeasonSettlementEngine";

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

describe("season financial settlement", () => {
  it("settles all teams atomically and refuses a duplicate settlement", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "season-settlement-test",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      await database.run("UPDATE races SET status = 'completed' WHERE division_id = 'T3' AND season = 1;");
      const teams = await database.query("SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T3' ORDER BY team_id;", [career.careerId]);
      for (let index = 0; index < teams.length; index += 1) {
        await database.run(
          "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, 1, 'T3', NULL, ?, ?, 0, 0, 0, 0, 0);",
          ["test_team_standing_" + index, String(teams[index]!.team_id), 12 - index],
        );
      }
      const result = await settleCareerSeason(database, { careerId: career.careerId, season: 1, tier: 3 });
      expect(result.teamsSettled).toBe(12);
      expect(result.settlements[0]?.constructorPosition).toBe(1);
      expect(result.settlements[0]?.prizeMoney).toBeGreaterThan(result.settlements[11]?.prizeMoney ?? 0);
      expect(await database.query("SELECT COUNT(*) AS count FROM season_settlements WHERE career_id = ? AND season = 1;", [career.careerId])).toEqual([{ count: 12 }]);
      const financeCountBeforeRetry = await database.query("SELECT COUNT(*) AS count FROM finances WHERE team_id IN (SELECT team_id FROM teams WHERE career_id = ?) AND season = 1;", [career.careerId]);
      const repeated = await settleCareerSeason(database, { careerId: career.careerId, season: 1, tier: 3 });
      expect(repeated).toEqual(result);
      expect(await database.query("SELECT COUNT(*) AS count FROM finances WHERE team_id IN (SELECT team_id FROM teams WHERE career_id = ?) AND season = 1;", [career.careerId])).toEqual(financeCountBeforeRetry);
    } finally {
      await database.close();
    }
  });

  it("refuses to settle while a scheduled round remains", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "season-settlement-incomplete",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      await expect(settleCareerSeason(database, { careerId: career.careerId, season: 1, tier: 3 })).rejects.toThrow("semua ronde harus selesai");
      expect(await database.query("SELECT COUNT(*) AS count FROM season_settlements;")).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});
