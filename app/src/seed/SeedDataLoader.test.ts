import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../storage/Migrations";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import type { IDatabase } from "../storage/IDatabase";
import { CIRCUIT_SOURCE_COLUMNS, loadCircuitSeed, validateCircuitSeed } from "./SeedDataLoader";

function makeTestPayload() {
  const rows = Array.from({ length: 30 }, (_, index) => [
    `C${String(index + 1).padStart(2, "0")}`,
    `Test Circuit ${String(index + 1).padStart(2, "0")}`,
    "Testland", "Mixed", 5, 60, 90, 10, 2, 3, 5, 1, 1, 10, 15, 1000, 200,
    2, 3, 70, 50, 50, 5, 300, 4, 4, 0.3, "Test weather", 0.2,
    0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125,
  ]);
  return { schemaVersion: 1, columns: [...CIRCUIT_SOURCE_COLUMNS], rows };
}

describe("circuit seed import", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
    await runMigrations(database);
  });

  afterAll(async () => {
    await database.close();
  });

  it("validates and imports exactly 30 circuits idempotently", async () => {
    const payload = makeTestPayload();
    expect(() => validateCircuitSeed(payload)).not.toThrow();
    await loadCircuitSeed(database, payload);
    await loadCircuitSeed(database, payload);
    const result = await database.query("SELECT COUNT(*) AS count FROM circuits;");
    expect(Number(result[0].count)).toBe(30);
  });

  it("rejects a corrupted circuit weight distribution before writing", async () => {
    const payload = makeTestPayload();
    const corrupted = {
      ...payload,
      rows: payload.rows.map((row, index) => index === 0 ? row.map((value, column) => column === 36 ? 0.9 : value) : row),
    };
    expect(() => validateCircuitSeed(corrupted)).toThrow("Bobot atribut sirkuit tidak berjumlah 1.00");
  });
});
