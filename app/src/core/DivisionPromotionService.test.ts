import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SqlJsDatabase } from "../storage/SqlJsDatabase";
import { runMigrations } from "../storage/Migrations";
import { generateCareerWorld } from "../seed/CareerWorldGenerator";
import {
  getPendingDivisionPromotionOffer,
  prepareDivisionPromotionOffer,
  resolveDivisionPromotionChoice,
} from "./DivisionPromotionService";

async function makeDatabase() {
  const wasmPath = new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SqlJsDatabase(new SQL.Database());
  await runMigrations(database);
  return database;
}
function seedFetcher(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const filename = url.replace(/^\/seed\//, "");
  try {
    return Promise.resolve(new Response(readFileSync(new URL("../../public/seed/" + filename, import.meta.url), "utf8"), { status: 200 }));
  } catch {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
}
async function createCareer(takeoverTeamId: string, seed: string) {
  const database = await makeDatabase();
  const career = await generateCareerWorld(database, {
    managerName: "Mata Dewa", managerCountryCode: "IDN", difficulty: "normal",
    path: "takeover", worldSeed: seed, takeoverTeamId,
  }, { fetcher: seedFetcher, managerGender: "male" });
  const team = (await database.query(
    "SELECT team_id, division_id FROM teams WHERE career_id = ? AND is_player_team = 1 AND is_active = 1;",
    [career.careerId],
  ))[0]!;
  return { database, career, teamId: String(team.team_id), tier: Number(String(team.division_id).replace("T", "")) };
}

describe("player division promotion choices", () => {
  it("unlocks the next tier for a champion and lets the player stay", async () => {
    const { database, career, teamId } = await createCareer("D3-01", "promotion-unlock-test");
    try {
      const teams = await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T3' AND is_active = 1 ORDER BY team_id;",
        [career.careerId],
      );
      for (let index = 0; index < teams.length; index += 1) {
        const id = String(teams[index]!.team_id);
        await database.run(
          "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, 1, 'T3', NULL, ?, ?, 0, 0, 0, 0, 0);",
          ["promotion-champion-" + index, id, id === teamId ? 100 : 20 - index],
        );
      }
      const offer = await prepareDivisionPromotionOffer(database, { careerId: career.careerId, completedSeason: 1 });
      expect(offer?.targetTier).toBe(2);
      expect(offer?.unlockAwarded).toBe(true);
      expect(await database.query("SELECT highest_unlocked_tier FROM career WHERE career_id = ?;", [career.careerId])).toEqual([{ highest_unlocked_tier: 2 }]);
      expect(await getPendingDivisionPromotionOffer(database, { careerId: career.careerId, teamId, season: 1 })).toEqual(offer);
      const choice = await resolveDivisionPromotionChoice(database, {
        careerId: career.careerId, offerId: offer!.offerId, choice: "stay",
      });
      expect(choice).toEqual({ teamId, tier: 3, promoted: false, exchangedTeamId: null });
      expect(await getPendingDivisionPromotionOffer(database, { careerId: career.careerId, teamId, season: 1 })).toBeNull();
      expect(await database.query("SELECT division_id FROM teams WHERE team_id = ?;", [teamId])).toEqual([{ division_id: "T3" }]);
    } finally {
      await database.close();
    }
  });

  it("swaps the player team with the bottom-ranked team in an already unlocked tier", async () => {
    const { database, career, teamId } = await createCareer("D5-01", "promotion-swap-test");
    try {
      // Model a save where Tier 4 is already unlocked for a team currently in Tier 5.
      await database.run("UPDATE career SET highest_unlocked_tier = 3 WHERE career_id = ?;", [career.careerId]);
      const targetTeams = await database.query(
        "SELECT team_id FROM teams WHERE career_id = ? AND division_id = 'T4' AND is_active = 1 ORDER BY team_id;",
        [career.careerId],
      );
      for (let index = 0; index < targetTeams.length; index += 1) {
        await database.run(
          "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, 1, 'T4', NULL, ?, ?, 0, 0, 0, 0, 0);",
          ["promotion-target-" + index, String(targetTeams[index]!.team_id), 100 - index],
        );
      }
      const offer = await prepareDivisionPromotionOffer(database, { careerId: career.careerId, completedSeason: 1 });
      expect(offer?.targetTier).toBe(4);
      expect(offer?.unlockAwarded).toBe(false);
      const resolved = await resolveDivisionPromotionChoice(database, {
        careerId: career.careerId, offerId: offer!.offerId, choice: "promote",
      });
      expect(resolved.promoted).toBe(true);
      expect(resolved.tier).toBe(4);
      const player = await database.query("SELECT division_id FROM teams WHERE team_id = ?;", [teamId]);
      expect(player).toEqual([{ division_id: "T4" }]);
      const counts = await database.query(
        "SELECT division_id, COUNT(*) AS count FROM teams WHERE career_id = ? AND is_active = 1 AND division_id IN ('T4','T5') GROUP BY division_id ORDER BY division_id;",
        [career.careerId],
      );
      expect(counts).toEqual([{ division_id: "T4", count: 12 }, { division_id: "T5", count: 12 }]);
      expect(await database.query(
        "SELECT COUNT(*) AS count FROM team_division_history WHERE career_id = ? AND season = 2 AND reason = 'player_move';",
        [career.careerId],
      )).toEqual([{ count: 2 }]);
    } finally {
      await database.close();
    }
  });
});
