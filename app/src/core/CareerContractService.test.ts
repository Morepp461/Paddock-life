import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { calculateDriverAskingSalary, generateDriverDemandFactor } from "./ContractNegotiationEngine";
import { offerDriverContract } from "./CareerContractService";
import { TIER_CONFIG } from "./GameConfig";

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
async function setup() {
  const database = await makeDatabase();
  const career = await generateCareerWorld(database, {
    managerName: "Mata Dewa",
    managerCountryCode: "IDN",
    difficulty: "normal",
    path: "takeover",
    worldSeed: "contract-service-test",
    takeoverTeamId: "D3-01",
  }, { fetcher: seedFetcher, managerGender: "male" });
  const team = (await database.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1;", [career.careerId]))[0]!;
  const tier = TIER_CONFIG[3];
  const driver = (await database.query(
    "SELECT d.driver_id, d.market_value, d.ambition FROM drivers d WHERE d.career_id = ? AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.market_value > 0 AND d.age BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= 2 AND dc.end_season >= 2) ORDER BY d.driver_id LIMIT 1;",
    [career.careerId, tier.driverAge.min + 1, tier.driverAge.max - 1],
  ))[0]!;
  return { database, career, teamId: String(team.team_id), driver };
}

describe("career contract service", () => {
  it("signs an accepted contract and records a signing bonus atomically", async () => {
    const { database, career, teamId, driver } = await setup();
    try {
      const demandFactor = generateDriverDemandFactor({ worldSeed: "contract-service-test", season: 2, driverId: String(driver.driver_id) });
      const askingSalary = calculateDriverAskingSalary({
        marketValue: Number(driver.market_value), ambition: Number(driver.ambition), demandFactor,
      });
      const result = await offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 2, offeredSalary: Math.round(askingSalary * 1.2),
        signingBonus: 1000, championshipBonus: askingSalary, releaseClause: null, role: "lead",
      });
      expect(result.decision).toBe("accepted");
      const contractId = result.contractId;
      if (!contractId) throw new Error("Accepted contract did not return a contract ID.");
      expect(await database.query("SELECT start_season, end_season, salary FROM driver_contracts WHERE contract_id = ?;", [contractId])).toEqual([
        { start_season: 2, end_season: 3, salary: Math.round(askingSalary * 1.2) },
      ]);
      expect(await database.query("SELECT category, amount FROM finances WHERE transaction_id = ?;", ["contract-bonus_" + contractId])).toEqual([
        { category: "contract-signing-bonus", amount: -1000 },
      ]);
    } finally {
      await database.close();
    }
  });

  it("records rejection reasons and blocks same-score re-negotiation for one race", async () => {
    const { database, career, teamId, driver } = await setup();
    try {
      const input = {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 1, offeredSalary: 0, role: "second" as const,
      };
      const result = await offerDriverContract(database, input);
      expect(result.decision).toBe("rejected");
      expect(result.rejectionReasons).toHaveLength(2);
      await expect(offerDriverContract(database, input)).rejects.toThrow("satu race");
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_negotiation_cooldowns WHERE career_id = ? AND driver_id = ? AND team_id = ?;", [
        career.careerId, String(driver.driver_id), teamId,
      ])).toEqual([{ count: 1 }]);
    } finally {
      await database.close();
    }
  });
  it("does not allow a third active race driver on the same team", async () => {
    const { database, career, teamId, driver } = await setup();
    try {
      const currentDrivers = await database.query(
        "SELECT driver_id FROM driver_contracts WHERE team_id = ? AND start_season <= 1 AND end_season >= 1 LIMIT 2;",
        [teamId],
      );
      expect(currentDrivers).toHaveLength(2);
      for (let index = 0; index < currentDrivers.length; index += 1) {
        await database.run(
          "INSERT INTO driver_contracts (contract_id, driver_id, team_id, start_season, end_season, salary) VALUES (?, ?, ?, 2, 3, 1);",
          ["seat_limit_" + index, String(currentDrivers[index]!.driver_id), teamId],
        );
      }
      const demandFactor = generateDriverDemandFactor({ worldSeed: "contract-service-test", season: 2, driverId: String(driver.driver_id) });
      const askingSalary = calculateDriverAskingSalary({
        marketValue: Number(driver.market_value), ambition: Number(driver.ambition), demandFactor,
      });
      await expect(offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 2, offeredSalary: Math.round(askingSalary * 1.2), role: "lead",
      })).rejects.toThrow("Dua kursi race tim sudah terisi");
    } finally {
      await database.close();
    }
  });

});
