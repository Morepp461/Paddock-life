import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "./SqlJsDatabase";
import { runMigrations } from "./Migrations";
import { exportSqliteSnapshot, restoreSqliteSnapshot } from "./SqliteSnapshotService";

async function makeDatabase() {
  const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SqlJsDatabase(new SQL.Database());
  await runMigrations(database);
  return database;
}

describe("SQLite save snapshots", () => {
  it("restores career data atomically and preserves manager confidence", async () => {
    const source = await makeDatabase();
    const target = await makeDatabase();
    try {
      await source.run(
        "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["snapshot-career", "Original Career", 3, 3, "career", "normal", "snapshot-seed"],
      );
      await source.run(
        "INSERT INTO career_managers (manager_id, career_id, team_id, name, nationality, name_culture, gender, age, reputation, is_player, status, confidence, consecutive_primary_misses) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?);",
        ["snapshot-manager", "snapshot-career", "Test Manager", "IDN", "N01", "male", 30, 3000, 72, 1],
      );
      const snapshot = await exportSqliteSnapshot(source);
      await target.run(
        "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["stale-career", "Stale Career", 5, 3, "career", "hard", "stale-seed"],
      );

      await restoreSqliteSnapshot(target, snapshot);

      expect(await target.query("SELECT career_id, career_name, world_seed FROM career;")).toEqual([
        { career_id: "snapshot-career", career_name: "Original Career", world_seed: "snapshot-seed" },
      ]);
      expect(await target.query("SELECT confidence, consecutive_primary_misses FROM career_managers WHERE manager_id = ?;", ["snapshot-manager"])).toEqual([
        { confidence: 72, consecutive_primary_misses: 1 },
      ]);
      expect(await target.query("PRAGMA foreign_key_check;")).toEqual([]);
    } finally {
      await source.close();
      await target.close();
    }
  });

  it("rolls back the restore when snapshot rows violate foreign keys", async () => {
    const source = await makeDatabase();
    const target = await makeDatabase();
    try {
      await source.run(
        "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["valid-career", "Valid Career", 3, 3, "career", "normal", "valid-seed"],
      );
      const snapshot = JSON.parse(new TextDecoder().decode(await exportSqliteSnapshot(source))) as {
        formatVersion: number;
        tables: { name: string; rows: Record<string, unknown>[] }[];
      };
      const managerTable = snapshot.tables.find((table) => table.name === "career_managers");
      if (!managerTable) throw new Error("Manager table missing from snapshot.");
      managerTable.rows.push({
        manager_id: "orphan-manager", career_id: "missing-career", team_id: null,
        name: "Orphan Manager", nationality: "IDN", name_culture: "N01",
        gender: "male", age: 30, reputation: 0, is_player: 1, status: "active",
        confidence: 60, consecutive_primary_misses: 0,
      });
      await target.run(
        "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["preserve-on-rollback", "Keep This Career", 5, 3, "career", "hard", "preserve-seed"],
      );

      await expect(restoreSqliteSnapshot(target, new TextEncoder().encode(JSON.stringify(snapshot)))).rejects.toThrow("foreign key");
      expect(await target.query("SELECT career_id, career_name FROM career;")).toEqual([
        { career_id: "preserve-on-rollback", career_name: "Keep This Career" },
      ]);
    } finally {
      await source.close();
      await target.close();
    }
  });

  it("rejects a corrupt snapshot without changing existing career data", async () => {
    const database = await makeDatabase();
    try {
      await database.run(
        "INSERT INTO career (career_id, career_name, current_division_tier, highest_unlocked_tier, game_mode, difficulty, world_seed) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["preserve-career", "Preserve Me", 3, 3, "career", "normal", "preserve-seed"],
      );
      await expect(restoreSqliteSnapshot(database, new TextEncoder().encode("{broken"))).rejects.toThrow("Snapshot tidak bisa dibaca");
      expect(await database.query("SELECT career_id, career_name FROM career;")).toEqual([
        { career_id: "preserve-career", career_name: "Preserve Me" },
      ]);
    } finally {
      await database.close();
    }
  });
});
