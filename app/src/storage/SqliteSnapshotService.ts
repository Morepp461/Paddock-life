import type { DatabaseValue, IDatabase } from "./IDatabase";
import { runMigrations } from "./Migrations";

interface SnapshotTable {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}
interface SqliteSnapshot {
  readonly formatVersion: 1;
  readonly tables: readonly SnapshotTable[];
}

const SNAPSHOT_FORMAT_VERSION = 1;
const RESERVED_TABLES = new Set(["schema_migrations"]);

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Nama tabel atau kolom snapshot tidak valid.");
  return '"' + value + '"';
}

function encodeBinary(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) return { __paddockBinary: Array.from(value) };
  return value;
}
function decodeBinary(_key: string, value: unknown): unknown {
  if (typeof value === "object" && value !== null && "__paddockBinary" in value) {
    const data = (value as { __paddockBinary?: unknown }).__paddockBinary;
    if (!Array.isArray(data) || data.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
      throw new Error("Snapshot mengandung data biner yang tidak valid.");
    }
    return new Uint8Array(data as number[]);
  }
  return value;
}
function validateSnapshot(value: unknown): SqliteSnapshot {
  if (typeof value !== "object" || value === null) throw new Error("Format snapshot tidak valid.");
  const candidate = value as Partial<SqliteSnapshot>;
  if (candidate.formatVersion !== SNAPSHOT_FORMAT_VERSION || !Array.isArray(candidate.tables)) {
    throw new Error("Versi snapshot tidak didukung.");
  }
  const seen = new Set<string>();
  const tables = candidate.tables.map((table) => {
    if (typeof table !== "object" || table === null || typeof table.name !== "string" ||
        !Array.isArray(table.rows) || RESERVED_TABLES.has(table.name)) {
      throw new Error("Metadata tabel snapshot tidak valid.");
    }
    quoteIdentifier(table.name);
    if (seen.has(table.name)) throw new Error("Snapshot memiliki tabel duplikat: " + table.name);
    seen.add(table.name);
    for (const row of table.rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new Error("Baris snapshot tidak valid pada tabel " + table.name + ".");
      }
    }
    return { name: table.name, rows: table.rows as readonly Readonly<Record<string, unknown>>[] };
  });
  return { formatVersion: SNAPSHOT_FORMAT_VERSION, tables };
}

/** Export only application data; the target database recreates its schema through migrations. */
export async function exportSqliteSnapshot(database: IDatabase): Promise<Uint8Array> {
  const tableRows = await database.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name;",
  );
  const tables: SnapshotTable[] = [];
  for (const row of tableRows) {
    const name = String(row.name);
    const records = await database.query("SELECT * FROM " + quoteIdentifier(name) + ";");
    tables.push({ name, rows: records });
  }
  const snapshot: SqliteSnapshot = { formatVersion: SNAPSHOT_FORMAT_VERSION, tables };
  return new TextEncoder().encode(JSON.stringify(snapshot, encodeBinary));
}

/**
 * Restores a snapshot into an already-open database. Schema migrations run first;
 * all row replacement is transactional, and foreign-key integrity is checked before commit.
 */
export async function restoreSqliteSnapshot(database: IDatabase, bytes: Uint8Array): Promise<void> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("Snapshot kosong atau tidak valid.");
  let parsed: SqliteSnapshot;
  try {
    parsed = validateSnapshot(JSON.parse(new TextDecoder().decode(bytes), decodeBinary));
  } catch (error) {
    throw new Error("Snapshot tidak bisa dibaca: " + (error instanceof Error ? error.message : "format tidak valid."));
  }

  await runMigrations(database);
  const liveRows = await database.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name;",
  );
  const liveNames = new Set(liveRows.map((row) => String(row.name)));
  for (const table of parsed.tables) {
    if (!liveNames.has(table.name)) throw new Error("Snapshot memuat tabel yang tidak dikenal oleh versi aplikasi ini: " + table.name + ".");
  }
  const columnsByTable = new Map<string, Set<string>>();
  for (const name of liveNames) {
    const columns = await database.query("PRAGMA table_info(" + quoteIdentifier(name) + ");");
    columnsByTable.set(name, new Set(columns.map((column) => String(column.name))));
  }
  const snapshotByName = new Map(parsed.tables.map((table) => [table.name, table]));

  await database.execute("PRAGMA foreign_keys = OFF;");
  try {
    await database.transaction(async () => {
      for (const name of [...liveNames].reverse()) {
        await database.run("DELETE FROM " + quoteIdentifier(name) + ";");
      }
      for (const name of liveNames) {
        const snapshotTable = snapshotByName.get(name);
        if (!snapshotTable) continue;
        const allowedColumns = columnsByTable.get(name)!;
        for (const row of snapshotTable.rows) {
          const entries = Object.entries(row).filter(([column]) => allowedColumns.has(column));
          if (entries.length === 0) {
            if (Object.keys(row).length > 0) throw new Error("Snapshot tidak memiliki kolom yang kompatibel untuk tabel " + name + ".");
            continue;
          }
          for (const [column, value] of entries) {
            quoteIdentifier(column);
            if (!(value === null || typeof value === "string" || typeof value === "number" || value instanceof Uint8Array)) {
              throw new Error("Nilai snapshot tidak didukung pada " + name + "." + column + ".");
            }
          }
          const columnSql = entries.map(([column]) => quoteIdentifier(column)).join(", ");
          const placeholders = entries.map(() => "?").join(", ");
          await database.run(
            "INSERT INTO " + quoteIdentifier(name) + " (" + columnSql + ") VALUES (" + placeholders + ");",
            entries.map(([, value]) => value as DatabaseValue),
          );
        }
      }
      const violations = await database.query("PRAGMA foreign_key_check;");
      if (violations.length > 0) {
        throw new Error("Snapshot melanggar relasi foreign key; restore dibatalkan.");
      }
    });
  } finally {
    await database.execute("PRAGMA foreign_keys = ON;");
  }
}
