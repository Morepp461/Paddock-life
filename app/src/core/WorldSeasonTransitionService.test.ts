import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { settleCareerSeason } from "./SeasonSettlementEngine";
import { transitionWorldAfterSeason } from "./WorldSeasonTransitionService";
import { INITIAL_DISTRIBUTIONS } from "./InitialDistributions";

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

describe("world season transition", () => {
  it("applies financial movement and Tier 6 replacement once after all six divisions settle", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "world-season-transition-test",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });

      await database.run("UPDATE races SET status = 'completed' WHERE season = 1;");
      const teams = await database.query("SELECT team_id, division_id FROM teams WHERE career_id = ? AND is_active = 1;", [career.careerId]);
      for (const team of teams) {
        const tier = Number(String(team.division_id).replace("T", "")) as 1 | 2 | 3 | 4 | 5 | 6;
        await database.run("UPDATE teams SET cash = ?, debt = 0, distress_seasons = 0, severe_distress_seasons = 0, movement_cooldown = 0 WHERE team_id = ?;",
          [INITIAL_DISTRIBUTIONS[tier].requiredBudget * 100, String(team.team_id)]);
      }
      for (const tier of [1, 2, 3, 4, 5, 6] as const) {
        await settleCareerSeason(database, { careerId: career.careerId, season: 1, tier });
      }

      const first = await transitionWorldAfterSeason(database, { careerId: career.careerId, completedSeason: 1 });
      expect(first.nextSeason).toBe(2);
      expect(first.replacementTeamsCreated).toBe(0);
      expect(first.activeTeamsByTier).toEqual({ 1: 12, 2: 12, 3: 12, 4: 12, 5: 12, 6: 12 });

      const second = await transitionWorldAfterSeason(database, { careerId: career.careerId, completedSeason: 1 });
      expect(second).toEqual(first);
      expect(await database.query("SELECT COUNT(*) AS count FROM world_transition_steps WHERE career_id = ? AND season = 2 AND step IN ('financial-movement', 'tier6-replacement');", [career.careerId])).toEqual([{ count: 2 }]);
    } finally {
      await database.close();
    }
  });

  it("refuses transition before all team settlements are present", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "world-season-transition-incomplete",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      await database.run("UPDATE races SET status = 'completed' WHERE season = 1;");
      await expect(transitionWorldAfterSeason(database, { careerId: career.careerId, completedSeason: 1 }))
        .rejects.toThrow("all 72 team season settlements");
      expect(await database.query("SELECT COUNT(*) AS count FROM world_transition_steps;")).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});
