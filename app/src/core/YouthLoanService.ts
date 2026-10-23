import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed } from "./RandomDistributions";

export interface YouthLoanResult {
  readonly loanId: string;
  readonly careerId: string;
  readonly driverId: string;
  readonly ownerTeamId: string;
  readonly loanTeamId: string;
  readonly season: number;
  readonly annualSalary: number;
  readonly ownerSalaryShare: number;
  readonly borrowerSalaryShare: number;
}
function n(row: DatabaseRow | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function academyLoanSlots(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > 10) throw new RangeError("Academy level harus 1–10.");
  if (level <= 2) return 1;
  if (level <= 5) return 2;
  if (level <= 8) return 3;
  return 4;
}
function makeLoanId(worldSeed: string, input: { careerId: string; driverId: string; loanTeamId: string; season: number }): string {
  return "loan_" + hashSeed([worldSeed, input.careerId, input.driverId, input.loanTeamId, input.season]).toString(16).padStart(8, "0");
}

/** Creates a full-season youth loan; the owner retains the contract and pays 80% of salary. */
export async function createYouthDriverLoan(
  database: IDatabase,
  input: { readonly careerId: string; readonly driverId: string; readonly ownerTeamId: string; readonly loanTeamId: string; readonly season: number },
): Promise<YouthLoanResult> {
  if (![input.careerId, input.driverId, input.ownerTeamId, input.loanTeamId].every((value) => value.trim())) {
    throw new Error("Career, driver, dan kedua tim wajib ditentukan.");
  }
  if (input.ownerTeamId === input.loanTeamId) throw new Error("Tim pemilik dan tim peminjam harus berbeda.");
  if (!Number.isSafeInteger(input.season) || input.season < 1) throw new RangeError("Season loan harus integer positif.");

  let result: YouthLoanResult | null = null;
  await database.transaction(async () => {
    const careerRows = await database.query("SELECT world_seed, current_season, current_race FROM career WHERE career_id = ?;", [input.careerId]);
    const career = careerRows[0];
    if (!career) throw new Error("Career tidak ditemukan.");
    if (n(career, "current_season") !== input.season || n(career, "current_race", 1) !== 1) {
      throw new Error("Youth Loan satu season penuh hanya bisa dimulai sebelum race pertama season tersebut.");
    }

    const [ownerRows, borrowerRows, driverRows, contractRows, activeLoans] = await Promise.all([
      database.query("SELECT team_id, division_id, academy_level, is_active FROM teams WHERE team_id = ? AND career_id = ?;", [input.ownerTeamId, input.careerId]),
      database.query("SELECT team_id, division_id, is_active FROM teams WHERE team_id = ? AND career_id = ?;", [input.loanTeamId, input.careerId]),
      database.query("SELECT driver_id, age, is_retired, loaned_to_team_id FROM drivers WHERE driver_id = ? AND career_id = ?;", [input.driverId, input.careerId]),
      database.query(
        "SELECT contract_id, salary FROM driver_contracts WHERE driver_id = ? AND team_id = ? AND start_season <= ? AND end_season >= ?;",
        [input.driverId, input.ownerTeamId, input.season, input.season],
      ),
      database.query(
        "SELECT loan_id FROM driver_loans WHERE career_id = ? AND driver_id = ? AND status = 'active' AND start_season <= ? AND end_season >= ?;",
        [input.careerId, input.driverId, input.season, input.season],
      ),
    ]);
    const owner = ownerRows[0], borrower = borrowerRows[0], driver = driverRows[0];
    if (!owner || !borrower || !driver) throw new Error("Tim atau driver untuk loan tidak ditemukan.");
    if (n(owner, "is_active") !== 1 || n(borrower, "is_active") !== 1) throw new Error("Tim loan harus aktif.");
    if (contractRows.length !== 1) throw new Error("Driver harus memiliki tepat satu kontrak aktif dengan tim pemilik.");
    if (n(driver, "is_retired") === 1) throw new Error("Driver pensiun tidak bisa dipinjamkan.");
    if (driver.loaned_to_team_id !== null && driver.loaned_to_team_id !== undefined) throw new Error("Driver sudah dipinjamkan ke tim lain.");
    if (activeLoans.length) throw new Error("Driver sudah memiliki loan aktif.");
    const tierValue = Number(String(borrower.division_id).replace(/^T/, ""));
    if (![1, 2, 3, 4, 5, 6].includes(tierValue)) throw new Error("Tier tim peminjam tidak valid.");
    const tier = tierValue as TierId;
    const age = n(driver, "age");
    const ageBand = TIER_CONFIG[tier].driverAge;
    if (age < ageBand.min || age > ageBand.max) throw new Error("Umur driver di luar rentang tier tim peminjam.");
    const seatRows = await database.query(
      `SELECT COUNT(DISTINCT d.driver_id) AS occupied_seats
       FROM drivers d
       LEFT JOIN driver_contracts dc ON dc.driver_id = d.driver_id AND dc.start_season <= ? AND dc.end_season >= ?
       LEFT JOIN driver_loans l ON l.driver_id = d.driver_id AND l.career_id = d.career_id AND l.loan_team_id = ? AND l.status = 'active' AND l.start_season <= ? AND l.end_season >= ?
       WHERE d.career_id = ? AND d.is_retired = 0
         AND ((dc.team_id = ? AND d.is_academy_driver = 0) OR l.loan_id IS NOT NULL)
         AND d.age BETWEEN ? AND ?;`,
      [input.season, input.season, input.loanTeamId, input.season, input.season, input.careerId,
        input.loanTeamId, ageBand.min, ageBand.max],
    );
    const slots = academyLoanSlots(n(owner, "academy_level", 1));
    const ownerLoans = await database.query(
      "SELECT COUNT(*) AS count FROM driver_loans WHERE career_id = ? AND owner_team_id = ? AND start_season = ? AND status = 'active';",
      [input.careerId, input.ownerTeamId, input.season],
    );
    if (n(ownerLoans[0], "count") >= slots) throw new Error("Slot Youth Loan tim pemilik sudah penuh berdasarkan level Academy.");
    if (n(seatRows[0], "occupied_seats") >= 2) throw new Error("Dua kursi race tim peminjam sudah terisi.");
    const salary = n(contractRows[0], "salary");
    if (!Number.isSafeInteger(salary) || salary < 0) throw new Error("Gaji kontrak driver tidak valid.");
    const loanId = makeLoanId(String(career.world_seed), input);
    await database.run(
      "INSERT INTO driver_loans (loan_id, career_id, driver_id, owner_team_id, loan_team_id, start_season, end_season, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active');",
      [loanId, input.careerId, input.driverId, input.ownerTeamId, input.loanTeamId, input.season, input.season],
    );
    await database.run("UPDATE drivers SET loaned_to_team_id = ? WHERE driver_id = ? AND career_id = ?;", [input.loanTeamId, input.driverId, input.careerId]);
    result = {
      loanId, careerId: input.careerId, driverId: input.driverId,
      ownerTeamId: input.ownerTeamId, loanTeamId: input.loanTeamId, season: input.season,
      annualSalary: salary, ownerSalaryShare: Math.round(salary * 0.8), borrowerSalaryShare: Math.round(salary * 0.2),
    };
  });
  if (!result) throw new Error("Youth Loan tidak berhasil dibuat.");
  return result;
}

/** Loan development is multiplied by 1.15 for the full loan season. */
export function effectiveDriverDevelopmentRate(baseRate: number, isLoanedForSeason: boolean): number {
  if (!Number.isFinite(baseRate) || baseRate < 0) throw new RangeError("Development rate harus finite dan non-negatif.");
  return baseRate * (isLoanedForSeason ? 1.15 : 1);
}

/** Ends loans after their full season and returns loaned_to_team_id to null, idempotently. */
export async function expireYouthDriverLoans(
  database: IDatabase,
  input: { readonly careerId: string; readonly completedSeason: number },
): Promise<number> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.completedSeason) || input.completedSeason < 1) {
    throw new RangeError("Career ID dan completed season harus valid.");
  }
  const nextSeason = input.completedSeason + 1;
  const marker = await database.query(
    "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'driver-loan-expiry';",
    [input.careerId, nextSeason],
  );
  if (marker[0]) return Number((JSON.parse(String(marker[0].result_json)) as { completed?: number }).completed ?? 0);
  let completed = 0;
  await database.transaction(async () => {
    const recheck = await database.query(
      "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'driver-loan-expiry';",
      [input.careerId, nextSeason],
    );
    if (recheck[0]) {
      completed = Number((JSON.parse(String(recheck[0].result_json)) as { completed?: number }).completed ?? 0);
      return;
    }
    const loans = await database.query(
      "SELECT loan_id, driver_id, loan_team_id FROM driver_loans WHERE career_id = ? AND status = 'active' AND end_season <= ? ORDER BY loan_id;",
      [input.careerId, input.completedSeason],
    );
    for (const loan of loans) {
      await database.run("UPDATE driver_loans SET status = 'completed' WHERE loan_id = ? AND status = 'active';", [String(loan.loan_id)]);
      await database.run(
        "UPDATE drivers SET loaned_to_team_id = NULL WHERE driver_id = ? AND career_id = ? AND loaned_to_team_id = ?;",
        [String(loan.driver_id), input.careerId, String(loan.loan_team_id)],
      );
    }
    completed = loans.length;
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, 'driver-loan-expiry', ?);",
      [input.careerId, nextSeason, JSON.stringify({ completed })],
    );
  });
  return completed;
}
