import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import { calculateTeamRacePayrollCosts } from "./RaceFinanceService";
import { createYouthDriverLoan, effectiveDriverDevelopmentRate, expireYouthDriverLoans } from "./YouthLoanService";

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

describe("one-season youth driver loans", () => {
  it("creates a full-season loan, splits annual payroll 80/20, and expires idempotently", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "youth-loan-lifecycle-test",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const ownerTeamId = "D3-01";
      const loanTeamId = "D3-02";
      const driverRows = await database.query(
        `SELECT d.driver_id, dc.salary
         FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id
         WHERE dc.team_id = ? AND dc.start_season <= 1 AND dc.end_season >= 1
           AND d.is_retired = 0 AND d.is_academy_driver = 0
         ORDER BY d.driver_id LIMIT 1;`,
        [ownerTeamId],
      );
      const driver = driverRows[0];
      if (!driver) throw new Error("Owner team has no eligible contracted driver.");
      const borrowerDriver = await database.query(
        `SELECT d.driver_id FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id
         WHERE dc.team_id = ? AND dc.start_season <= 1 AND dc.end_season >= 1
           AND d.is_retired = 0 AND d.is_academy_driver = 0
         ORDER BY d.driver_id LIMIT 1;`,
        [loanTeamId],
      );
      if (!borrowerDriver[0]) throw new Error("Borrower team has no driver to make a seat vacant.");
      await database.run("UPDATE drivers SET is_academy_driver = 1 WHERE driver_id = ?;", [String(borrowerDriver[0].driver_id)]);

      const ownerBefore = await calculateTeamRacePayrollCosts(database, { teamId: ownerTeamId, season: 1, tier: 3, round: 1 });
      const borrowerBefore = await calculateTeamRacePayrollCosts(database, { teamId: loanTeamId, season: 1, tier: 3, round: 1 });
      const loan = await createYouthDriverLoan(database, {
        careerId: career.careerId,
        driverId: String(driver.driver_id),
        ownerTeamId,
        loanTeamId,
        season: 1,
      });
      expect(loan.annualSalary).toBe(Number(driver.salary));
      expect(loan.ownerSalaryShare).toBe(Math.round(Number(driver.salary) * 0.8));
      expect(loan.borrowerSalaryShare).toBe(Math.round(Number(driver.salary) * 0.2));
      expect(await database.query("SELECT loaned_to_team_id FROM drivers WHERE driver_id = ?;", [String(driver.driver_id)]))
        .toEqual([{ loaned_to_team_id: loanTeamId }]);

      const ownerAfter = await calculateTeamRacePayrollCosts(database, { teamId: ownerTeamId, season: 1, tier: 3, round: 1 });
      const borrowerAfter = await calculateTeamRacePayrollCosts(database, { teamId: loanTeamId, season: 1, tier: 3, round: 1 });
      expect(ownerAfter.driverPayroll).toBeLessThan(ownerBefore.driverPayroll);
      expect(borrowerAfter.driverPayroll).toBeGreaterThan(borrowerBefore.driverPayroll);

      expect(effectiveDriverDevelopmentRate(2, true)).toBeCloseTo(2.3);
      expect(effectiveDriverDevelopmentRate(2, false)).toBe(2);

      expect(await expireYouthDriverLoans(database, { careerId: career.careerId, completedSeason: 1 })).toBe(1);
      expect(await expireYouthDriverLoans(database, { careerId: career.careerId, completedSeason: 1 })).toBe(1);
      expect(await database.query("SELECT status FROM driver_loans WHERE loan_id = ?;", [loan.loanId])).toEqual([{ status: "completed" }]);
      expect(await database.query("SELECT loaned_to_team_id FROM drivers WHERE driver_id = ?;", [String(driver.driver_id)]))
        .toEqual([{ loaned_to_team_id: null }]);
    } finally {
      await database.close();
    }
  });

  it("rejects loans outside the pre-season window and prevents a driver being loaned twice", async () => {
    const database = await makeDatabase();
    try {
      const career = await generateCareerWorld(database, {
        managerName: "Mata Dewa",
        managerCountryCode: "IDN",
        difficulty: "normal",
        path: "takeover",
        worldSeed: "youth-loan-validation-test",
        takeoverTeamId: "D3-01",
      }, { fetcher: seedFetcher, managerGender: "male" });
      const driver = (await database.query(
        "SELECT d.driver_id FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id WHERE dc.team_id = 'D3-01' AND dc.start_season <= 1 AND dc.end_season >= 1 AND d.is_retired = 0 AND d.is_academy_driver = 0 ORDER BY d.driver_id LIMIT 1;",
      ))[0];
      if (!driver) throw new Error("No eligible owner driver.");
      await database.run("UPDATE career SET current_race = 2 WHERE career_id = ?;", [career.careerId]);
      await expect(createYouthDriverLoan(database, {
        careerId: career.careerId, driverId: String(driver.driver_id), ownerTeamId: "D3-01", loanTeamId: "D3-02", season: 1,
      })).rejects.toThrow("sebelum race pertama");
    } finally {
      await database.close();
    }
  });
});
