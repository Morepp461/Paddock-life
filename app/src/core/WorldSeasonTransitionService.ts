import type { IDatabase } from "../storage/IDatabase";
import type { DivisionMovementEvent } from "./FinancialDivisionMovementEngine";
import { applyFinancialDivisionMovement } from "./FinancialDivisionMovementService";
import { generateTier6ReplacementTeams } from "../seed/CareerWorldGenerator";

type Row = Readonly<Record<string, unknown>>;

export interface WorldSeasonTransitionResult {
  readonly careerId: string;
  readonly completedSeason: number;
  readonly nextSeason: number;
  readonly movementEvents: readonly DivisionMovementEvent[];
  readonly newTier6SlotsNeeded: number;
  readonly replacementTeamsCreated: number;
  readonly activeTeamsByTier: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, number>>;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new Error("World transition marker tidak memiliki result_json valid.");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("World transition result_json bukan object.");
  return parsed as Record<string, unknown>;
}

/**
 * Runs the source-defined financial movement and Tier 6 replacement phases after
 * all six divisions have completed and settled the same season. Each phase has
 * its own database marker, so a retry can resume without repeating committed work.
 */
export async function transitionWorldAfterSeason(
  database: IDatabase,
  input: { readonly careerId: string; readonly completedSeason: number },
): Promise<WorldSeasonTransitionResult> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.completedSeason) || input.completedSeason < 1) {
    throw new RangeError("Career ID dan completed season harus valid.");
  }
  const nextSeason = input.completedSeason + 1;
  const [careerRows, movementRows, replacementRows] = await Promise.all([
    database.query("SELECT career_id FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'financial-movement';", [input.careerId, nextSeason]),
    database.query("SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'tier6-replacement';", [input.careerId, nextSeason]),
  ]);
  if (!careerRows.length) throw new Error("Career untuk world season transition tidak ditemukan.");

  let movement: { readonly events: readonly DivisionMovementEvent[]; readonly newTier6SlotsNeeded: number };
  if (movementRows[0]) {
    const saved = parseObject(movementRows[0].result_json);
    if (!Array.isArray(saved.events) || !Number.isSafeInteger(saved.newTier6SlotsNeeded)) {
      throw new Error("Financial movement marker rusak; world transition dihentikan tanpa mengulang transaksi.");
    }
    movement = {
      events: saved.events as DivisionMovementEvent[],
      newTier6SlotsNeeded: Number(saved.newTier6SlotsNeeded),
    };
  } else {
    movement = await applyFinancialDivisionMovement(database, {
      careerId: input.careerId,
      completedSeason: input.completedSeason,
    });
  }

  let replacementTeamsCreated: number;
  if (replacementRows[0]) {
    const saved = parseObject(replacementRows[0].result_json);
    if (!Number.isSafeInteger(saved.slotsFilled)) throw new Error("Tier 6 replacement marker rusak.");
    replacementTeamsCreated = Number(saved.slotsFilled);
  } else {
    const replacements = await generateTier6ReplacementTeams(database, {
      careerId: input.careerId,
      season: nextSeason,
    });
    replacementTeamsCreated = replacements.slotsFilled;
  }

  const activeTeamsByTier = {} as Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  for (const tier of [1, 2, 3, 4, 5, 6] as const) {
    const rows: readonly Row[] = await database.query(
      "SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND division_id = ? AND is_active = 1;",
      [input.careerId, "T" + tier],
    );
    activeTeamsByTier[tier] = Number(rows[0]?.count ?? 0);
    if (activeTeamsByTier[tier] !== 12) {
      throw new Error("World transition tidak valid: Tier " + tier + " memiliki " + activeTeamsByTier[tier] + " tim aktif, seharusnya 12.");
    }
  }
  return {
    careerId: input.careerId,
    completedSeason: input.completedSeason,
    nextSeason,
    movementEvents: movement.events,
    newTier6SlotsNeeded: movement.newTier6SlotsNeeded,
    replacementTeamsCreated,
    activeTeamsByTier,
  };
}
