import initSqlJs from "sql.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { SqlJsDatabase } from "./SqlJsDatabase";
import { runMigrations } from "./Migrations";
import { getGameConfig, requireGameConfig } from "./GameConfigStore";
import type { IDatabase } from "./IDatabase";

describe("source-traceable game config store", () => {
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

  it("returns a typed value together with its source and exact scope", async () => {
    await database.run(
      "INSERT INTO game_config (config_key, scope, scope_id, value_json, source_document) VALUES (?, ?, ?, ?, ?);",
      ["neutralization.safety-car-probability", "circuit", "circuit-test", JSON.stringify(0.12), "02_Simulation_Rules_Addendum_v1.docx"],
    );
    await expect(getGameConfig<number>(database, "neutralization.safety-car-probability", {
      scope: "circuit", scopeId: "circuit-test",
    })).resolves.toEqual({
      key: "neutralization.safety-car-probability",
      scope: "circuit",
      scopeId: "circuit-test",
      value: 0.12,
      sourceDocument: "02_Simulation_Rules_Addendum_v1.docx",
    });
  });

  it("does not silently invent missing values and only falls back when explicitly requested", async () => {
    await database.run(
      "INSERT INTO game_config (config_key, scope, scope_id, value_json, source_document) VALUES (?, ?, ?, ?, ?);",
      ["simulation.test-global", "global", "global", JSON.stringify({ enabled: true }), "test fixture"],
    );
    await expect(getGameConfig(database, "simulation.missing")).resolves.toBeNull();
    await expect(requireGameConfig(database, "simulation.missing")).rejects.toThrow("Konfigurasi simulasi wajib belum tersedia");
    await expect(getGameConfig(database, "simulation.test-global", {
      scope: "tier", scopeId: "1",
    })).resolves.toBeNull();
    await expect(getGameConfig(database, "simulation.test-global", {
      scope: "tier", scopeId: "1", allowGlobalFallback: true,
    })).resolves.toMatchObject({ scope: "global", scopeId: "global", value: { enabled: true } });
  });

  it("rejects invalid lookup scopes", async () => {
    await expect(getGameConfig(database, "x", { scope: "global", scopeId: "1" })).rejects.toThrow();
    await expect(getGameConfig(database, "x", { scope: "tier", scopeId: "global" })).rejects.toThrow();
    await expect(requireGameConfig(database, " ")).rejects.toThrow("key wajib diisi");
  });
});
