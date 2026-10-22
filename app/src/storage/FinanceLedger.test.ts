import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./Migrations";
import { SqlJsDatabase } from "./SqlJsDatabase";
import type { IDatabase } from "./IDatabase";
import { seedDivisions } from "../seed/WorldSeeder";
import { applyFinanceTransaction } from "./FinanceLedger";

describe("finance ledger", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
    await runMigrations(database);
    await seedDivisions(database);
    await database.run(
      "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ["career-ledger", "Ledger Test", 5, 5, "career", "normal", "seed"],
    );
    await database.run(
      `INSERT INTO teams
        (team_id, career_id, division_id, name, base_country, origin, founded_season, strength_grade, finance_grade, performance_grade, personality, cash, budget)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      ["team-ledger", "career-ledger", "T5", "Ledger Racing", "Indonesia", "generated", 1, "C", "C", "C", "Conservative", 100, 6_000_000],
    );
    await database.run(
      `INSERT INTO teams
        (team_id, career_id, division_id, name, base_country, origin, founded_season, strength_grade, finance_grade, performance_grade, personality, cash, budget)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      ["team-kart", "career-ledger", "T6", "Kart Team", "Indonesia", "generated", 1, "D", "D", "D", "Conservative", 100, 3_000_000],
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it("updates team cash and writes the ledger row atomically", async () => {
    const result = await applyFinanceTransaction(database, {
      transactionId: "tx-1", teamId: "team-ledger", season: 1, race: 1,
      type: "income", category: "sponsor", amount: 500,
    });
    expect(result).toMatchObject({ balanceAfter: 600, withinOverdraft: true, canRecruitOrDevelop: true, duplicate: false });
    expect(await database.query("SELECT cash FROM teams WHERE team_id = ?;", ["team-ledger"])).toEqual([{ cash: 600 }]);
    expect(await database.query("SELECT amount, balance_after FROM finances WHERE transaction_id = ?;", ["tx-1"])).toEqual([
      { amount: 500, balance_after: 600 },
    ]);
  });

  it("is idempotent for the same transaction and rejects reused IDs with different payload", async () => {
    const input = { transactionId: "tx-2", teamId: "team-ledger", season: 1, type: "expense", category: "repair", amount: -100 } as const;
    const first = await applyFinanceTransaction(database, input);
    const duplicate = await applyFinanceTransaction(database, input);
    expect(first.balanceAfter).toBe(500);
    expect(duplicate.duplicate).toBe(true);
    expect(await database.query("SELECT COUNT(*) AS count FROM finances WHERE transaction_id = ?;", ["tx-2"])).toEqual([{ count: 1 }]);
    await expect(applyFinanceTransaction(database, { ...input, amount: -200 })).rejects.toThrow("payload berbeda");
  });

  it("allows overdraft within limit but prevents recruitment and rejects overspending past the limit", async () => {
    const result = await applyFinanceTransaction(database, {
      transactionId: "tx-3", teamId: "team-ledger", season: 1, type: "expense", category: "unexpected-cost", amount: -1_000_000,
    });
    expect(result.balanceAfter).toBe(-999_500);
    expect(result.withinOverdraft).toBe(true);
    expect(result.canRecruitOrDevelop).toBe(false);
    await expect(applyFinanceTransaction(database, {
      transactionId: "tx-4", teamId: "team-ledger", season: 1, type: "expense", category: "too-large", amount: -1_000_000,
    })).rejects.toThrow("batas overdraft");
    expect(await database.query("SELECT COUNT(*) AS count FROM finances WHERE transaction_id = ?;", ["tx-4"])).toEqual([{ count: 0 }]);
  });

  it("applies Tier 6 transactions using the RB-scaled overdraft limit", async () => {
    const result = await applyFinanceTransaction(database, {
      transactionId: "tx-kart", teamId: "team-kart", season: 1, type: "expense", category: "repair", amount: -200,
    });
    expect(result.balanceAfter).toBe(-100);
    expect(result.withinOverdraft).toBe(true);
    expect(result.canRecruitOrDevelop).toBe(false);
  });

  it("rejects invalid transaction metadata and unknown teams", async () => {
    await expect(applyFinanceTransaction(database, {
      transactionId: "bad", teamId: "team-ledger", season: 0, type: "expense", category: "repair", amount: 1,
    })).rejects.toThrow(RangeError);
    await expect(applyFinanceTransaction(database, {
      transactionId: "fractional", teamId: "team-ledger", season: 1, type: "expense", category: "repair", amount: 0.5,
    })).rejects.toThrow(RangeError);
    await expect(applyFinanceTransaction(database, {
      transactionId: "bad-team", teamId: "missing", season: 1, type: "expense", category: "repair", amount: 1,
    })).rejects.toThrow("tidak ditemukan");
  });
});
