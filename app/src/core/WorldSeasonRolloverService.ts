import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { TIER_CONFIG, type TierId } from "./GameConfig";
import { generateSeasonCalendar, type CalendarCircuit } from "./SeasonCalendar";
import { calculateDriverAskingSalary, generateDriverDemandFactor } from "./ContractNegotiationEngine";
import { offerDriverContract } from "./CareerContractService";
import { hashSeed } from "./RandomDistributions";
import { generateSeasonFreeAgentDriver, generateTier6RookieDrivers } from "../seed/CareerWorldGenerator";
import { transitionWorldAfterSeason } from "./WorldSeasonTransitionService";

type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export interface WorldSeasonRolloverResult {
  readonly careerId: string;
  readonly completedSeason: number;
  readonly currentSeason: number;
  readonly calendarsCreated: number;
  readonly carsCreated: number;
  readonly aiTeamsReady: number;
  readonly driversRetiredByAge: number;
  readonly financialMovements: number;
  readonly tier6ReplacementTeams: number;
}

function n(row: DatabaseRow | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function tierOf(value: unknown): Tier {
  const tier = Number(String(value).replace(/^T/, ""));
  if (![1, 2, 3, 4, 5, 6].includes(tier)) throw new Error("Tier tidak valid saat rollover: " + String(value));
  return tier as Tier;
}
function markerId(seed: string, kind: string, key: string | number): string {
  return kind + "_" + hashSeed([seed, kind, key]).toString(16).padStart(8, "0");
}
async function markerExists(database: IDatabase, careerId: string, season: number, step: string): Promise<boolean> {
  const rows = await database.query(
    "SELECT step FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
    [careerId, season, step],
  );
  return rows.length > 0;
}
async function createNextSeasonCalendarAndCars(
  database: IDatabase,
  input: { careerId: string; worldSeed: string; completedSeason: number; nextSeason: number },
): Promise<{ calendarsCreated: number; carsCreated: number }> {
  const step = "season-calendar-cars";
  const existingMarker = await database.query(
    "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
    [input.careerId, input.nextSeason, step],
  );
  if (existingMarker[0]) {
    const saved = JSON.parse(String(existingMarker[0].result_json)) as { calendarsCreated?: number; carsCreated?: number };
    return { calendarsCreated: Number(saved.calendarsCreated ?? 0), carsCreated: Number(saved.carsCreated ?? 0) };
  }

  const circuitRows = await database.query(
    "SELECT circuit_id, name, length, estimated_lap_seconds, rain_probability, safety_car_probability FROM circuits ORDER BY circuit_id;",
  );
  const circuits: CalendarCircuit[] = circuitRows.map((row) => ({
    id: String(row.circuit_id),
    name: String(row.name),
    lengthKm: n(row, "length"),
    estimatedLapSeconds: n(row, "estimated_lap_seconds"),
    rainProbability: n(row, "rain_probability"),
    safetyCarProbability: n(row, "safety_car_probability"),
  }));
  if (circuits.length < Math.max(...([1, 2, 3, 4, 5, 6] as const).map((tier) => TIER_CONFIG[tier].roundsPerSeason))) {
    throw new Error("Pool sirkuit tidak cukup untuk membangun kalender season baru.");
  }

  let calendarsCreated = 0;
  let carsCreated = 0;
  await database.transaction(async () => {
    const recheck = await database.query(
      "SELECT step FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
      [input.careerId, input.nextSeason, step],
    );
    if (recheck.length) return;
    const unexpectedRaces = await database.query(
      "SELECT COUNT(*) AS count FROM races WHERE season = ?;",
      [input.nextSeason],
    );
    if (n(unexpectedRaces[0], "count") > 0) {
      throw new Error("Season baru memiliki race tanpa marker rollover; mencegah kalender duplikat.");
    }

    for (const tier of [1, 2, 3, 4, 5, 6] as const) {
      const schedule = generateSeasonCalendar({
        worldSeed: input.worldSeed,
        season: input.nextSeason,
        tier,
        circuits,
      });
      for (const race of schedule) {
        await database.run(
          "INSERT INTO races (race_id, division_id, season, round, circuit_id, laps, weather, track_condition, has_sprint, status) VALUES (?, ?, ?, ?, ?, ?, 'dynamic', 'dry', ?, 'scheduled');",
          [markerId(input.worldSeed, "race", input.nextSeason + "-" + tier + "-" + race.round), "T" + tier,
            input.nextSeason, race.round, race.circuitId, race.totalLaps, race.hasSprint ? 1 : 0],
        );
        calendarsCreated += 1;
      }
    }

    const carRows = await database.query(
      `SELECT t.team_id, c.engine_power, c.aero, c.high_speed, c.medium_speed, c.low_speed,
        c.mechanical_grip, c.traction, c.braking, c.tyre_management, c.engine_reliability,
        c.gearbox_reliability, c.brake_reliability, c.suspension_reliability,
        c.electronics_reliability, c.development_points, c.regulation_cycle_id
       FROM teams t
       JOIN cars c ON c.team_id = t.team_id AND c.season = ?
       WHERE t.career_id = ? AND t.is_active = 1
         AND NOT EXISTS (SELECT 1 FROM cars next_car WHERE next_car.team_id = t.team_id AND next_car.season = ?)
       ORDER BY t.team_id;`,
      [input.completedSeason, input.careerId, input.nextSeason],
    );
    for (const car of carRows) {
      await database.run(
        `INSERT INTO cars
          (car_id, team_id, season, engine_power, aero, high_speed, medium_speed, low_speed,
           mechanical_grip, traction, braking, tyre_management, engine_reliability, gearbox_reliability,
           brake_reliability, suspension_reliability, electronics_reliability, development_points, regulation_cycle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [markerId(input.worldSeed, "rollover-car", input.nextSeason + "-" + String(car.team_id)),
          String(car.team_id), input.nextSeason, n(car, "engine_power"), n(car, "aero"), n(car, "high_speed"),
          n(car, "medium_speed"), n(car, "low_speed"), n(car, "mechanical_grip"), n(car, "traction"),
          n(car, "braking"), n(car, "tyre_management"), n(car, "engine_reliability"), n(car, "gearbox_reliability"),
          n(car, "brake_reliability"), n(car, "suspension_reliability"), n(car, "electronics_reliability"),
          n(car, "development_points"), car.regulation_cycle_id == null ? null : String(car.regulation_cycle_id)],
      );
      carsCreated += 1;
    }

    const teamsWithoutCar = await database.query(
      `SELECT t.team_id FROM teams t WHERE t.career_id = ? AND t.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM cars c WHERE c.team_id = t.team_id AND c.season = ?);`,
      [input.careerId, input.nextSeason],
    );
    if (teamsWithoutCar.length) {
      throw new Error("Rollover tidak dapat membuat mobil season baru untuk " + teamsWithoutCar.length + " tim aktif.");
    }
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
      [input.careerId, input.nextSeason, step, JSON.stringify({ calendarsCreated, carsCreated })],
    );
  });
  return { calendarsCreated, carsCreated };
}

async function activeEligibleDriverCount(
  database: IDatabase, teamId: string, season: number, tier: Tier, useNextAge: boolean,
): Promise<number> {
  const band = TIER_CONFIG[tier].driverAge;
  const ageExpr = useNextAge ? "d.age + 1" : "d.age";
  const rows = await database.query(
    `SELECT COUNT(DISTINCT d.driver_id) AS count
     FROM driver_contracts dc JOIN drivers d ON d.driver_id = dc.driver_id
     WHERE dc.team_id = ? AND dc.start_season <= ? AND dc.end_season >= ?
       AND d.is_retired = 0 AND d.is_academy_driver = 0
       AND ${ageExpr} BETWEEN ? AND ?;`,
    [teamId, season, season, band.min, band.max],
  );
  return n(rows[0], "count");
}

async function prepareAiRoster(
  database: IDatabase,
  input: { careerId: string; worldSeed: string; completedSeason: number; nextSeason: number },
): Promise<{ aiTeamsReady: number; newTier6DriverIds: string[] }> {
  const teams = await database.query(
    "SELECT team_id, division_id, base_country, cash, founded_season FROM teams WHERE career_id = ? AND is_active = 1 AND is_player_team = 0 ORDER BY division_id, team_id;",
    [input.careerId],
  );
  const newTier6DriverIds: string[] = [];
  let aiTeamsReady = 0;

  for (const team of teams) {
    const teamId = String(team.team_id);
    const tier = tierOf(team.division_id);
    const step = "ai-roster-" + teamId;
    const done = await database.query(
      "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
      [input.careerId, input.nextSeason, step],
    );
    if (done[0]) {
      const saved = JSON.parse(String(done[0].result_json)) as { newDriverIds?: unknown };
      if (Array.isArray(saved.newDriverIds)) newTier6DriverIds.push(...saved.newDriverIds.map(String));
      aiTeamsReady += 1;
      continue;
    }

    if (tier === 6) {
      let generatedForTeam: string[] = [];
      await database.transaction(async () => {
        const concurrentMarker = await database.query(
          "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
          [input.careerId, input.nextSeason, step],
        );
        if (concurrentMarker[0]) {
          const saved = JSON.parse(String(concurrentMarker[0].result_json)) as { newDriverIds?: unknown };
          if (Array.isArray(saved.newDriverIds)) generatedForTeam = saved.newDriverIds.map(String);
          return;
        }

        // Replacement teams already have next-season cars, drivers and contracts from their generator.
        if (n(team, "founded_season") >= input.nextSeason) {
          const replacementCount = await activeEligibleDriverCount(database, teamId, input.nextSeason, 6, false);
          if (replacementCount !== 2) throw new Error("New Tier 6 team " + teamId + " tidak memiliki dua driver season barunya.");
        } else {
          const returning = await database.query(
            `SELECT d.driver_id FROM drivers d
             JOIN driver_contracts old_dc ON old_dc.driver_id = d.driver_id
             WHERE d.career_id = ? AND old_dc.team_id = ? AND old_dc.start_season <= ? AND old_dc.end_season = ?
               AND d.is_retired = 0 AND d.is_academy_driver = 0
               AND d.age + 1 BETWEEN ? AND ?
               AND NOT EXISTS (SELECT 1 FROM driver_contracts next_dc WHERE next_dc.driver_id = d.driver_id AND next_dc.start_season <= ? AND next_dc.end_season >= ?)
             ORDER BY d.pace DESC, d.driver_id;`,
            [input.careerId, teamId, input.completedSeason, input.completedSeason,
              TIER_CONFIG[6].driverAge.min, TIER_CONFIG[6].driverAge.max, input.nextSeason, input.nextSeason],
          );
          for (const driver of returning) {
            const contractId = markerId(input.worldSeed, "tier6-renewal", input.nextSeason + "-" + teamId + "-" + String(driver.driver_id));
            await database.run(
              "INSERT OR IGNORE INTO driver_contracts (contract_id, driver_id, team_id, start_season, end_season, salary, signing_bonus, win_bonus, podium_bonus, championship_bonus, release_clause, team_option, driver_option) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, NULL, 0, 0);",
              [contractId, String(driver.driver_id), teamId, input.nextSeason, input.nextSeason],
            );
            if (await activeEligibleDriverCount(database, teamId, input.nextSeason, 6, true) >= 2) break;
          }
          const oldEligibleCount = await activeEligibleDriverCount(database, teamId, input.nextSeason, 6, true);
          const missing = Math.max(0, 2 - oldEligibleCount);
          if (missing) {
            generatedForTeam = [...await generateTier6RookieDrivers(database, {
              careerId: input.careerId, teamId, season: input.nextSeason, count: missing,
            })];
          }
          if (oldEligibleCount + generatedForTeam.length !== 2) {
            throw new Error("Tier 6 team " + teamId + " tidak memiliki tepat dua driver eligible setelah rookie generation.");
          }
        }
        await database.run(
          "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
          [input.careerId, input.nextSeason, step, JSON.stringify({ teamId, newDriverIds: generatedForTeam })],
        );
      });
      newTier6DriverIds.push(...generatedForTeam);
      aiTeamsReady += 1;
      continue;
    }

    let seatCount = await activeEligibleDriverCount(database, teamId, input.nextSeason, tier, true);
    if (seatCount < 2) {
      const band = TIER_CONFIG[tier].driverAge;
      const candidates = await database.query(
        `SELECT d.driver_id, d.market_value, d.ambition, d.age,
          CASE WHEN EXISTS (
            SELECT 1 FROM driver_contracts previous_dc
            WHERE previous_dc.driver_id = d.driver_id AND previous_dc.team_id = ?
              AND previous_dc.start_season <= ? AND previous_dc.end_season = ?
          ) THEN 0 ELSE 1 END AS previous_team_driver
         FROM drivers d
         WHERE d.career_id = ? AND d.is_retired = 0 AND d.market_value > 0
           AND (d.is_academy_driver = 0 OR EXISTS (
             SELECT 1 FROM driver_contracts academy_dc
             WHERE academy_dc.driver_id = d.driver_id AND academy_dc.team_id = ?
               AND academy_dc.start_season <= ? AND academy_dc.end_season = ?
           ))
           AND d.age + 1 BETWEEN ? AND ?
           AND NOT EXISTS (
             SELECT 1 FROM driver_contracts active_dc
             WHERE active_dc.driver_id = d.driver_id AND active_dc.start_season <= ? AND active_dc.end_season >= ?
           )
         ORDER BY previous_team_driver ASC, d.reputation DESC, d.pace DESC, d.driver_id;`,
        [teamId, input.completedSeason, input.completedSeason, input.careerId, teamId,
          input.completedSeason, input.completedSeason, band.min, band.max, input.nextSeason, input.nextSeason],
      );

      for (const candidate of candidates) {
        const driverId = String(candidate.driver_id);
        const askingSalary = calculateDriverAskingSalary({
          marketValue: n(candidate, "market_value"),
          ambition: n(candidate, "ambition", 50),
          demandFactor: generateDriverDemandFactor({ worldSeed: input.worldSeed, season: input.nextSeason, driverId }),
        });
        if (askingSalary <= 0) continue;
        const ageAtStart = n(candidate, "age") + 1;
        const durationSeasons = ageAtStart >= 35 ? 3 : 2;
        const role = seatCount === 0 ? "lead" : "second";
        const offerInput = {
          careerId: input.careerId, teamId, driverId,
          startSeason: input.nextSeason, durationSeasons,
          offeredSalary: Math.max(1, Math.ceil(askingSalary * 1.2)),
          championshipBonus: Math.ceil(askingSalary),
          role: role as "lead" | "second",
        };
        try {
          const result = await offerDriverContract(database, offerInput);
          if (result.decision === "accepted") {
            seatCount += 1;
          } else if (result.decision === "counter-offer" && result.counterOffer) {
            try {
              const counter = await offerDriverContract(database, {
                ...offerInput,
                offeredSalary: result.counterOffer.salary,
                durationSeasons: result.counterOffer.durationSeasons,
              });
              if (counter.decision === "accepted") seatCount += 1;
            } catch {
              // A counter that does not improve the documented score is skipped for this team.
            }
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("saldo kas negatif") && n(team, "cash") < 0) continue;
          throw error;
        }
        if (seatCount >= 2) break;
      }

      // If the existing market cannot fill the grid, create source-distributed rookies
      // and negotiate with them using the same contract rules as other free agents.
      if (seatCount < 2 && n(team, "cash") >= 0) {
        for (let attempt = 0; attempt < 20 && seatCount < 2; attempt += 1) {
          const driverId = await generateSeasonFreeAgentDriver(database, {
            careerId: input.careerId,
            tier: tier as Exclude<TierId, 6>,
            season: input.nextSeason,
            slot: teamId + "-seat-" + seatCount + "-attempt-" + attempt,
          });
          const candidateRows = await database.query(
            "SELECT market_value, ambition, age FROM drivers WHERE driver_id = ? AND career_id = ? AND is_retired = 0;",
            [driverId, input.careerId],
          );
          const candidate = candidateRows[0];
          if (!candidate) throw new Error("Rookie free-agent generation tidak mengembalikan driver.");
          const askingSalary = calculateDriverAskingSalary({
            marketValue: n(candidate, "market_value"),
            ambition: n(candidate, "ambition", 50),
            demandFactor: generateDriverDemandFactor({ worldSeed: input.worldSeed, season: input.nextSeason, driverId }),
          });
          if (askingSalary <= 0) continue;
          const ageAtStart = n(candidate, "age") + 1;
          const durationSeasons = ageAtStart >= 35 ? 3 : 2;
          const offerInput = {
            careerId: input.careerId, teamId, driverId,
            startSeason: input.nextSeason, durationSeasons,
            offeredSalary: Math.max(1, Math.ceil(askingSalary * 1.2)),
            championshipBonus: Math.ceil(askingSalary),
            role: (seatCount === 0 ? "lead" : "second") as "lead" | "second",
          };
          try {
            const result = await offerDriverContract(database, offerInput);
            if (result.decision === "accepted") seatCount += 1;
            else if (result.decision === "counter-offer" && result.counterOffer) {
              const counter = await offerDriverContract(database, {
                ...offerInput,
                offeredSalary: result.counterOffer.salary,
                durationSeasons: result.counterOffer.durationSeasons,
              });
              if (counter.decision === "accepted") seatCount += 1;
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes("saldo kas negatif")) break;
            if (error instanceof Error && error.message.includes("negosiasi ulang")) continue;
            throw error;
          }
        }
      }
    }

    const finalCount = await activeEligibleDriverCount(database, teamId, input.nextSeason, tier, true);
    if (finalCount !== 2) {
      throw new Error("AI team " + teamId + " hanya memiliki " + finalCount + "/2 driver eligible untuk Tier " + tier + " season " + input.nextSeason + ".");
    }
    await database.run(
      "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
      [input.careerId, input.nextSeason, step, JSON.stringify({ teamId, rosterCount: finalCount, newDriverIds: [] })],
    );
    aiTeamsReady += 1;
  }

  return { aiTeamsReady, newTier6DriverIds };
}

/**
 * Completes the documented world transition and prepares a playable next-season
 * calendar, cars, and AI driver grids. Player contracts are intentionally left to
 * the transfer-market UI; the player can choose their own drivers for the new season.
 */
export async function rollWorldSeasonForward(
  database: IDatabase,
  input: { readonly careerId: string; readonly completedSeason: number },
): Promise<WorldSeasonRolloverResult> {
  if (!input.careerId.trim() || !Number.isSafeInteger(input.completedSeason) || input.completedSeason < 1) {
    throw new RangeError("Career ID dan completed season harus valid.");
  }
  const nextSeason = input.completedSeason + 1;
  const [careerRows, readyRows] = await Promise.all([
    database.query("SELECT world_seed, current_season FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'season-rollover-ready';", [input.careerId, nextSeason]),
  ]);
  const career = careerRows[0];
  if (!career) throw new Error("Career untuk season rollover tidak ditemukan.");
  if (readyRows[0]) {
    const saved = JSON.parse(String(readyRows[0].result_json)) as Omit<WorldSeasonRolloverResult, "careerId" | "completedSeason">;
    return { careerId: input.careerId, completedSeason: input.completedSeason, ...saved };
  }
  if (n(career, "current_season", 1) !== input.completedSeason) {
    throw new Error("Career season berubah; rollover harus dimulai dari season yang baru saja selesai.");
  }

  const worldTransition = await transitionWorldAfterSeason(database, input);
  const infrastructure = await createNextSeasonCalendarAndCars(database, {
    careerId: input.careerId,
    worldSeed: String(career.world_seed),
    completedSeason: input.completedSeason,
    nextSeason,
  });
  const roster = await prepareAiRoster(database, {
    careerId: input.careerId,
    worldSeed: String(career.world_seed),
    completedSeason: input.completedSeason,
    nextSeason,
  });

  const ageStep = "age-progression";
  let driversRetiredByAge = 0;
  if (!(await markerExists(database, input.careerId, nextSeason, ageStep))) {
    const replacementRows = await database.query(
      "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = 'tier6-replacement';",
      [input.careerId, nextSeason],
    );
    const replacementResult = replacementRows[0]
      ? JSON.parse(String(replacementRows[0].result_json)) as { createdTeamIds?: unknown }
      : {};
    const newTeamIds = Array.isArray(replacementResult.createdTeamIds) ? replacementResult.createdTeamIds.map(String) : [];
    const newDriverIds = new Set<string>(roster.newTier6DriverIds);
    if (newTeamIds.length) {
      const newTeamDrivers = await database.query(
        "SELECT driver_id FROM driver_contracts WHERE team_id IN (" + newTeamIds.map(() => "?").join(",") + ") AND start_season = ? AND end_season = ?;",
        [...newTeamIds, nextSeason, nextSeason],
      );
      for (const row of newTeamDrivers) newDriverIds.add(String(row.driver_id));
    }
    const exclusions = [...newDriverIds];
    await database.transaction(async () => {
      const recheck = await database.query(
        "SELECT step FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
        [input.careerId, nextSeason, ageStep],
      );
      if (recheck.length) return;
      if (exclusions.length) {
        await database.run(
          "UPDATE drivers SET age = age + 1 WHERE career_id = ? AND is_retired = 0 AND driver_id NOT IN (" + exclusions.map(() => "?").join(",") + ");",
          [input.careerId, ...exclusions],
        );
      } else {
        await database.run("UPDATE drivers SET age = age + 1 WHERE career_id = ? AND is_retired = 0;", [input.careerId]);
      }
      await database.run(
        "UPDATE staff SET age = age + 1 WHERE career_id = ? AND team_id IN (SELECT team_id FROM teams WHERE career_id = ? AND founded_season < ?);",
        [input.careerId, input.careerId, nextSeason],
      );
      await database.run(
        "UPDATE drivers SET is_retired = 1, retire_reason = 'age' WHERE career_id = ? AND is_retired = 0 AND age > ?;",
        [input.careerId, TIER_CONFIG[1].driverAge.max],
      );
      const retiredRows = await database.query("SELECT COUNT(*) AS count FROM drivers WHERE career_id = ? AND is_retired = 1 AND retire_reason = 'age';", [input.careerId]);
      driversRetiredByAge = n(retiredRows[0], "count");
      await database.run(
        "INSERT INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, ?, ?);",
        [input.careerId, nextSeason, ageStep, JSON.stringify({ driversRetiredByAge: driversRetiredByAge, excludedNewDriverIds: exclusions })],
      );
    });
  } else {
    const ageRows = await database.query(
      "SELECT result_json FROM world_transition_steps WHERE career_id = ? AND season = ? AND step = ?;",
      [input.careerId, nextSeason, ageStep],
    );
    const saved = JSON.parse(String(ageRows[0]?.result_json ?? "{}")) as { driversRetiredByAge?: number };
    driversRetiredByAge = Number(saved.driversRetiredByAge ?? 0);
  }

  await database.transaction(async () => {
    const currentRows = await database.query("SELECT current_season FROM career WHERE career_id = ?;", [input.careerId]);
    const current = n(currentRows[0], "current_season", 1);
    if (current === input.completedSeason) {
      await database.run("UPDATE career SET current_season = ?, current_race = 1, updated_at = CURRENT_TIMESTAMP WHERE career_id = ?;",
        [nextSeason, input.careerId]);
    } else if (current !== nextSeason) {
      throw new Error("Career season berubah selama rollover; tidak aman untuk mengubah kalender aktif.");
    }
    const result = {
      currentSeason: nextSeason,
      calendarsCreated: infrastructure.calendarsCreated,
      carsCreated: infrastructure.carsCreated,
      aiTeamsReady: roster.aiTeamsReady,
      driversRetiredByAge,
      financialMovements: worldTransition.movementEvents.length,
      tier6ReplacementTeams: worldTransition.replacementTeamsCreated,
    };
    await database.run(
      "INSERT OR IGNORE INTO world_transition_steps (career_id, season, step, result_json) VALUES (?, ?, 'season-rollover-ready', ?);",
      [input.careerId, nextSeason, JSON.stringify(result)],
    );
  });

  return {
    careerId: input.careerId,
    completedSeason: input.completedSeason,
    currentSeason: nextSeason,
    calendarsCreated: infrastructure.calendarsCreated,
    carsCreated: infrastructure.carsCreated,
    aiTeamsReady: roster.aiTeamsReady,
    driversRetiredByAge,
    financialMovements: worldTransition.movementEvents.length,
    tier6ReplacementTeams: worldTransition.replacementTeamsCreated,
  };
}
