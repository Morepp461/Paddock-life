import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { cancelCareerDevelopmentProject, startCareerDevelopmentProject, advanceCareerDevelopmentProjectsAfterRace } from "./CareerDevelopmentService";

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
async function makeCareer(database: SqlJsDatabase) {
  return generateCareerWorld(database, {
    managerName: "Mata Dewa",
    managerCountryCode: "IDN",
    difficulty: "normal",
    path: "takeover",
    worldSeed: "career-development-service-test",
    takeoverTeamId: "D3-01",
  }, { fetcher: seedFetcher, managerGender: "male" });
}
async function prepareDevelopment(database: SqlJsDatabase, careerId: string) {
  const team = (await database.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1;", [careerId]))[0]!;
  const teamId = String(team.team_id);
  await database.run("UPDATE teams SET engine_dept_level = 2, rnd_level = 2 WHERE team_id = ?;", [teamId]);
  await database.run("UPDATE staff SET skill = 50 WHERE team_id = ? AND role = 'Chief Engineer';", [teamId]);
  return teamId;
}

describe("career development lifecycle", () => {
  it("charges project cost and refunds half when cancelled before progress", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database);
      const teamId = await prepareDevelopment(database, career.careerId);
      const before = Number((await database.query("SELECT cash FROM teams WHERE team_id = ?;", [teamId]))[0]!.cash);
      const project = await startCareerDevelopmentProject(database, {
        careerId: career.careerId, teamId, tier: 3, season: 1, round: 1,
        projectCatalogId: "E01", size: "minor", worldSeed: "career-development-service-test",
      });
      expect(project.successProbability).toBe(0.7);
      expect(project.cost).toBe(570_000);
      expect(Number((await database.query("SELECT cash FROM teams WHERE team_id = ?;", [teamId]))[0]!.cash)).toBe(before - project.cost);
      const refund = await cancelCareerDevelopmentProject(database, {
        careerId: career.careerId, teamId, projectInstanceId: project.projectInstanceId,
        season: 1, round: 1, tier: 3,
      });
      expect(refund).toBe(Math.round(project.cost * 0.5));
      expect(await database.query("SELECT status, refund FROM development_history WHERE project_instance_id = ?;", [project.projectInstanceId])).toEqual([{ status: "cancelled", refund }]);
      await expect(cancelCareerDevelopmentProject(database, {
        careerId: career.careerId, teamId, projectInstanceId: project.projectInstanceId,
        season: 1, round: 1, tier: 3,
      })).rejects.toThrow("Project aktif tidak ditemukan");
    } finally {
      await database.close();
    }
  });

  it("advances projects per completed race and records deterministic completion", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database);
      const teamId = await prepareDevelopment(database, career.careerId);
      const project = await startCareerDevelopmentProject(database, {
        careerId: career.careerId, teamId, tier: 3, season: 1, round: 1,
        projectCatalogId: "E01", size: "minor", worldSeed: "career-development-service-test",
      });
      const first = await database.transaction(() => advanceCareerDevelopmentProjectsAfterRace(database, {
        careerId: career.careerId, tier: 3, season: 1, round: 1,
      }));
      expect(first).toHaveLength(0);
      expect(await database.query("SELECT progress_races, status FROM development_projects WHERE project_instance_id = ?;", [project.projectInstanceId])).toEqual([{ progress_races: 1, status: "active" }]);
      const second = await database.transaction(() => advanceCareerDevelopmentProjectsAfterRace(database, {
        careerId: career.careerId, tier: 3, season: 1, round: 2,
      }));
      expect(second).toHaveLength(1);
      expect(["completed", "failed"]).toContain(second[0]!.status);
      expect(await database.query("SELECT status, success, reason FROM development_history WHERE project_instance_id = ?;", [project.projectInstanceId])).toHaveLength(1);
      expect(await database.query("SELECT status FROM development_projects WHERE project_instance_id = ?;", [project.projectInstanceId])).toEqual([{ status: second[0]!.status }]);
    } finally {
      await database.close();
    }
  });
});
