import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { createManagerJobOffers, resolveBoardObjectivesForSeason } from "./BoardObjectiveService";

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

describe("board objective lifecycle", () => {
  it("creates source-backed objectives, resolves them once, and records manager outcomes", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "board-objective-lifecycle-test",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const playerTeam = (await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;",
        [career.careerId],
      ))[0]!;
      const teamId = String(playerTeam.team_id);
      const initialObjectives = await database.query(
        "SELECT objective_type, target_value, expected_rank FROM board_objectives WHERE team_id = ? AND season = 1 ORDER BY objective_type;",
        [teamId],
      );
      expect(initialObjectives.some((row) => row.objective_type === "standings")).toBe(true);
      expect(initialObjectives.some((row) => row.objective_type === "financial")).toBe(true);
      expect(initialObjectives.every((row) => Number(row.expected_rank) >= 1 && Number(row.expected_rank) <= 12)).toBe(true);

      await database.run("UPDATE races SET status = 'completed' WHERE division_id = 'T3' AND season = 1;");
      const teams = await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T3' AND is_active = 1 ORDER BY team_id;",
        [career.careerId],
      );
      for (let index = 0; index < teams.length; index += 1) {
        await database.run(
          "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, 1, 'T3', NULL, ?, ?, 0, 0, 0, 0, 0);",
          ["board_test_standing_" + index, String(teams[index]!.team_id), teams[index]!.team_id === teamId ? 80 : 20 - index],
        );
      }
      await database.run(
        "INSERT INTO season_settlements (settlement_id, career_id, team_id, division_id, season, net_amount, closing_cash, settlement_json) VALUES ('board-test-settlement', ?, ?, 'T3', 1, 0, 20000000, '{}');",
        [career.careerId, teamId],
      );
      const resolution = await resolveBoardObjectivesForSeason(database, { careerId: career.careerId, season: 1 });
      expect(resolution.teamId).toBe(teamId);
      expect(resolution.confidence).toBeGreaterThanOrEqual(0);
      expect(resolution.confidence).toBeLessThanOrEqual(100);
      expect(await database.query(
        "SELECT COUNT(*) AS count FROM board_objectives WHERE team_id = ? AND season = 1 AND result IS NOT NULL;",
        [teamId],
      )).toEqual([{ count: initialObjectives.length }]);
      const repeated = await resolveBoardObjectivesForSeason(database, { careerId: career.careerId, season: 1 });
      expect(repeated).toEqual(resolution);
      const jobOffers = await createManagerJobOffers(database, {
        careerId: career.careerId, completedSeason: 1, nextSeason: 2, resolution,
      });
      expect(jobOffers.created).toBeGreaterThanOrEqual(0);
    } finally {
      await database.close();
    }
  });
});
