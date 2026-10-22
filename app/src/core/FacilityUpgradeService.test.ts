import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { calculateFacilityUpgradeCost } from "./EconomyEngine";
import { upgradeTeamFacility } from "./FacilityUpgradeService";

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
    managerName: "Mata Dewa", managerCountryCode: "IDN", difficulty: "normal",
    path: "takeover", worldSeed: seed, takeoverTeamId: "D3-01",
  }, { fetcher: seedFetcher, managerGender: "male" });
  const rows = await database.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1;", [career.careerId]);
  return { careerId: career.careerId, teamId: String(rows[0]!.team_id) };
}

describe("facility upgrade service", () => {
  it("upgrades one facility and records the exact cost in the finance ledger", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "facility-upgrade-test");
      const before = await database.query("SELECT cash, rnd_level FROM teams WHERE team_id = ?;", [career.teamId]);
      const result = await upgradeTeamFacility(database, { teamId: career.teamId, facility: "rnd", season: 1 });
      expect(result.previousLevel).toBe(Number(before[0]!.rnd_level));
      expect(result.newLevel).toBe(Number(before[0]!.rnd_level) + 1);
      expect(result.cost).toBe(calculateFacilityUpgradeCost(3, Number(before[0]!.rnd_level)));
      expect(Number((await database.query("SELECT rnd_level FROM teams WHERE team_id = ?;", [career.teamId]))[0]!.rnd_level)).toBe(result.newLevel);
      expect(Number((await database.query("SELECT cash FROM teams WHERE team_id = ?;", [career.teamId]))[0]!.cash)).toBe(Number(before[0]!.cash) - result.cost);
      expect(await database.query("SELECT amount, category FROM finances WHERE transaction_id = ?;", [
        "facility_" + career.teamId + "_S1_rnd_L" + result.newLevel,
      ])).toEqual([{ amount: -result.cost, category: "facility-upgrade" }]);
    } finally {
      await database.close();
    }
  });

  it("does not change cash or level while the team is already overdrawn", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "facility-insufficient-cash");
      const before = await database.query("SELECT academy_level FROM teams WHERE team_id = ?;", [career.teamId]);
      await database.run("UPDATE teams SET cash = -1 WHERE team_id = ?;", [career.teamId]);
      await expect(upgradeTeamFacility(database, { teamId: career.teamId, facility: "academy", season: 1 }))
        .rejects.toThrow("saldo negatif");
      expect(await database.query("SELECT cash, academy_level FROM teams WHERE team_id = ?;", [career.teamId]))
        .toEqual([{ cash: -1, academy_level: Number(before[0]!.academy_level) }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM finances WHERE category = 'facility-upgrade';"))
        .toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });

  it("refuses to upgrade an AI team or exceed level ten", async () => {
    const database = await makeDatabase();
    try {
      const career = await makeCareer(database, "facility-eligibility");
      const aiTeam = await database.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 0 LIMIT 1;", [career.careerId]);
      await expect(upgradeTeamFacility(database, { teamId: String(aiTeam[0]!.team_id), facility: "chassis", season: 1 }))
        .rejects.toThrow("tim pemain");
      await database.run("UPDATE teams SET chassis_level = 10 WHERE team_id = ?;", [career.teamId]);
      await expect(upgradeTeamFacility(database, { teamId: career.teamId, facility: "chassis", season: 1 }))
        .rejects.toThrow("maksimum 10");
    } finally {
      await database.close();
    }
  });
});
