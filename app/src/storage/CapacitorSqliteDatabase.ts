import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { DatabaseRow, DatabaseValue, IDatabase } from "./IDatabase";

/** Native Android adapter. Database schema and migrations remain shared with SqlJsDatabase tests. */
export class CapacitorSqliteDatabase implements IDatabase {
  private transactionActive = false;
  private closed = false;

  constructor(
    private readonly connection: SQLiteDBConnection,
    private readonly connectionManager: SQLiteConnection,
    private readonly databaseName: string,
  ) {}

  async execute(sql: string): Promise<void> {
    this.assertOpen();
    await this.connection.execute(sql);
  }

  async run(sql: string, values: readonly DatabaseValue[] = []): Promise<void> {
    this.assertOpen();
    await this.connection.run(sql, [...values] as never[]);
  }

  async query(sql: string, values: readonly DatabaseValue[] = []): Promise<DatabaseRow[]> {
    this.assertOpen();
    const result = await this.connection.query(sql, [...values] as never[]);
    return (result.values ?? []) as DatabaseRow[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.transactionActive) throw new Error("Nested database transactions are not supported.");
    this.transactionActive = true;
    await this.connection.beginTransaction();
    try {
      const result = await work();
      await this.connection.commitTransaction();
      return result;
    } catch (error) {
      await this.connection.rollbackTransaction();
      throw error;
    } finally {
      this.transactionActive = false;
    }
  }

  async close(): Promise<void> {
    if (this.transactionActive) throw new Error("Tidak bisa menutup database saat transaksi aktif.");
    if (this.closed) return;
    await this.connection.close();
    await this.connectionManager.closeConnection(this.databaseName, false);
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Database sudah ditutup.");
  }
}

export async function openCareerDatabase(databaseName: string): Promise<CapacitorSqliteDatabase> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(databaseName)) throw new Error("Nama database tidak valid.");
  const manager = new SQLiteConnection(CapacitorSQLite);
  const connection = await manager.createConnection(databaseName, false, "no-encryption", 1, false);
  try {
    await connection.open();
    await connection.execute("PRAGMA foreign_keys = ON;");
    return new CapacitorSqliteDatabase(connection, manager, databaseName);
  } catch (error) {
    try { await manager.closeConnection(databaseName, false); } catch { /* preserve original open error */ }
    throw error;
  }
}
