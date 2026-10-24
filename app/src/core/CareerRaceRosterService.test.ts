import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { TIER_CONFIG } from "./GameConfig";
import { createYouthDriverLoan } from "./YouthLoanService";
import { loadCareerRaceRoster } from "./CareerRaceRosterService";

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
async function resolveTeamId(database: SqlJsDatabase, careerId: string, poolTeamId: string): Promise<string> {
  const rows = await database.query("SELECT team_id FROM teams WHERE career_id = ? AND pool_team_id = ?;", [careerId, poolTeamId]);
  if (!rows[0]) throw new Error("Generated team not found: " + poolTeamId);
  return String(rows[0].team_id);
}

describe("career race roster with youth loans", () => {
  it("replaces the borrower's vacant seat without duplicating the academy driver at the owner", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "career-race-roster-youth-loan",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const ownerTeamId = await resolveTeamId(database, career.careerId, "D3-01");
      const borrowerTeamId = await resolveTeamId(database, career.careerId, "D4-01");
      const academy = (await database.query(
        "SELECT d.driver_id FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id WHERE d.career_id = ? AND dc.team_id = ? AND dc.start_season <= 1 AND dc.end_season >= 1 AND d.is_academy_driver = 1 AND d.is_retired = 0 AND d.loaned_to_team_id IS NULL ORDER BY d.driver_id LIMIT 1;",
        [career.careerId, ownerTeamId],
      ))[0];
      if (!academy) throw new Error("No contracted academy driver found.");
      await database.run("UPDATE drivers SET age = ? WHERE driver_id = ?;", [TIER_CONFIG[4].driverAge.min, String(academy.driver_id)]);
      const borrowerSeat = (await database.query(
        "SELECT dc.contract_id FROM driver_contracts dc JOIN drivers d ON d.driver_id = dc.driver_id WHERE dc.team_id = ? AND dc.start_season <= 1 AND dc.end_season >= 1 AND d.is_academy_driver = 0 AND d.is_retired = 0 ORDER BY d.driver_id LIMIT 1;",
        [borrowerTeamId],
      ))[0];
      if (!borrowerSeat) throw new Error("No borrower race seat found to vacate.");
      await database.run("DELETE FROM driver_contracts WHERE contract_id = ?;", [String(borrowerSeat.contract_id)]);

      await createYouthDriverLoan(database, {
        careerId: career.careerId,
        driverId: String(academy.driver_id),
        ownerTeamId,
        loanTeamId: borrowerTeamId,
        season: 1,
      });
      const ownerRoster = await loadCareerRaceRoster(database, { careerId: career.careerId, season: 1, tier: 3 });
      const borrowerRoster = await loadCareerRaceRoster(database, { careerId: career.careerId, season: 1, tier: 4 });
      expect(ownerRoster).toHaveLength(TIER_CONFIG[3].gridSize);
      expect(borrowerRoster).toHaveLength(TIER_CONFIG[4].gridSize);
      expect(ownerRoster.some((row) => String(row.driver_id) === String(academy.driver_id))).toBe(false);
      expect(borrowerRoster.filter((row) => String(row.driver_id) === String(academy.driver_id))).toHaveLength(1);
      expect(borrowerRoster.find((row) => String(row.driver_id) === String(academy.driver_id))?.team_id).toBe(borrowerTeamId);
    } finally {
      await database.close();
    }
  });
});
