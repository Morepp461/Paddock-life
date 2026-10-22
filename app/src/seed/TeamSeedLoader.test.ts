import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../storage/Migrations";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import type { IDatabase } from "../storage/IDatabase";
import { TEAM_POOL_SOURCE_COLUMNS, loadTeamPoolSeed, validateTeamPoolSeed } from "./TeamSeedLoader";

function makeTestPayload() {
  const rows: unknown[][] = [];
  const strengths = ["Kuat", "Menengah", "Lemah"];
  const grades = ["A", "B", "C", "D"];
  const personalities = ["Championship", "Aggressive", "Conservative", "Driver Development"];
  let codeIndex = 0;
  for (let tier = 1; tier <= 6; tier += 1) {
    for (let team = 1; team <= 12; team += 1) {
      const code = String.fromCharCode(65 + Math.floor(codeIndex / 676))
        + String.fromCharCode(65 + Math.floor(codeIndex / 26) % 26)
        + String.fromCharCode(65 + codeIndex % 26);
      rows.push([
        `D${tier}-${String(team).padStart(2, "0")}`,
        `Test Team ${tier}-${team}`,
        code,
        "Testland",
        strengths[(team - 1) % strengths.length],
        grades[(team - 1) % grades.length],
        grades[(team + 1) % grades.length],
        personalities[(team - 1) % personalities.length],
        "Test team character.",
      ]);
      codeIndex += 1;
    }
  }
  return { schemaVersion: 1, columns: [...TEAM_POOL_SOURCE_COLUMNS], rows };
}

describe("team pool seed import", () => {
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

  it("validates and imports 12 source teams for each of six tiers", async () => {
    const payload = makeTestPayload();
    expect(() => validateTeamPoolSeed(payload)).not.toThrow();
    await loadTeamPoolSeed(database, payload);
    await loadTeamPoolSeed(database, payload);
    const count = await database.query("SELECT COUNT(*) AS count FROM team_pool;");
    expect(Number(count[0].count)).toBe(72);
    const tiers = await database.query("SELECT tier, COUNT(*) AS count FROM team_pool GROUP BY tier ORDER BY tier;");
    expect(tiers.map((row) => [row.tier, Number(row.count)])).toEqual([
      [1, 12], [2, 12], [3, 12], [4, 12], [5, 12], [6, 12],
    ]);
  });

  it("rejects a pool with a missing team before importing", () => {
    const payload = makeTestPayload();
    const invalid = { ...payload, rows: payload.rows.slice(1) };
    expect(() => validateTeamPoolSeed(invalid)).toThrow("tepat 72 tim");
  });
});
