import { DIFFICULTY_MULTIPLIERS, FINANCE_GRADE_MULTIPLIERS, INITIAL_DISTRIBUTIONS, PERFORMANCE_GRADE_OFFSETS, clamp } from "../core/InitialDistributions";
import { TIER_CONFIG, type TierId } from "../core/GameConfig";
import { SeededRandom } from "../core/SeededRandom";
import { hashSeed, sampleBoundedNormal as sampleDelta } from "../core/RandomDistributions";
import { generateSeasonCalendar } from "../core/SeasonCalendar";
import { selectSponsorTier } from "../core/SponsorEngine";
import { calculateEntryFee } from "../core/EconomyEngine";
import { validateCareerSetupDraft, type CareerSetupDraft, type ValidatedCareerSetup, type CareerTeamCandidate } from "../core/CareerSetupEngine";
import { generateName, normalizeFullName, type CountryNameProfile, type NameCulture, type NamePool } from "./NameGenerator";
import { seedStaticWorldDataFromPublic } from "./WorldSeeder";
import type { DatabaseValue, IDatabase } from "../storage/IDatabase";

type TeamPoolRow = {
  pool_team_id: string; tier: number; name: string; code: string; country: string;
  strength_class: "Kuat" | "Menengah" | "Lemah"; finance_grade: "A" | "B" | "C" | "D";
  performance_grade: "A" | "B" | "C" | "D"; personality: string; character: string;
};
type CircuitRow = {
  circuit_id: string; name: string; length: number; estimated_lap_seconds: number;
  rain_probability: number; safety_car_probability: number; abrasion: number;
};
type SponsorRow = {
  sponsor_id: string; name: string; category: string; tier: number; origin: "Global" | "Indonesia";
  base_value: number; duration_seasons: number; focus: string; min_team_reputation: number;
};

const STAFF_ROLES: Readonly<Record<TierId, readonly string[]>> = {
  1: ["Race Engineer", "Mechanical Engineer", "Performance Coach", "Scout", "Strategist", "Aerodynamicist", "Chief Engineer", "Technical Director", "Fitness Coach", "Race Engineer 2", "Sporting Director"],
  2: ["Race Engineer", "Mechanical Engineer", "Performance Coach", "Scout", "Strategist", "Aerodynamicist", "Chief Engineer", "Technical Director", "Fitness Coach", "Race Engineer 2", "Sporting Director"],
  3: ["Race Engineer", "Mechanical Engineer", "Performance Coach", "Scout", "Strategist", "Aerodynamicist", "Chief Engineer", "Technical Director", "Fitness Coach"],
  4: ["Race Engineer", "Mechanical Engineer", "Performance Coach", "Scout", "Strategist", "Aerodynamicist", "Chief Engineer"],
  5: ["Race Engineer", "Mechanical Engineer", "Performance Coach", "Scout", "Strategist"],
  6: ["Race Engineer", "Mechanical Engineer", "Performance Coach"],
};

function stableId(seed: string, kind: string, index: number | string): string {
  return kind + "_" + hashSeed([seed, kind, index]).toString(16).padStart(8, "0");
}
function pick<T>(items: readonly T[], rng: SeededRandom): T {
  if (!items.length) throw new Error("Tidak ada pilihan yang tersedia untuk world generation.");
  return items[Math.floor(rng.next() * items.length)]!;
}
function normalizedCountry(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("en-US");
}
function gradeForStrength(strength: TeamPoolRow["strength_class"]): "A" | "B" | "C" | "D" {
  return strength === "Kuat" ? "A" : strength === "Menengah" ? "B" : "D";
}
function pickCountry(pool: NamePool, baseCountry: string, rng: SeededRandom): CountryNameProfile {
  const matched = pool.countries.find((country) => normalizedCountry(country.countryName) === normalizedCountry(baseCountry));
  if (matched) return matched;
  const weighted = pool.countries.filter((country) => country.globalWeight > 0);
  const total = weighted.reduce((sum, country) => sum + country.globalWeight, 0);
  let value = rng.next() * total;
  for (const country of weighted) {
    value -= country.globalWeight;
    if (value < 0) return country;
  }
  return weighted[weighted.length - 1]!;
}
function chooseCulture(pool: NamePool, country: CountryNameProfile, rng: SeededRandom): string {
  let value = rng.next() * country.cultures.reduce((sum, item) => sum + item.weight, 0);
  for (const entry of country.cultures) {
    value -= entry.weight;
    if (value < 0) return entry.cultureId;
  }
  return country.cultures[country.cultures.length - 1]!.cultureId;
}
function sampleNormalBounded(rng: SeededRandom, mean: number, sd: number, min: number, max: number): number {
  return clamp(mean + sampleDelta(rng, sd), min, max);
}
function buildNamePool(cultureRows: readonly Record<string, unknown>[], countryRows: readonly Record<string, unknown>[], blockedRows: readonly Record<string, unknown>[]): NamePool {
  const cultureMap = new Map<string, { maleGivenNames: string[]; femaleGivenNames: string[]; surnames: string[] }>();
  for (const row of cultureRows) {
    const id = String(row.culture_id);
    if (!cultureMap.has(id)) cultureMap.set(id, { maleGivenNames: [], femaleGivenNames: [], surnames: [] });
    const culture = cultureMap.get(id)!;
    const name = String(row.name);
    if (row.gender === "male") culture.maleGivenNames.push(name);
    else if (row.gender === "female") culture.femaleGivenNames.push(name);
    else if (row.gender === "surname") culture.surnames.push(name);
  }
  const countries: CountryNameProfile[] = countryRows.map((row) => ({
    countryCode: String(row.country_code), countryName: String(row.country_name),
    globalWeight: Number(row.global_weight),
    cultures: JSON.parse(String(row.culture_weights_json)) as CountryNameProfile["cultures"],
  }));
  return {
    cultures: [...cultureMap.entries()].map(([id, values]) => ({ id, ...values })),
    countries,
    blockedFullNames: blockedRows.map((row) => String(row.display_name)),
  };
}

async function loadNamePoolFromDatabase(database: IDatabase): Promise<NamePool> {
  const [cultures, countries, blocked] = await Promise.all([
    database.query("SELECT culture_id, gender, name FROM name_culture_pool ORDER BY culture_id, gender, name;"),
    database.query("SELECT country_code, country_name, global_weight, culture_weights_json FROM nationality_name_cultures ORDER BY country_code;"),
    database.query("SELECT display_name FROM blocked_names ORDER BY normalized_full_name;"),
  ]);
  const pool = buildNamePool(cultures, countries, blocked);
  if (pool.cultures.length !== 52 || pool.countries.length !== 199 || pool.blockedFullNames.length < 51) {
    throw new Error("Pool nama belum lengkap; career tidak dibuat agar save tidak setengah jadi.");
  }
  return pool;
}

async function insertDriver(
  database: IDatabase, input: {
    seed: string; index: number | string; careerId: string; teamId: string | null; tier: TierId;
    pool: NamePool; rng: SeededRandom; baseCountry: string; existingNames: Set<string>;
    freeAgent?: boolean; academy?: boolean;
  },
): Promise<string> {
  const dist = INITIAL_DISTRIBUTIONS[input.tier];
  const generated = generateName(input.pool, input.rng, {
    role: "driver", tier: input.tier,
    baseCountryCode: pickCountry(input.pool, input.baseCountry, input.rng).countryCode,
    existingFullNames: input.existingNames,
  });
  input.existingNames.add(normalizeFullName(generated.fullName));
  const age = input.academy
    ? Math.round(sampleNormalBounded(input.rng, Math.min(dist.driverAgeMean, 16), dist.driverAgeSd, 8, 17))
    : Math.round(sampleNormalBounded(input.rng, dist.driverAgeMean, dist.driverAgeSd, dist.minDriverAge, dist.maxDriverAge));
  const overall = sampleNormalBounded(input.rng, dist.driverOverallMean, dist.driverOverallSd, 1, 99);
  const potentialRoom = age <= 13 ? 20 + input.rng.next() * 20 : age <= 17 ? 12 + input.rng.next() * 16 : age <= 23 ? 6 + input.rng.next() * 10 : age <= 29 ? 2 + input.rng.next() * 6 : input.rng.next() * 3;
  const values = {
    pace: overall, qualifying: sampleNormalBounded(input.rng, overall, 5, 1, 100),
    racecraft: sampleNormalBounded(input.rng, overall, 8, 1, 100),
    consistency: sampleNormalBounded(input.rng, overall, 8, 1, 100),
    wet_skill: sampleNormalBounded(input.rng, overall, 10, 1, 100),
    tyre_management: sampleNormalBounded(input.rng, overall, 7, 1, 100),
    overtaking: sampleNormalBounded(input.rng, overall, 8, 1, 100),
    defending: sampleNormalBounded(input.rng, overall, 8, 1, 100),
    starts: sampleNormalBounded(input.rng, overall, 8, 1, 100),
    adaptability: sampleNormalBounded(input.rng, overall, 8, 1, 100),
    focus: sampleNormalBounded(input.rng, overall, 8, 20, 95),
    pressure: sampleNormalBounded(input.rng, overall, 8, 20, 95),
    morale: sampleNormalBounded(input.rng, 60, 8, 20, 95),
    confidence: sampleNormalBounded(input.rng, 55, 8, 20, 95),
    aggression: sampleNormalBounded(input.rng, 55, 15, 20, 90),
    teamwork: sampleNormalBounded(input.rng, overall, 8, 20, 95),
    potential: clamp(overall + potentialRoom, 1, 100),
    development_rate: clamp(1 + sampleDelta(input.rng, 0.18), 0.6, 1.4),
    injury_resistance: 30 + input.rng.next() * 60,
    loyalty: sampleNormalBounded(input.rng, 60, 15, 20, 95),
    ambition: sampleNormalBounded(input.rng, 65, 15, 30, 95),
    fan_popularity: sampleNormalBounded(input.rng, dist.fanPopularityMean, 15, 0, 100),
  };
  const driverId = stableId(input.seed, "driver", input.index);
  const marketValue = input.tier === 6 ? 0 : Math.round(TIER_CONFIG[input.tier].requiredBudget * clamp(overall / Math.max(1, dist.driverOverallMean), 0.25, 2.0) * 0.06);
  await database.run(
    `INSERT INTO drivers
      (driver_id, career_id, name, pace, qualifying, racecraft, consistency, wet_skill, tyre_management,
       overtaking, defending, starts, adaptability, focus, pressure, morale, confidence, aggression, teamwork,
       potential, development_rate, injury_resistance, loyalty, ambition, fan_popularity, age, nationality,
       name_culture, is_retired, reputation, market_value, is_academy_driver)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?);`,
    [driverId, input.careerId, generated.fullName, values.pace, values.qualifying, values.racecraft, values.consistency,
      values.wet_skill, values.tyre_management, values.overtaking, values.defending, values.starts, values.adaptability,
      values.focus, values.pressure, values.morale, values.confidence, values.aggression, values.teamwork, values.potential,
      values.development_rate, values.injury_resistance, values.loyalty, values.ambition, values.fan_popularity, age,
      generated.countryCode, generated.cultureId, Math.round(overall * 100), marketValue, input.academy ? 1 : 0],
  );
  if (input.teamId) {
    const rb = TIER_CONFIG[input.tier].requiredBudget;
    const salary = input.tier === 6 ? 0 : Math.round(rb * (input.academy ? 0.008 : 0.06));
    await database.run(
      "INSERT INTO driver_contracts (contract_id, driver_id, team_id, start_season, end_season, salary, signing_bonus, win_bonus, podium_bonus, championship_bonus) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?);",
      [stableId(input.seed, "contract", input.index), driverId, input.teamId, salary, Math.round(salary * 0.15), Math.round(salary * 0.02), Math.round(salary * 0.01), Math.round(salary * 0.08)],
    );
  }
  return driverId;
}

export interface CareerGenerationResult {
  readonly careerId: string;
  readonly playerTeamId: string;
  readonly selectedTier: TierId;
  readonly teamsCreated: number;
  readonly driversCreated: number;
  readonly staffCreated: number;
  readonly managersCreated: number;
  readonly racesScheduled: number;
  readonly sponsorOffersCreated: number;
}

export async function generateCareerWorld(
  database: IDatabase,
  draft: CareerSetupDraft,
  options: { fetcher?: typeof fetch; managerGender?: "male" | "female" } = {},
): Promise<CareerGenerationResult> {
  const fetcher = options.fetcher ?? fetch;
  await seedStaticWorldDataFromPublic(database, fetcher);
  const pool = await loadNamePoolFromDatabase(database);
  const poolRows = await database.query("SELECT * FROM team_pool ORDER BY tier, pool_team_id;") as unknown as TeamPoolRow[];
  const countryCodes = new Set(pool.countries.map((country) => country.countryCode));
  const teamCandidates: CareerTeamCandidate[] = poolRows.map((row) => ({
    teamId: row.pool_team_id, tier: row.tier as TierId, name: row.name, strength: row.strength_class,
  }));
  const blockedNames = new Set(pool.blockedFullNames.map(normalizeFullName));
  const validated: ValidatedCareerSetup = validateCareerSetupDraft(draft, {
    availableCountryCodes: countryCodes,
    blockedManagerNames: blockedNames,
    blockedTeamNames: new Set(),
    existingTeamNames: new Set(poolRows.map((row) => row.name)),
    existingTeamCodes: new Set(poolRows.map((row) => row.code)),
    teamPool: teamCandidates,
  });
  const seed = validated.worldSeed;
  const careerId = "career_" + hashSeed([seed, validated.managerName, validated.path, validated.selectedTier]).toString(16);
  const rng = new SeededRandom(hashSeed([seed, "career-world"]));
  const existingNames = new Set<string>(pool.blockedFullNames.map(normalizeFullName));
  const circuits = await database.query(
    "SELECT circuit_id, name, length, estimated_lap_seconds, rain_probability, safety_car_probability, abrasion FROM circuits ORDER BY circuit_id;",
  ) as unknown as CircuitRow[];
  if (circuits.length !== 30) throw new Error("Career generation dibatalkan: pool 30 sirkuit belum lengkap.");
  const sponsors = await database.query("SELECT * FROM sponsor_pool ORDER BY sponsor_id;") as unknown as SponsorRow[];
  if (sponsors.length !== 100) throw new Error("Career generation dibatalkan: katalog sponsor belum lengkap.");

  let playerTeamId = "";
  let driversCreated = 0;
  let staffCreated = 0;
  let managersCreated = 0;
  let racesScheduled = 0;
  let sponsorOffersCreated = 0;

  await database.transaction(async () => {
    const difficulty = DIFFICULTY_MULTIPLIERS[validated.difficulty];
    await database.run(
      "INSERT INTO career (career_id, user_id, career_name, current_division_tier, highest_unlocked_tier, current_season, current_race, game_mode, difficulty, world_seed) VALUES (?, NULL, ?, ?, ?, 1, 1, 'career', ?, ?);",
      [careerId, validated.managerName + " Career", validated.selectedTier, validated.highestUnlockedTier, validated.difficulty, seed],
    );
    const playerPoolId = validated.path === "takeover" ? validated.takeoverTeam!.teamId : validated.newTeam!.replacedTeamId;
    const teamIds = new Map<string, string>();
    let teamIndex = 0;
    for (const source of poolRows) {
      const isPlayer = source.pool_team_id === playerPoolId;
      const teamId = stableId(seed, "team", source.pool_team_id);
      teamIds.set(source.pool_team_id, teamId);
      const tier = source.tier as TierId;
      const config = TIER_CONFIG[tier];
      const distribution = INITIAL_DISTRIBUTIONS[tier];
      const playerNew = isPlayer && validated.path === "new-team";
      const financeGrade = playerNew ? "C" : source.finance_grade;
      const performanceGrade = playerNew ? "C" : source.performance_grade;
      const strengthGrade = playerNew ? "C" : gradeForStrength(source.strength_class);
      const financeMultiplier = FINANCE_GRADE_MULTIPLIERS[financeGrade];
      const baseCash = config.requiredBudget * financeMultiplier * (0.85 + rng.next() * 0.30);
      const grossCash = Math.round(baseCash * (isPlayer ? difficulty.initialCash : 1));
      const entryFee = calculateEntryFee(tier);
      const cash = grossCash - entryFee;
      const debtRate = financeGrade === "A" ? 0 : financeGrade === "B" ? rng.next() * 0.05 : financeGrade === "C" ? rng.next() * 0.15 : 0.10 + rng.next() * 0.20;
      const debt = Math.round(config.requiredBudget * debtRate);
      const facilityBase = distribution.facilityLevelByFinance[financeGrade];
      const facilityLevel = clamp(facilityBase, 1, 10);
      const rep = Math.round(distribution.reputationRange[0] + rng.next() * (distribution.reputationRange[1] - distribution.reputationRange[0]));
      const teamName = playerNew ? validated.newTeam!.name : source.name;
      const baseCountry = playerNew ? (pool.countries.find((country) => country.countryCode === validated.newTeam!.countryCode)?.countryName ?? validated.newTeam!.countryCode) : source.country;
      const origin = playerNew ? "generated" : "pool";
      if (isPlayer) playerTeamId = teamId;
      const character = playerNew ? "Player-founded team" : source.character;
      await database.run(
        `INSERT INTO teams
          (team_id, career_id, division_id, pool_team_id, name, is_player_team, base_country, is_active, origin,
           founded_season, strength_grade, finance_grade, performance_grade, personality, reputation, cash, debt, budget,
           aero_center_level, engine_dept_level, chassis_level, simulator_level, rnd_level, academy_level, reliability)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [teamId, careerId, "T" + tier, source.pool_team_id, teamName, isPlayer ? 1 : 0, baseCountry, origin,
          strengthGrade, financeGrade, performanceGrade, source.personality, rep, cash, debt, config.requiredBudget,
          facilityLevel, facilityLevel, facilityLevel, facilityLevel, facilityLevel, facilityLevel,
          clamp(distribution.reliabilityMean + PERFORMANCE_GRADE_OFFSETS[performanceGrade].reliability, 0, 100)],
      );
      await database.run(
        "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, 1, NULL, 'opening', 'starting-cash', ?, ?);",
        [stableId(seed, "opening-balance", source.pool_team_id), teamId, grossCash, grossCash],
      );
      await database.run(
        "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, 1, NULL, 'expense', 'division-entry-fee', ?, ?);",
        [stableId(seed, "entry-fee", source.pool_team_id), teamId, -entryFee, cash],
      );
      const carBase = distribution.carReference + PERFORMANCE_GRADE_OFFSETS[performanceGrade].car;
      await database.run(
        `INSERT INTO cars (car_id, team_id, season, engine_power, aero, high_speed, medium_speed, low_speed,
          mechanical_grip, traction, braking, tyre_management, engine_reliability, gearbox_reliability,
          brake_reliability, suspension_reliability, electronics_reliability, development_points)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);`,
        [stableId(seed, "car", source.pool_team_id), teamId, ...Array.from({ length: 9 }, () => clamp(carBase + sampleDelta(rng, 2), 1, 100)),
          ...Array.from({ length: 5 }, () => clamp(distribution.reliabilityMean + PERFORMANCE_GRADE_OFFSETS[performanceGrade].reliability + sampleDelta(rng, 3), 1, 100))],
      );
      const driverIds: string[] = [];
      for (let seat = 0; seat < 2; seat += 1) {
        const id = await insertDriver(database, {
          seed, index: "team-" + source.pool_team_id + "-seat-" + seat, careerId, teamId, tier,
          pool, rng, baseCountry: source.country, existingNames,
        });
        driverIds.push(id); driversCreated += 1;
      }
      for (let academyIndex = 0; academyIndex < distribution.academySlots; academyIndex += 1) {
        const academyDriverId = await insertDriver(database, {
          seed, index: "team-" + source.pool_team_id + "-academy-" + academyIndex, careerId, teamId, tier,
          pool, rng, baseCountry: source.country, existingNames, academy: true,
        });
        driversCreated += 1;
        await database.run("UPDATE drivers SET is_academy_driver = 1 WHERE driver_id = ?;", [academyDriverId]);
      }
      const staffRoles = STAFF_ROLES[tier];
      const staffSlots = distribution.staffSlots;
      for (let staffIndex = 0; staffIndex < staffSlots; staffIndex += 1) {
        const role = staffRoles[staffIndex] ?? staffRoles[staffRoles.length - 1]!;
        const generated = generateName(pool, rng, {
          role: "staff", tier, baseCountryCode: pickCountry(pool, source.country, rng).countryCode,
          existingFullNames: existingNames,
        });
        existingNames.add(normalizeFullName(generated.fullName));
        const age = Math.round(28 + rng.next() * 42);
        const skill = clamp(distribution.staffSkillMean + PERFORMANCE_GRADE_OFFSETS[performanceGrade].technicalStaff + sampleDelta(rng, 8), 1, 100);
        const salary = tier === 6 ? 0 : Math.round(config.requiredBudget * 0.15 / staffSlots);
        const staffId = stableId(seed, "staff", source.pool_team_id + "-" + staffIndex);
        await database.run(
          "INSERT INTO staff (staff_id, career_id, team_id, role, name, nationality, name_culture, gender, age, skill, specialization, reputation, salary, potential, contract_end, is_free_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0);",
          [staffId, careerId, teamId, role, generated.fullName, generated.countryCode, generated.cultureId, generated.gender, age,
            skill, role, Math.min(9999, Math.round(skill * 100)), salary, clamp(skill + 5 + rng.next() * 15, 0, 100)],
        );
        staffCreated += 1;
      }
      if (isPlayer) {
        for (const driverId of driverIds) {
          await database.run("UPDATE drivers SET is_academy_driver = 0 WHERE driver_id = ?;", [driverId]);
        }
      }
      teamIndex += 1;
    }

    const playerTeamSource = poolRows.find((row) => row.pool_team_id === playerPoolId)!;
    const managerCountry = validated.managerCountryCode;
    const country = pool.countries.find((item) => item.countryCode === managerCountry)!;
    const playerManagerId = stableId(seed, "manager", "player");
    const playerManagerGender = options.managerGender ?? (rng.next() < 0.15 ? "female" : "male");
    const managerCulture = chooseCulture(pool, country, rng);
    await database.run(
      "INSERT INTO career_managers (manager_id, career_id, team_id, name, nationality, name_culture, gender, age, reputation, is_player, status) VALUES (?, ?, ?, ?, ?, ?, ?, 30, ?, 1, 'active');",
      [playerManagerId, careerId, playerTeamId, validated.managerName, managerCountry, managerCulture, playerManagerGender, INITIAL_DISTRIBUTIONS[validated.selectedTier].reputationRange[0]],
    );
    managersCreated += 1;

    for (let managerIndex = 0; managerIndex < 6; managerIndex += 1) {
      const generated = generateName(pool, rng, { role: "manager", existingFullNames: existingNames });
      existingNames.add(normalizeFullName(generated.fullName));
      await database.run(
        "INSERT INTO career_managers (manager_id, career_id, team_id, name, nationality, name_culture, gender, age, reputation, is_player, status) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 'free_agent');",
        [stableId(seed, "manager", managerIndex), careerId, generated.fullName, generated.countryCode, generated.cultureId,
          generated.gender, Math.round(30 + rng.next() * 40), Math.round(100 + rng.next() * 4000)],
      );
      managersCreated += 1;
    }

    for (let index = 0; index < 30; index += 1) {
      const tier = ([1, 2, 3, 4, 5, 6] as TierId[])[index % 6]!;
      const driverId = await insertDriver(database, {
        seed, index: "free-agent-" + index, careerId, teamId: null, tier, pool, rng,
        baseCountry: pickCountry(pool, "", rng).countryName, existingNames, freeAgent: true,
      });
      driversCreated += 1;
    }

    for (let index = 0; index < 20; index += 1) {
      const tier = ([1, 2, 3, 4, 5, 6] as TierId[])[index % 6]!;
      const generated = generateName(pool, rng, { role: "staff", tier, existingFullNames: existingNames });
      existingNames.add(normalizeFullName(generated.fullName));
      const staffId = stableId(seed, "free-staff", index);
      const skill = clamp(INITIAL_DISTRIBUTIONS[tier].staffSkillMean + sampleDelta(rng, 8), 1, 100);
      await database.run(
        "INSERT INTO staff (staff_id, career_id, team_id, role, name, nationality, name_culture, gender, age, skill, specialization, reputation, salary, potential, contract_end, is_free_agent) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, 1);",
        [staffId, careerId, ["Race Engineer", "Mechanical Engineer", "Performance Coach", "Scout", "Strategist"][index % 5],
          generated.fullName, generated.countryCode, generated.cultureId, generated.gender, Math.round(28 + rng.next() * 42),
          skill, "General", Math.round(skill * 100), clamp(skill + rng.next() * 20, 0, 100)],
      );
      staffCreated += 1;
    }

    for (const tier of [1, 2, 3, 4, 5, 6] as TierId[]) {
      const schedule = generateSeasonCalendar({
        worldSeed: seed, season: 1, tier,
        circuits: circuits.map((circuit) => ({
          id: circuit.circuit_id, name: circuit.name, lengthKm: Number(circuit.length),
          estimatedLapSeconds: Number(circuit.estimated_lap_seconds), rainProbability: Number(circuit.rain_probability),
          safetyCarProbability: Number(circuit.safety_car_probability),
        })),
      });
      for (const race of schedule) {
        await database.run(
          "INSERT INTO races (race_id, division_id, season, round, circuit_id, laps, weather, track_condition, has_sprint, status) VALUES (?, ?, 1, ?, ?, ?, 'dynamic', 'dry', ?, 'scheduled');",
          [stableId(seed, "race", tier + "-" + race.round), "T" + tier, race.round, race.circuitId, race.totalLaps, race.hasSprint ? 1 : 0],
        );
        racesScheduled += 1;
      }
    }

    const playerTeam = await database.query("SELECT reputation FROM teams WHERE team_id = ?;", [playerTeamId]);
    const playerReputation = Number(playerTeam[0]?.reputation ?? 0);
    const tier = validated.selectedTier;
    const eligibleSponsorTiers = tier === 6 ? [] : tier === 5 ? [5, 4] : tier === 4 ? [5, 4, 3] : tier === 3 ? [4, 3, 2] : [3, 2, 1];
    const eligibleSponsors = sponsors.filter((sponsor) => eligibleSponsorTiers.includes(sponsor.tier) && sponsor.min_team_reputation <= playerReputation);
    const sponsorCount = tier === 6 ? 0 : Math.max(1, Math.round(3 * difficulty.sponsorOffers));
    const selectedSponsorIds = new Set<string>();
    for (let index = 0; index < sponsorCount; index += 1) {
      const weightedTier = selectSponsorTier(rng, tier);
      const preferred = eligibleSponsors.filter((sponsor) => sponsor.tier === weightedTier && !selectedSponsorIds.has(sponsor.sponsor_id));
      const candidates = preferred.length ? preferred : eligibleSponsors.filter((sponsor) => !selectedSponsorIds.has(sponsor.sponsor_id));
      if (!candidates.length) break;
      const sponsor = pick(candidates, rng);
      selectedSponsorIds.add(sponsor.sponsor_id);
      await database.run(
        "INSERT INTO sponsor_offers (offer_id, career_id, team_id, sponsor_id, contract_value, duration_seasons, focus, status, created_season) VALUES (?, ?, ?, ?, ?, ?, ?, 'offered', 1);",
        [stableId(seed, "sponsor-offer", sponsor.sponsor_id), careerId, playerTeamId, sponsor.sponsor_id, sponsor.base_value, sponsor.duration_seasons, sponsor.focus],
      );
      sponsorOffersCreated += 1;
    }

    const counts = await Promise.all([
      database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ?;", [careerId]),
      database.query("SELECT COUNT(*) AS count FROM drivers WHERE career_id = ?;", [careerId]),
      database.query("SELECT COUNT(*) AS count FROM races WHERE season = 1;"),
      database.query("SELECT COUNT(*) AS count FROM cars WHERE team_id IN (SELECT team_id FROM teams WHERE career_id = ?);", [careerId]),
    ]);
    if (Number(counts[0]?.[0]?.count ?? 0) !== 72 || Number(counts[1]?.[0]?.count ?? 0) !== 270 ||
        Number(counts[2]?.[0]?.count ?? 0) !== racesScheduled || Number(counts[3]?.[0]?.count ?? 0) !== 72) {
      throw new Error("Validasi world generation gagal; seluruh transaksi career dibatalkan.");
    }
    const playerCount = await database.query("SELECT COUNT(*) AS count FROM teams WHERE career_id = ? AND is_player_team = 1;", [careerId]);
    if (Number(playerCount[0]?.count ?? 0) !== 1) throw new Error("Career harus memiliki tepat satu tim pemain.");
  });

  return {
    careerId, playerTeamId, selectedTier: validated.selectedTier,
    teamsCreated: 72, driversCreated, staffCreated, managersCreated, racesScheduled, sponsorOffersCreated,
  };
}
