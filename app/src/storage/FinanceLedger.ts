import type { DatabaseValue, IDatabase } from "./IDatabase";
import { calculateBalanceAfterTransaction, type EconomyTierId } from "../core/EconomyEngine";

export interface FinanceTransactionInput {
  readonly transactionId: string;
  readonly teamId: string;
  readonly season: number;
  readonly race?: number | null;
  readonly type: string;
  readonly category: string;
  readonly amount: number;
}

export interface FinanceTransactionResult {
  readonly transactionId: string;
  readonly teamId: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly withinOverdraft: boolean;
  readonly canRecruitOrDevelop: boolean;
  readonly duplicate: boolean;
}

/** Applies team cash and its ledger row in the same SQLite transaction. */
export async function applyFinanceTransaction(
  database: IDatabase,
  input: FinanceTransactionInput,
): Promise<FinanceTransactionResult> {
  if (!input.transactionId.trim() || !input.teamId.trim() || !input.type.trim() || !input.category.trim()) {
    throw new Error("ID transaksi, tim, tipe, dan kategori wajib diisi.");
  }
  if (!Number.isSafeInteger(input.season) || input.season < 1 ||
      (input.race !== undefined && input.race !== null && (!Number.isSafeInteger(input.race) || input.race < 1)) ||
      !Number.isFinite(input.amount)) {
    throw new RangeError("Season, race, atau nominal transaksi tidak valid.");
  }

  return database.transaction(async () => {
    const existing = await database.query(
      "SELECT transaction_id, team_id, season, race, type, category, amount, balance_after FROM finances WHERE transaction_id = ?;",
      [input.transactionId],
    );
    if (existing.length > 0) {
      const row = existing[0];
      if (row.team_id !== input.teamId || row.season !== input.season ||
          (row.race ?? null) !== (input.race ?? null) || row.type !== input.type ||
          row.category !== input.category || Number(row.amount) !== Math.round(input.amount)) {
        throw new Error("ID transaksi sudah dipakai dengan payload berbeda.");
      }
      const team = await database.query("SELECT division_id FROM teams WHERE team_id = ?;", [input.teamId]);
      const division = team.length ? await database.query("SELECT tier FROM divisions WHERE division_id = ?;", [team[0].division_id as string]) : [];
      if (!division.length) throw new Error("Tim atau divisi transaksi tidak ditemukan.");
      const balanceAfter = Number(row.balance_after);
      const policy = calculateBalanceAfterTransaction({ currentBalance: balanceAfter, amount: 0, tier: Number(division[0].tier) as EconomyTierId });
      return {
        transactionId: input.transactionId, teamId: input.teamId, amount: Number(row.amount),
        balanceAfter, withinOverdraft: policy.withinOverdraft,
        canRecruitOrDevelop: policy.canRecruitOrDevelop, duplicate: true,
      };
    }

    const rows = await database.query(
      "SELECT t.cash, d.tier FROM teams t JOIN divisions d ON d.division_id = t.division_id WHERE t.team_id = ?;",
      [input.teamId],
    );
    if (!rows.length) throw new Error("Tim transaksi tidak ditemukan.");
    const tier = Number(rows[0].tier) as EconomyTierId;
    if (tier < 1 || tier > 5) throw new Error("Finance rules belum didefinisikan untuk Tier 6.");
    const balance = calculateBalanceAfterTransaction({
      currentBalance: Number(rows[0].cash), amount: input.amount, tier,
    });
    if (!balance.withinOverdraft) throw new Error("Transaksi ditolak karena melewati batas overdraft.");

    await database.run("UPDATE teams SET cash = ? WHERE team_id = ?;", [balance.balanceAfter, input.teamId]);
    await database.run(
      `INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        input.transactionId, input.teamId, input.season, input.race ?? null,
        input.type, input.category, Math.round(input.amount), balance.balanceAfter,
      ] as readonly DatabaseValue[],
    );
    return {
      transactionId: input.transactionId, teamId: input.teamId, amount: Math.round(input.amount),
      balanceAfter: balance.balanceAfter, withinOverdraft: balance.withinOverdraft,
      canRecruitOrDevelop: balance.canRecruitOrDevelop, duplicate: false,
    };
  });
}
