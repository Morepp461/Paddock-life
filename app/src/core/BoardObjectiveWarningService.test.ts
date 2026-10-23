import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { checkBoardObjectiveMidseason, listBoardObjectiveWarnings } from "./BoardObjectiveWarningService";

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

describe("mid-season board objective warnings", () => {
  it("warns at the 50% checkpoint once without reducing manager confidence", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa", managerCountryCode: "IDN", difficulty: "normal",
        path: "takeover", worldSeed: "board-warning-midseason-test", takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const player = (await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;",
        [career.careerId],
      ))[0]!;
      const teamId = String(player.team_id);
      await database.run("UPDATE races SET status = 'completed' WHERE division_id = 'T3' AND season = 1 AND round <= 9;");
      await database.run("UPDATE board_objectives SET target_value = 1 WHERE team_id = ? AND season = 1 AND objective_type = 'standings';", [teamId]);
      const teams = await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T3' AND is_active = 1 ORDER BY team_id;",
        [career.careerId],
      );
      for (let index = 0; index < teams.length; index += 1) {
        const currentTeamId = String(teams[index]!.team_id);
        const points = currentTeamId === teamId ? -1 : 100 - index;
        await database.run(
          "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, 1, 'T3', NULL, ?, ?, 0, 0, 0, 0, 0);",
          ["board-warning-standing-" + index, currentTeamId, points],
        );
      }
      const before = await database.query(
        "SELECT confidence FROM career_managers WHERE career_id = ? AND is_player = 1 AND team_id = ? AND status = 'active';",
        [career.careerId, teamId],
      );
      const warning = await checkBoardObjectiveMidseason(database, {
        careerId: career.careerId, teamId, season: 1, tier: 3,
      });
      expect(warning?.checkpointPercent).toBe(50);
      expect(warning?.atRisk).toBe(true);
      expect(warning?.forecastRank).toBe(12);
      expect(warning?.message).toContain("Board Objective at risk");
      expect(await listBoardObjectiveWarnings(database, { careerId: career.careerId, teamId, season: 1 })).toHaveLength(1);
      const repeated = await checkBoardObjectiveMidseason(database, {
        careerId: career.careerId, teamId, season: 1, tier: 3,
      });
      expect(repeated).toEqual(warning);
      const after = await database.query(
        "SELECT confidence FROM career_managers WHERE career_id = ? AND is_player = 1 AND team_id = ? AND status = 'active';",
        [career.careerId, teamId],
      );
      expect(after).toEqual(before);
      expect(await database.query(
        "SELECT COUNT(*) AS count FROM board_objective_warnings WHERE career_id = ? AND team_id = ? AND season = 1;",
        [career.careerId, teamId],
      )).toEqual([{ count: 1 }]);
    } finally {
      await database.close();
    }
  });

  it("does not create a warning away from a documented checkpoint or in Tier 6", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa", managerCountryCode: "IDN", difficulty: "normal",
        path: "takeover", worldSeed: "board-warning-no-checkpoint-test", takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const player = (await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;",
        [career.careerId],
      ))[0]!;
      await database.run("UPDATE races SET status = 'completed' WHERE division_id = 'T3' AND season = 1 AND round <= 3;");
      expect(await checkBoardObjectiveMidseason(database, {
        careerId: career.careerId, teamId: String(player.team_id), season: 1, tier: 3,
      })).toBeNull();
      expect(await checkBoardObjectiveMidseason(database, {
        careerId: career.careerId, teamId: String(player.team_id), season: 1, tier: 6,
      })).toBeNull();
    } finally {
      await database.close();
    }
  });
});
