import type { Database, SqlValue } from "sql.js";
import type { DatabaseRow, DatabaseValue, IDatabase } from "./IDatabase";

/** SQL.js adapter for deterministic Node/Vitest tests; not used as Android storage. */
export class SqlJsDatabase implements IDatabase {
  private transactionActive = false;
  private closed = false;

  constructor(private readonly db: Database) {
    this.db.run("PRAGMA foreign_keys = ON;");
  }

  async execute(sql: string): Promise<void> {
    this.assertOpen();
    this.db.exec(sql);
  }

  async run(sql: string, values: readonly DatabaseValue[] = []): Promise<void> {
    this.assertOpen();
    this.db.run(sql, [...values] as SqlValue[]);
  }

  async query(sql: string, values: readonly DatabaseValue[] = []): Promise<DatabaseRow[]> {
    this.assertOpen();
    const statement = this.db.prepare(sql);
    try {
      if (values.length > 0) statement.bind([...values] as SqlValue[]);
      const rows: DatabaseRow[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as DatabaseRow);
      return rows;
    } finally {
      statement.free();
    }
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.transactionActive) throw new Error("Nested database transactions are not supported.");
    this.transactionActive = true;
    this.db.run("BEGIN TRANSACTION;");
    try {
      const result = await work();
      this.db.run("COMMIT;");
      return result;
    } catch (error) {
      this.db.run("ROLLBACK;");
      throw error;
    } finally {
      this.transactionActive = false;
    }
  }

  async close(): Promise<void> {
    if (this.transactionActive) throw new Error("Tidak bisa menutup database saat transaksi aktif.");
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Database sudah ditutup.");
  }
}
