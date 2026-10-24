import initSqlJs from "sql.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { resolvePitStopConfig } from "./PitStopConfigService";
import type { IDatabase } from "../storage/IDatabase";

describe("source-backed pit stop configuration", () => {
  let database: IDatabase;

  beforeAll(async () => {
    const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    database = new SqlJsDatabase(new SQL.Database());
    await runMigrations(database);
  });
  afterAll(async () => { await database.close(); });

  it("resolves only the documented Tier 1 pit values and reports missing skill curves", async () => {
    const config = await resolvePitStopConfig(database, { tier: 1, pitLaneLengthMeters: 420 });
    expect(config).toMatchObject({
      pitAllowed: true,
      pitLaneLengthMeters: 420,
      pitLaneSpeedMetersPerSecond: 22.2,
      stationarySeconds: 2.4,
      stationaryJitterRangeSeconds: 0.5,
      crewErrorProbabilityBounds: { minimum: 0.02, maximum: 0.1 },
      unsafeReleaseProbabilityBounds: { minimum: 0.01, maximum: 0.05 },
      safetyCarPitLaneTimeReduction: 0.4,
      vscPitLaneTimeReduction: 0.35,
    });
    expect(config.unresolvedKeys).toContain("pit.crew_error_probability_by_mechanic_skill");
    expect(config.unresolvedKeys).toContain("pit.unsafe_release_delay_seconds");
  });

  it("fails closed when Tier 2 stationary time is not in the source config", async () => {
    await expect(resolvePitStopConfig(database, { tier: 2, pitLaneLengthMeters: 400 }))
      .rejects.toThrow("pit.stationary_mean_seconds");
  });

  it("uses the documented fixed Tier 5 loss and disables Tier 6 pit stops", async () => {
    await expect(resolvePitStopConfig(database, { tier: 5, pitLaneLengthMeters: 360 }))
      .resolves.toMatchObject({ pitAllowed: true, fixedTotalLossSeconds: 20 });
    await expect(resolvePitStopConfig(database, { tier: 6, pitLaneLengthMeters: 360 }))
      .resolves.toMatchObject({ pitAllowed: false, fixedTotalLossSeconds: null });
  });

  it("rejects missing or invalid circuit pit lane length", async () => {
    await expect(resolvePitStopConfig(database, { tier: 1, pitLaneLengthMeters: 0 })).rejects.toThrow(RangeError);
  });
});
