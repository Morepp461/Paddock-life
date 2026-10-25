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
  await database.run("UPDATE driver_contracts SET end_season = 1 WHERE team_id = ? AND start_season <= 2 AND end_season >= 2;", [String(team.team_id)]);
  const tier = TIER_CONFIG[3];
  const driver = (await database.query(
    "SELECT d.driver_id, d.market_value, d.ambition FROM drivers d WHERE d.career_id = ? AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.market_value > 0 AND d.age BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= 2 AND dc.end_season >= 2) ORDER BY d.driver_id LIMIT 1;",
    [career.careerId, tier.driverAge.min + 1, tier.driverAge.max - 1],
  ))[0]!;
  return { database, career, teamId: String(team.team_id), driver };
}

describe("career contract service", () => {
  it("rejects release clauses outside the documented 1.5–3x annual salary range", async () => {
    const base = {
      careerId: "career", teamId: "team", driverId: "driver",
      startSeason: 2, durationSeasons: 2, offeredSalary: 100_000, role: "lead" as const,
    };
    await expect(offerDriverContract(null as never, { ...base, releaseClause: 149_999 })).rejects.toThrow("1.5–3");
    await expect(offerDriverContract(null as never, { ...base, releaseClause: 300_001 })).rejects.toThrow("1.5–3");
  });

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

  it("does not allow a third active race driver in the same season", async () => {
    const { database, career, teamId, driver } = await setup();
    try {
      await database.run(
        "UPDATE drivers SET age = 17 WHERE driver_id IN (SELECT driver_id FROM driver_contracts WHERE team_id = ? AND end_season = 1);",
        [teamId],
      );
      const currentDrivers = await database.query(
        "SELECT dc.contract_id FROM driver_contracts dc JOIN drivers d ON d.driver_id = dc.driver_id WHERE dc.team_id = ? AND dc.end_season = 1 AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.age + 1 BETWEEN ? AND ? ORDER BY dc.contract_id LIMIT 2;",
        [teamId, TIER_CONFIG[3].driverAge.min, TIER_CONFIG[3].driverAge.max],
      );
      expect(currentDrivers).toHaveLength(2);
      for (const row of currentDrivers) {
        await database.run("UPDATE driver_contracts SET end_season = 2 WHERE contract_id = ?;", [String(row.contract_id)]);
      }
      await expect(offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 2, offeredSalary: 100000, role: "lead",
      })).rejects.toThrow("Dua kursi race");
    } finally {
      await database.close();
    }
  });

  it("allows a returning driver's renewal at negative cash but still blocks new recruitment", async () => {
    const { database, career, teamId } = await setup();
    try {
      const returning = (await database.query(
        "SELECT d.driver_id, d.market_value, d.ambition FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id WHERE dc.team_id = ? AND dc.end_season = 1 AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.market_value > 0 AND d.age + 1 BETWEEN ? AND ? ORDER BY d.driver_id LIMIT 1;",
        [teamId, TIER_CONFIG[3].driverAge.min, TIER_CONFIG[3].driverAge.max],
      ))[0];
      expect(returning).toBeDefined();
      await database.run("UPDATE teams SET cash = -1 WHERE team_id = ?;", [teamId]);
      const driverId = String(returning!.driver_id);
      const askingSalary = calculateDriverAskingSalary({
        marketValue: Number(returning!.market_value),
        ambition: Number(returning!.ambition),
        demandFactor: generateDriverDemandFactor({ worldSeed: "contract-service-test", season: 2, driverId }),
      });
      const renewed = await offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId,
        startSeason: 2, durationSeasons: 2, offeredSalary: Math.ceil(askingSalary * 1.2),
        championshipBonus: Math.ceil(askingSalary), role: "lead",
      });
      expect(renewed.decision).toBe("accepted");

      const newDriver = (await database.query(
        "SELECT d.driver_id FROM drivers d WHERE d.career_id = ? AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.market_value > 0 AND d.age + 1 BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= 2 AND dc.end_season >= 2) ORDER BY d.driver_id LIMIT 1;",
        [career.careerId, TIER_CONFIG[3].driverAge.min, TIER_CONFIG[3].driverAge.max],
      ))[0];
      if (newDriver) {
        await expect(offerDriverContract(database, {
          careerId: career.careerId, teamId, driverId: String(newDriver.driver_id),
          startSeason: 2, durationSeasons: 2, offeredSalary: 100_000, role: "second",
        })).rejects.toThrow("saldo kas negatif");
      }
    } finally {
      await database.close();
    }
  });

  it("records rejection reasons and blocks same-score re-negotiation for one race", async () => {
    const { database, career, teamId, driver } = await setup();
    try {
      await database.run("UPDATE career SET current_season = 2, current_race = 9 WHERE career_id = ?;", [career.careerId]);
      const input = {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 1, offeredSalary: 0, role: "second" as const,
      };
      const result = await offerDriverContract(database, input);
      expect(result.decision).toBe("rejected");
      expect(result.rejectionReasons).toHaveLength(2);
      await expect(offerDriverContract(database, input)).rejects.toThrow("satu race");
      await database.run("UPDATE career SET current_race = 10 WHERE career_id = ?;", [career.careerId]);
      const afterOneRace = await offerDriverContract(database, input);
      expect(afterOneRace.decision).toBe("rejected");
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_negotiation_cooldowns WHERE career_id = ? AND driver_id = ? AND team_id = ?;", [
        career.careerId, String(driver.driver_id), teamId,
      ])).toEqual([{ count: 1 }]);
    } finally {
      await database.close();
    }
  });
});


describe("career transfer window enforcement", () => {
  it("blocks a new driver contract outside the documented transfer windows", async () => {
    const { database, career, teamId, driver } = await setup();
    try {
      await database.run("UPDATE career SET current_season = 2, current_race = 2 WHERE career_id = ?;", [career.careerId]);
      await expect(offerDriverContract(database, {
        careerId: career.careerId,
        teamId,
        driverId: String(driver.driver_id),
        startSeason: 2,
        durationSeasons: 2,
        offeredSalary: 100_000,
        role: "lead",
      })).rejects.toThrow("Jendela transfer driver sedang tertutup");
    } finally {
      await database.close();
    }
  });


describe("release-clause driver transfers", () => {
  async function setupBuyout() {
    const context = await setup();
    const { database, career, teamId, driver } = context;
    await database.run("UPDATE career SET current_season = 2, current_race = 9 WHERE career_id = ?;", [career.careerId]);
    const sellerRows = await database.query(
      "SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T3' AND is_player_team = 0 AND is_active = 1 AND team_id <> ? ORDER BY team_id LIMIT 1;",
      [career.careerId, teamId],
    );
    if (!sellerRows[0]) throw new Error("Seller team not found.");
    const sellerTeamId = String(sellerRows[0].team_id);
    await database.run(
      "INSERT INTO driver_contracts (contract_id, driver_id, team_id, start_season, end_season, salary, signing_bonus, win_bonus, podium_bonus, championship_bonus, release_clause, team_option, driver_option) VALUES (?, ?, ?, 2, 3, 100000, 0, 0, 0, 0, 150000, 0, 0);",
      ["contract_release_test", String(driver.driver_id), sellerTeamId],
    );
    const balances = await database.query("SELECT team_id, cash FROM teams WHERE team_id IN (?, ?);", [teamId, sellerTeamId]);
    return { ...context, sellerTeamId, buyerCash: Number(balances.find((row) => String(row.team_id) === teamId)!.cash),
      sellerCash: Number(balances.find((row) => String(row.team_id) === sellerTeamId)!.cash) };
  }

  it("buys out an active release clause atomically and preserves contract history", async () => {
    const { database, career, teamId, driver, sellerTeamId, buyerCash, sellerCash } = await setupBuyout();
    try {
      const askingSalary = calculateDriverAskingSalary({
        marketValue: Number(driver.market_value),
        ambition: Number(driver.ambition),
        demandFactor: generateDriverDemandFactor({ worldSeed: "contract-service-test", season: 2, driverId: String(driver.driver_id) }),
      });
      const result = await offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 2, offeredSalary: Math.round(askingSalary * 1.2),
        signingBonus: 1000, championshipBonus: askingSalary, releaseClause: null,
        releaseClauseContractId: "contract_release_test", role: "lead",
      });
      expect(result.decision).toBe("accepted");
      expect(result.contractId).toBeTruthy();
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_contracts WHERE contract_id = 'contract_release_test';")).toEqual([{ count: 0 }]);
      expect(await database.query("SELECT team_id, start_season, end_season FROM driver_contracts WHERE contract_id = ?;", [result.contractId])).toEqual([
        { team_id: teamId, start_season: 2, end_season: 3 },
      ]);
      expect(await database.query("SELECT from_team_id, to_team_id, release_clause_paid FROM driver_transfer_events WHERE old_contract_id = 'contract_release_test';")).toEqual([
        { from_team_id: sellerTeamId, to_team_id: teamId, release_clause_paid: 150000 },
      ]);
      expect(await database.query("SELECT category, amount FROM finances WHERE transaction_id LIKE 'release-clause-%';")).toEqual(expect.arrayContaining([
        { category: "driver-release-clause-received", amount: 150000 },
        { category: "driver-release-clause", amount: -150000 },
      ]));
      expect(await database.query("SELECT cash FROM teams WHERE team_id = ?;", [teamId])).toEqual([{ cash: buyerCash - 151000 }]);
      expect(await database.query("SELECT cash FROM teams WHERE team_id = ?;", [sellerTeamId])).toEqual([{ cash: sellerCash + 150000 }]);
    } finally {
      await database.close();
    }
  });

  it("does not pay the release clause when the driver's contract offer is rejected", async () => {
    const { database, career, teamId, driver, sellerTeamId, sellerCash } = await setupBuyout();
    try {
      const result = await offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 1, offeredSalary: 0,
        releaseClauseContractId: "contract_release_test", role: "second",
      });
      expect(result.decision).toBe("rejected");
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_contracts WHERE contract_id = 'contract_release_test';")).toEqual([{ count: 1 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_transfer_events;")).toEqual([{ count: 0 }]);
      expect(await database.query("SELECT cash FROM teams WHERE team_id = ?;", [sellerTeamId])).toEqual([{ cash: sellerCash }]);
    } finally {
      await database.close();
    }
  });

  it("blocks a release-clause transfer outside the mid-season window without changing the contract", async () => {
    const { database, career, teamId, driver } = await setupBuyout();
    try {
      await database.run("UPDATE career SET current_race = 2 WHERE career_id = ?;", [career.careerId]);
      await expect(offerDriverContract(database, {
        careerId: career.careerId, teamId, driverId: String(driver.driver_id),
        startSeason: 2, durationSeasons: 2, offeredSalary: 100000,
        releaseClauseContractId: "contract_release_test", role: "lead",
      })).rejects.toThrow("Jendela transfer driver sedang tertutup");
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_contracts WHERE contract_id = 'contract_release_test';")).toEqual([{ count: 1 }]);
      expect(await database.query("SELECT COUNT(*) AS count FROM driver_transfer_events;")).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});

});
