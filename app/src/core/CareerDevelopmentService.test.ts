import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { startCareerDevelopmentProject, cancelCareerDevelopmentProject, advanceCareerDevelopmentProjectsAfterRace } from "./CareerDevelopmentService";

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
  const career = await generateCareerWorld(database, {
    managerName: "Mata Dewa",
    managerCountryCode: "IDN",
    difficulty: "normal",
    path: "takeover",
    worldSeed: seed,
    takeoverTeamId: "D3-01",
  }, { fetcher: seedFetcher, managerGender: "male" });
  const rows = await database.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1;", [career.careerId]);
  return { careerId: career.careerId, teamId: String(rows[0]!.team_id) };
}

describe("career development project service", () => {
  it("charges the project cost and records a cancellation refund atomically", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "development-cancel-test");
      const before = await database.query("SELECT cash FROM teams WHERE team_id = ?;", [career.teamId]);
      const started = await startCareerDevelopmentProject(database, {
        ...career, tier: 3, season: 1, round: 1, projectCatalogId: "E01", size: "minor", worldSeed: "development-cancel-test",
      });
      expect(started.cost).toBeGreaterThan(0);
      expect(started.durationRaces).toBeGreaterThan(0);
      expect(await database.query("SELECT status FROM development_projects WHERE project_instance_id = ?;", [started.projectInstanceId]))
        .toEqual([{ status: "active" }]);
      const afterStart = await database.query("SELECT cash FROM teams WHERE team_id = ?;", [career.teamId]);
      expect(Number(afterStart[0]!.cash)).toBe(Number(before[0]!.cash) - started.cost);

      const refund = await cancelCareerDevelopmentProject(database, {
        ...career, projectInstanceId: started.projectInstanceId, season: 1, round: 1, tier: 3,
      });
      expect(refund).toBe(Math.round(started.cost * 0.5));
      expect(await database.query("SELECT status FROM development_projects WHERE project_instance_id = ?;", [started.projectInstanceId]))
        .toEqual([{ status: "cancelled" }]);
      expect(await database.query("SELECT status, refund FROM development_history WHERE project_instance_id = ?;", [started.projectInstanceId]))
        .toEqual([{ status: "cancelled", refund }]);
    } finally {
      await database.close();
    }
  });

  it("advances project progress after races and records one deterministic completion", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "development-progress-test");
      const started = await startCareerDevelopmentProject(database, {
        ...career, tier: 3, season: 1, round: 1, projectCatalogId: "E01", size: "minor", worldSeed: "development-progress-test",
      });
      const first = await advanceCareerDevelopmentProjectsAfterRace(database, { careerId: career.careerId, tier: 3, season: 1, round: 1 });
      expect(first).toHaveLength(0);
      const second = await advanceCareerDevelopmentProjectsAfterRace(database, { careerId: career.careerId, tier: 3, season: 1, round: 2 });
      expect(second).toHaveLength(1);
      expect(second[0]!.projectInstanceId).toBe(started.projectInstanceId);
      expect(["completed", "failed"]).toContain(second[0]!.status);
      expect(await database.query("SELECT COUNT(*) AS count FROM development_history WHERE project_instance_id = ?;", [started.projectInstanceId]))
        .toEqual([{ count: 1 }]);
    } finally {
      await database.close();
    }
  });
});
