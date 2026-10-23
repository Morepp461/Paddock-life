import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { settleCareerSeason } from "./SeasonSettlementEngine";
import { rollWorldSeasonForward } from "./WorldSeasonRolloverService";
import { INITIAL_DISTRIBUTIONS } from "./InitialDistributions";
import { TIER_CONFIG } from "./GameConfig";
import { evaluateAgeAndRetirement } from "./AgeAndRetireEngine";

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

describe("world season rollover", () => {
  it("creates the next calendar, carries cars forward, and fills every AI race grid", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "world-season-rollover-test",
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

      const retirementCandidates = await database.query(
        `SELECT d.driver_id FROM drivers d
         WHERE d.career_id = ? AND d.is_retired = 0
           AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= 1 AND dc.end_season >= 1)
         ORDER BY d.driver_id LIMIT 3;`,
        [career.careerId],
      );
      expect(retirementCandidates).toHaveLength(3);
      for (const row of retirementCandidates) {
        await database.run("UPDATE drivers SET age = 45 WHERE driver_id = ?;", [String(row.driver_id)]);
      }
      const expectedRetirements = retirementCandidates.map((row) => evaluateAgeAndRetirement({
        worldSeed: "world-season-rollover-test", season: 2, entityId: String(row.driver_id),
        kind: "driver", age: 45, tier: 1,
      }));
      const staffCandidates = await database.query(
        "SELECT staff_id FROM staff WHERE career_id = ? AND is_retired = 0 ORDER BY staff_id LIMIT 1;",
        [career.careerId],
      );
      expect(staffCandidates).toHaveLength(1);
      const staffId = String(staffCandidates[0]!.staff_id);
      await database.run("UPDATE staff SET age = 80 WHERE staff_id = ?;", [staffId]);

      const result = await rollWorldSeasonForward(database, { careerId: career.careerId, completedSeason: 1 });
      expect(result.currentSeason).toBe(2);
      expect(result.calendarsCreated).toBe([1, 2, 3, 4, 5, 6].reduce((sum, tier) => sum + TIER_CONFIG[tier as 1 | 2 | 3 | 4 | 5 | 6].roundsPerSeason, 0));
      expect(result.carsCreated).toBe(72);
      expect(result.aiTeamsReady).toBe(71);
      expect(await database.query("SELECT current_season, current_race FROM career WHERE career_id = ?;", [career.careerId]))
        .toEqual([{ current_season: 2, current_race: 1 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM races WHERE season = 2 AND status = 'scheduled';"))
        .toEqual([{ count: result.calendarsCreated }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM cars WHERE season = 2;"))
        .toEqual([{ count: 72 }]);
      const retirementEvents = await database.query(
        "SELECT driver_id, previous_age, age_after, retirement_probability, became_staff_candidate FROM driver_retirement_events WHERE career_id = ? AND season = 2 AND driver_id IN (?, ?, ?) ORDER BY driver_id;",
        [career.careerId, ...retirementCandidates.map((row) => String(row.driver_id))],
      );
      expect(retirementEvents).toHaveLength(3);
      expect(retirementEvents.every((row) => Number(row.previous_age) === 45 && Number(row.age_after) === 46 && Number(row.retirement_probability) === 1)).toBe(true);
      expect(retirementEvents.map((row) => Number(row.became_staff_candidate))).toEqual(
        expectedRetirements.slice().sort((a, b) => a.entityId.localeCompare(b.entityId)).map((decision) => decision.becomesStaff ? 1 : 0),
      );
      expect(result.staffRetiredByAge).toBeGreaterThanOrEqual(1);
      expect(await database.query("SELECT age, is_retired, team_id, is_free_agent FROM staff WHERE staff_id = ?;", [staffId]))
        .toEqual([{ age: 81, is_retired: 1, team_id: null, is_free_agent: 0 }]);
      expect(await database.query(
        "SELECT previous_age, age_after, retirement_probability FROM staff_retirement_events WHERE career_id = ? AND staff_id = ? AND season = 2;",
        [career.careerId, staffId],
      )).toEqual([{ previous_age: 80, age_after: 81, retirement_probability: 1 }]);

      for (const tier of [1, 2, 3, 4, 5, 6] as const) {
        const band = TIER_CONFIG[tier].driverAge;
        const rosterCounts = await database.query(
          `SELECT t.team_id, COUNT(DISTINCT d.driver_id) AS count
           FROM teams t
           LEFT JOIN driver_contracts dc ON dc.team_id = t.team_id AND dc.start_season <= 2 AND dc.end_season >= 2
           LEFT JOIN drivers d ON d.driver_id = dc.driver_id AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.age BETWEEN ? AND ?
           WHERE t.career_id = ? AND t.division_id = ? AND t.is_active = 1 AND t.is_player_team = 0
           GROUP BY t.team_id;`,
          [band.min, band.max, career.careerId, "T" + tier],
        );
        expect(rosterCounts.every((row) => Number(row.count) === 2)).toBe(true);
      }

      const resumed = await rollWorldSeasonForward(database, { careerId: career.careerId, completedSeason: 1 });
      expect(resumed).toEqual(result);
      expect(await database.query("SELECT COUNT(*) AS count FROM races WHERE season = 2;"))
        .toEqual([{ count: result.calendarsCreated }]);
    } finally {
      await database.close();
    }
  });

  it("retires a free agent after two completed seasons without a team", async () => {
    const database = await makeDatabase();
    try {
      const worldSeed = "two-season-no-team-retirement-test";
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed,
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });

      await database.run("UPDATE races SET status = 'completed' WHERE season = 1;");
      const initialTeams = await database.query("SELECT team_id, division_id FROM teams WHERE career_id = ? AND is_active = 1;", [career.careerId]);
      for (const team of initialTeams) {
        const tier = Number(String(team.division_id).replace("T", "")) as 1 | 2 | 3 | 4 | 5 | 6;
        await database.run("UPDATE teams SET cash = ?, debt = 0, distress_seasons = 0, severe_distress_seasons = 0, movement_cooldown = 0 WHERE team_id = ?;",
          [INITIAL_DISTRIBUTIONS[tier].requiredBudget * 100, String(team.team_id)]);
      }
      for (const tier of [1, 2, 3, 4, 5, 6] as const) {
        await settleCareerSeason(database, { careerId: career.careerId, season: 1, tier });
      }
      await rollWorldSeasonForward(database, { careerId: career.careerId, completedSeason: 1 });

      const candidates = await database.query(
        `SELECT d.driver_id FROM drivers d
         WHERE d.career_id = ? AND d.is_retired = 0 AND d.created_season = 1
           AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= 1 AND dc.end_season >= 1)
           AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= 2 AND dc.end_season >= 2)
         ORDER BY d.driver_id LIMIT 1;`,
        [career.careerId],
      );
      expect(candidates).toHaveLength(1);
      const candidateId = String(candidates[0]!.driver_id);
      await database.run("UPDATE drivers SET age = 20 WHERE driver_id = ?;", [candidateId]);

      await database.run("UPDATE races SET status = 'completed' WHERE season = 2;");
      const seasonTwoTeams = await database.query("SELECT team_id, division_id FROM teams WHERE career_id = ? AND is_active = 1;", [career.careerId]);
      for (const team of seasonTwoTeams) {
        const tier = Number(String(team.division_id).replace("T", "")) as 1 | 2 | 3 | 4 | 5 | 6;
        await database.run("UPDATE teams SET cash = ?, debt = 0, distress_seasons = 0, severe_distress_seasons = 0, movement_cooldown = 0 WHERE team_id = ?;",
          [INITIAL_DISTRIBUTIONS[tier].requiredBudget * 100, String(team.team_id)]);
      }
      for (const tier of [1, 2, 3, 4, 5, 6] as const) {
        await settleCareerSeason(database, { careerId: career.careerId, season: 2, tier });
      }
      const result = await rollWorldSeasonForward(database, { careerId: career.careerId, completedSeason: 2 });

      expect(result.driversRetiredForNoTeam).toBeGreaterThanOrEqual(1);
      expect(await database.query("SELECT is_retired, retire_reason FROM drivers WHERE driver_id = ?;", [candidateId]))
        .toEqual([{ is_retired: 1, retire_reason: "no_team" }]);
      expect(await database.query(
        "SELECT reason, previous_age, age_after, retirement_probability FROM driver_retirement_events WHERE career_id = ? AND driver_id = ? AND season = 3;",
        [career.careerId, candidateId],
      )).toEqual([{ reason: "no_team", previous_age: 20, age_after: 21, retirement_probability: 1 }]);
    } finally {
      await database.close();
    }
  });
});
