import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type { DatabaseRow, DatabaseValue, IDatabase } from "./IDatabase";

/** Native Android SQLite adapter. It is only opened inside the Capacitor runtime. */
export class CapacitorSQLiteDatabase implements IDatabase {
  private transactionActive = false;

  private constructor(
    private readonly connection: SQLiteConnection,
    private readonly databaseName: string,
    private readonly db: SQLiteDBConnection,
  ) {}

  static async open(databaseName: string): Promise<CapacitorSQLiteDatabase> {
    if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
      throw new Error("Nama database tidak valid.");
    }

    const connection = new SQLiteConnection(CapacitorSQLite);
    await connection.checkConnectionsConsistency();
    const existing = await connection.isConnection(databaseName, false);
    const db = existing.result
      ? await connection.retrieveConnection(databaseName, false)
      : await connection.createConnection(databaseName, false, "no-encryption", 1, false);

    await db.open();
    await db.execute("PRAGMA foreign_keys = ON;", false);
    return new CapacitorSQLiteDatabase(connection, databaseName, db);
  }

  /** Deletes a save database only after closing any active native connection. */
  static async removeDatabase(databaseName: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
      throw new Error("Nama database tidak valid.");
    }
    const connection = new SQLiteConnection(CapacitorSQLite);
    await connection.checkConnectionsConsistency();
    const existing = await connection.isConnection(databaseName, false);
    if (existing.result) {
      await connection.closeConnection(databaseName, false);
    }
    await CapacitorSQLite.deleteDatabase({ database: databaseName });
  }

  async execute(sql: string): Promise<void> {
    await this.db.execute(sql, false);
  }

  async run(sql: string, values: readonly DatabaseValue[] = []): Promise<void> {
    await this.db.run(sql, [...values], false);
  }

  async query(sql: string, values: readonly DatabaseValue[] = []): Promise<DatabaseRow[]> {
    const result = await this.db.query(sql, [...values]);
    return (result.values ?? []) as DatabaseRow[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionActive) throw new Error("Nested database transactions are not supported.");
    this.transactionActive = true;
    await this.db.beginTransaction();
    try {
      const result = await work();
      await this.db.commitTransaction();
      return result;
    } catch (error) {
      try {
        await this.db.rollbackTransaction();
      } catch {
        // Preserve the original failure; rollback errors must not mask it.
      }
      throw error;
    } finally {
      this.transactionActive = false;
    }
  }

  async close(): Promise<void> {
    if (this.transactionActive) throw new Error("Tidak bisa menutup database saat transaksi aktif.");
    await this.connection.closeConnection(this.databaseName, false);
  }
}
