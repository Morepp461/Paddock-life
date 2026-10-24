import type { TierId } from "./GameConfig";
import type { IDatabase } from "../storage/IDatabase";

export interface ComponentServiceAgeUpdate {
  readonly careerId: string;
  readonly tier: TierId;
  readonly season: number;
}

/** Advances service age exactly once inside the caller's race-result transaction. */
export async function incrementComponentServiceAgeForRace(
  database: IDatabase,
  input: ComponentServiceAgeUpdate,
): Promise<void> {
  if (!input.careerId.trim()) throw new Error("Career ID wajib diisi.");
  if (!Number.isSafeInteger(input.season) || input.season < 1) {
    throw new RangeError("Season harus integer positif.");
  }
  if (![1, 2, 3, 4, 5, 6].includes(input.tier)) {
    throw new RangeError("Tier harus berada pada rentang 1–6.");
  }
  await database.run(
    "UPDATE car_component_service SET races_since_reset = races_since_reset + 1 WHERE car_id IN (SELECT c.car_id FROM cars c JOIN teams t ON t.team_id = c.team_id WHERE t.career_id = ? AND t.division_id = ? AND c.season = ? AND t.is_active = 1);",
    [input.careerId, "T" + input.tier, input.season],
  );
}
