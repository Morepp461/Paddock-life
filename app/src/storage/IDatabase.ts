export type DatabaseValue = string | number | null | Uint8Array;
export type DatabaseRow = Readonly<Record<string, unknown>>;

/** Shared contract for native SQLite and the SQL.js test adapter. */
export interface IDatabase {
  execute(sql: string): Promise<void>;
  run(sql: string, values?: readonly DatabaseValue[]): Promise<void>;
  query(sql: string, values?: readonly DatabaseValue[]): Promise<DatabaseRow[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
