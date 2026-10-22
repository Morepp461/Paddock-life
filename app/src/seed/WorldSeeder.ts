import { TIER_CONFIG, type TierId } from "../core/GameConfig";
import type { IDatabase } from "../storage/IDatabase";
import { loadCircuitSeedFromPublic } from "./SeedDataLoader";
import { loadTeamPoolSeedFromPublic } from "./TeamSeedLoader";

/** Seeds division metadata from the canonical game config into a fresh career DB. */
export async function seedDivisions(database: IDatabase): Promise<void> {
  const tiers: TierId[] = [1, 2, 3, 4, 5, 6];
  await database.transaction(async () => {
    for (const tier of tiers) {
      const config = TIER_CONFIG[tier];
      const visible = config.features.visibleInCareerDivisionPicker ? 1 : 0;
      await database.run(
        `INSERT OR IGNORE INTO divisions
          (division_id, tier, name, rounds_per_season, distance_factor, min_driver_age, max_driver_age, required_budget, is_playable, is_visible)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          `T${tier}`, tier, config.name, config.roundsPerSeason, config.raceDistanceFactor,
          config.driverAge.min, config.driverAge.max, config.requiredBudget, visible, visible,
        ],
      );
    }
  });
  const result = await database.query("SELECT COUNT(*) AS count FROM divisions;");
  if (Number(result[0]?.count ?? 0) < 6) throw new Error("Data divisi tidak lengkap setelah seed.");
}

/** Imports immutable circuit/team pools and division metadata into a career database. */
export async function seedStaticWorldDataFromPublic(
  database: IDatabase,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await loadCircuitSeedFromPublic(database, fetcher);
  await loadTeamPoolSeedFromPublic(database, fetcher);
  await seedDivisions(database);
  const [circuits, teams, divisions] = await Promise.all([
    database.query("SELECT COUNT(*) AS count FROM circuits;"),
    database.query("SELECT COUNT(*) AS count FROM team_pool;"),
    database.query("SELECT COUNT(*) AS count FROM divisions;"),
  ]);
  if (Number(circuits[0]?.count ?? 0) !== 30) throw new Error("World seed harus memiliki 30 sirkuit.");
  if (Number(teams[0]?.count ?? 0) !== 72) throw new Error("World seed harus memiliki 72 tim pool.");
  if (Number(divisions[0]?.count ?? 0) !== 6) throw new Error("World seed harus memiliki 6 divisi.");
}
