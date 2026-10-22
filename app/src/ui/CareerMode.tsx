import { useCallback, useEffect, useMemo, useState } from "react";
import { type RaceResult } from "../core/RaceEngine";
import { calculateMainRacePoints, calculateSprintRacePoints, simulateRaceWeekend, type RaceWeekendResult } from "../core/RaceWeekendEngine";
import { TIER_CONFIG, type TierId } from "../core/GameConfig";
import { calculateAverageDriverPayroll, calculateAverageStaffPayroll, calculateBalanceAfterTransaction, calculateOperatingCostPerRound } from "../core/EconomyEngine";
import { settleCareerSeason } from "../core/SeasonSettlementEngine";
import DriverMarketPanel from "./DriverMarketPanel";
import { cancelCareerDevelopmentProject, startCareerDevelopmentProject, advanceCareerDevelopmentProjectsAfterRace } from "../core/CareerDevelopmentService";
import { DEVELOPMENT_CATALOG, getDevelopmentProjectName, validateDevelopmentSelection } from "../core/DevelopmentCatalog";
import { calculateDevelopmentProjectCost, calculateFacilityUpgradeCost, type DevelopmentProjectSize } from "../core/EconomyEngine";
import { FACILITY_CATALOG, upgradeTeamFacility, type FacilityId } from "../core/FacilityUpgradeService";
import { calculateEffectiveDevelopmentDuration } from "../core/DevelopmentEngine";
import { hashSeed } from "../core/RandomDistributions";
import { normalizeFullName } from "../seed/NameGenerator";
import type { NamePoolPayload } from "../seed/NamePoolLoader";
import { decodeCompressedJson, NAME_POOL_PUBLIC_PARTS, validateNamePool } from "../seed/NamePoolLoader";
import { validateTeamPoolSeed, type TeamPoolSeedPayload } from "../seed/TeamSeedLoader";
import { validateCareerSetupDraft, type CareerSetupDraft, type CareerTeamCandidate } from "../core/CareerSetupEngine";
import { generateCareerWorld, type CareerGenerationResult } from "../seed/CareerWorldGenerator";
import { openCareerDatabase } from "../storage/DatabaseFactory";
import type { IDatabase } from "../storage/IDatabase";
import RaceWorkbench from "./RaceWorkbench";
import "./career-mode.css";

type CatalogTeam = {
  id: string; name: string; code: string; country: string; tier: TierId;
  strength: "Kuat" | "Menengah" | "Lemah"; financeGrade: string; performanceGrade: string; personality: string; character: string;
};
type Catalog = { teams: CatalogTeam[]; countries: NamePoolPayload["countries"]; blockedNames: Set<string> };
type SaveSlot = { dbName: string; careerId: string; managerName: string; teamName: string; tier: TierId; savedAt: string };
type Row = Readonly<Record<string, unknown>>;
type DashboardData = {
  career: Row; team: Row; teams: Row[]; roster: Row[]; marketDrivers: Row[]; races: Row[]; sponsors: Row[]; staff: Row[]; finance: Row[]; standings: Row[]; settlements: Row[]; car: Row | null; developmentProjects: Row[]; developmentHistory: Row[];
};
type Tab = "overview" | "calendar" | "roster" | "market" | "staff" | "development" | "sponsors" | "finance" | "standings";

const SAVE_INDEX_KEY = "paddock-life-save-slots-v1";
const TIER_PICKER = [5, 4, 3, 2, 1] as const;

function readSaveSlots(): SaveSlot[] {
  try {
    const value = localStorage.getItem(SAVE_INDEX_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SaveSlot =>
      typeof item === "object" && item !== null &&
      typeof item.dbName === "string" && typeof item.careerId === "string" &&
      typeof item.managerName === "string" && typeof item.teamName === "string" &&
      Number.isInteger(item.tier) && typeof item.savedAt === "string");
  } catch { return []; }
}
function writeSaveSlots(slots: SaveSlot[]): void {
  try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(slots)); } catch { /* SQLite remains authoritative; index is only for finding saves. */ }
}
function field(row: Row | undefined, key: string, fallback = ""): string {
  const value = row?.[key];
  return value === null || value === undefined ? fallback : String(value);
}
function numberField(row: Row | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function formatCash(value: number): string {
  return "¢p " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}
function tierFromValue(value: string | number): TierId {
  const tier = Number(value);
  return ([1, 2, 3, 4, 5, 6] as number[]).includes(tier) ? tier as TierId : 3;
}
function makeCatalogTeam(row: readonly unknown[]): CatalogTeam {
  const id = String(row[0]);
  return {
    id, name: String(row[1]), code: String(row[2]), country: String(row[3]),
    tier: Number(id[1]) as TierId, strength: row[4] as CatalogTeam["strength"],
    financeGrade: String(row[5]), performanceGrade: String(row[6]), personality: String(row[7]), character: String(row[8]),
  };
}
async function loadCatalog(): Promise<Catalog> {
  const [teamsResponse, ...nameResponses] = await Promise.all([
    fetch("/seed/teams.json"),
    ...NAME_POOL_PUBLIC_PARTS.map((part) => fetch("/seed/" + part)),
  ]);
  if (!teamsResponse.ok) throw new Error("Data tim tidak bisa dimuat.");
  if (nameResponses.some((response) => !response.ok)) throw new Error("Pool nama tidak bisa dimuat.");
  const teamPayload: unknown = await teamsResponse.json();
  validateTeamPoolSeed(teamPayload);
  const encodedParts = await Promise.all(nameResponses.map((response) => response.text()));
  const namesPayload: unknown = await decodeCompressedJson(encodedParts);
  validateNamePool(namesPayload);
  const typedNames = namesPayload as NamePoolPayload;
  return {
    teams: (teamPayload as TeamPoolSeedPayload).rows.map(makeCatalogTeam),
    countries: typedNames.countries,
    blockedNames: new Set(typedNames.blockedFullNames.map(normalizeFullName)),
  };
}
async function loadDashboard(database: IDatabase, careerId: string, playerTeamId: string, tier: TierId): Promise<DashboardData> {
  const careerRows = await database.query("SELECT * FROM career WHERE career_id = ?;", [careerId]);
  const currentSeason = numberField(careerRows[0], "current_season", 1);
  const [teamRows, teams, roster, marketDrivers, races, sponsors, staff, finance, standings, settlements, cars, developmentProjects, developmentHistory] = await Promise.all([
    database.query("SELECT * FROM teams WHERE team_id = ? AND career_id = ?;", [playerTeamId, careerId]),
    database.query("SELECT team_id, name, division_id, strength_grade, finance_grade, performance_grade, reputation, cash, budget, is_player_team FROM teams WHERE career_id = ? AND division_id = ? ORDER BY reputation DESC;", [careerId, "T" + tier]),
    database.query("SELECT d.driver_id, d.name, d.age, d.nationality, d.pace, d.qualifying, d.racecraft, d.consistency, d.wet_skill, d.tyre_management, d.fan_popularity, d.potential, dc.salary, dc.end_season FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id JOIN teams t ON t.team_id = dc.team_id WHERE t.career_id = ? AND t.team_id = ? AND d.is_academy_driver = 0 AND dc.start_season <= ? AND dc.end_season >= ? ORDER BY d.pace DESC;", [careerId, playerTeamId, currentSeason, currentSeason]),
    database.query("SELECT d.driver_id, d.name, d.age, d.nationality, d.pace, d.qualifying, d.racecraft, d.market_value, d.ambition, d.loyalty, d.reputation FROM drivers d WHERE d.career_id = ? AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.age BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM driver_contracts dc WHERE dc.driver_id = d.driver_id AND dc.start_season <= ? AND dc.end_season >= ?) ORDER BY d.market_value DESC, d.driver_id LIMIT 60;", [careerId, Math.max(0, TIER_CONFIG[tier].driverAge.min - 1), TIER_CONFIG[tier].driverAge.max - 1, currentSeason + 1, currentSeason + 1]),
    database.query("SELECT r.race_id, r.round, r.laps, r.has_sprint, r.status, r.track_condition, c.name AS circuit_name, c.country AS circuit_country FROM races r JOIN circuits c ON c.circuit_id = r.circuit_id WHERE r.division_id = ? AND r.season = ? ORDER BY r.round;", ["T" + tier, currentSeason]),
    database.query("SELECT o.offer_id, s.name, s.category, s.tier, o.contract_value, o.duration_seasons, o.focus, o.status FROM sponsor_offers o JOIN sponsor_pool s ON s.sponsor_id = o.sponsor_id WHERE o.career_id = ? AND o.team_id = ? ORDER BY s.tier, s.name;", [careerId, playerTeamId]),
    database.query("SELECT staff_id, role, name, age, skill, salary, is_free_agent FROM staff WHERE career_id = ? AND team_id = ? ORDER BY role;", [careerId, playerTeamId]),
    database.query("SELECT type, category, amount, balance_after, season, race, occurred_at FROM finances WHERE team_id = ? ORDER BY occurred_at DESC LIMIT 30;", [playerTeamId]),
    database.query("SELECT st.points, st.wins, st.podiums, d.name AS driver_name, t.name AS team_name, st.driver_id, st.team_id FROM standings st LEFT JOIN drivers d ON d.driver_id = st.driver_id LEFT JOIN teams t ON t.team_id = st.team_id WHERE st.season = ? AND st.division_id = ? ORDER BY st.points DESC, st.wins DESC;", [currentSeason, "T" + tier]),
    database.query("SELECT settlement_id, prize_money, commercial_revenue, sponsor_revenue, interest_cost, facility_maintenance, net_amount, closing_cash FROM season_settlements WHERE career_id = ? AND team_id = ? AND season = ?;", [careerId, playerTeamId, currentSeason]),
    database.query("SELECT * FROM cars WHERE team_id = ? AND season = ? LIMIT 1;", [playerTeamId, currentSeason]),
    database.query("SELECT * FROM development_projects WHERE career_id = ? AND team_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, start_round DESC;", [careerId, playerTeamId]),
    database.query("SELECT * FROM development_history WHERE career_id = ? AND team_id = ? ORDER BY season DESC, round DESC LIMIT 30;", [careerId, playerTeamId]),
  ]);
  if (!careerRows[0] || !teamRows[0]) throw new Error("Save tidak memiliki data career atau tim pemain.");
  return { career: careerRows[0], team: teamRows[0], teams, roster, marketDrivers, races, sponsors, staff, finance, standings, settlements, car: cars[0] ?? null, developmentProjects, developmentHistory };
}

async function upsertDriverStanding(
  database: IDatabase, tier: TierId, season: number, raceId: string, driverId: string,
  points: number, wins = 0, podiums = 0, fastestLaps = 0,
): Promise<void> {
  const prior = await database.query(
    "SELECT standing_id FROM standings WHERE season = ? AND division_id = ? AND driver_id = ? AND team_id IS NULL;",
    [season, "T" + tier, driverId],
  );
  if (prior[0]) {
    await database.run(
      "UPDATE standings SET points = points + ?, wins = wins + ?, podiums = podiums + ?, fastest_laps = fastest_laps + ? WHERE standing_id = ?;",
      [points, wins, podiums, fastestLaps, String(prior[0].standing_id)],
    );
  } else {
    await database.run(
      "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, 0);",
      [raceId + "_drv_" + driverId, season, "T" + tier, driverId, points, wins, podiums, fastestLaps],
    );
  }
}

async function upsertTeamStanding(
  database: IDatabase, tier: TierId, season: number, raceId: string, teamId: string,
  points: number, wins = 0, podiums = 0,
): Promise<void> {
  const prior = await database.query(
    "SELECT standing_id FROM standings WHERE season = ? AND division_id = ? AND team_id = ? AND driver_id IS NULL;",
    [season, "T" + tier, teamId],
  );
  if (prior[0]) {
    await database.run(
      "UPDATE standings SET points = points + ?, wins = wins + ?, podiums = podiums + ? WHERE standing_id = ?;",
      [points, wins, podiums, String(prior[0].standing_id)],
    );
  } else {
    await database.run(
      "INSERT INTO standings (standing_id, season, division_id, driver_id, team_id, points, wins, podiums, poles, fastest_laps, dnfs) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0, 0, 0);",
      [raceId + "_team_" + teamId, season, "T" + tier, teamId, points, wins, podiums],
    );
  }
}

async function simulateNextRace(database: IDatabase, careerId: string, tier: TierId, seed: string): Promise<RaceWeekendResult> {
  const careerStateRows = await database.query("SELECT current_season, current_division_tier FROM career WHERE career_id = ?;", [careerId]);
  const careerState = careerStateRows[0];
  if (!careerState) throw new Error("Career tidak ditemukan.");
  const season = numberField(careerState, "current_season", 1);
  const playerTier = numberField(careerState, "current_division_tier", tier);
  const raceRows = await database.query(
    "SELECT r.race_id, r.round, r.laps, r.circuit_id, r.track_condition, r.has_sprint, c.estimated_lap_seconds, c.abrasion FROM races r JOIN circuits c ON c.circuit_id = r.circuit_id WHERE r.division_id = ? AND r.season = ? AND r.status = 'scheduled' ORDER BY r.round LIMIT 1;",
    ["T" + tier, season],
  );
  const race = raceRows[0];
  if (!race) throw new Error("Semua race di season ini sudah selesai. Transisi ke season berikutnya belum tersedia di build ini.");
  const raceDrivers = await database.query(
    `SELECT d.driver_id, d.name, d.pace, d.qualifying, d.racecraft, d.consistency, d.wet_skill, d.tyre_management, d.aggression,
      t.team_id, c.engine_power, c.aero, c.high_speed, c.medium_speed, c.low_speed, c.mechanical_grip, c.traction, c.braking, c.tyre_management AS car_tyre_management
     FROM drivers d
     JOIN driver_contracts dc ON dc.driver_id = d.driver_id AND dc.start_season <= ? AND dc.end_season >= ?
     JOIN teams t ON t.team_id = dc.team_id AND t.career_id = ? AND t.division_id = ? AND t.is_active = 1 AND d.is_academy_driver = 0
     JOIN cars c ON c.team_id = t.team_id AND c.season = ?
     ORDER BY t.team_id, d.driver_id;`,
    [season, season, careerId, "T" + tier, season],
  );
  if (raceDrivers.length !== TIER_CONFIG[tier].gridSize) {
    throw new Error("Grid race harus berisi " + TIER_CONFIG[tier].gridSize + " driver, tetapi ditemukan " + raceDrivers.length + ".");
  }
  const compound = TIER_CONFIG[tier].allowedDryCompounds[0]!;
  const driverInputs = raceDrivers.map((driver) => ({
    id: String(driver.driver_id), name: String(driver.name),
    carScore: ["engine_power", "aero", "high_speed", "medium_speed", "low_speed", "mechanical_grip", "traction", "braking", "car_tyre_management"].reduce((sum, key) => sum + numberField(driver, key), 0) / 9,
    driverScore: (numberField(driver, "pace") + numberField(driver, "qualifying") + numberField(driver, "racecraft") + numberField(driver, "consistency")) / 4,
    qualifyingScore: numberField(driver, "qualifying"),
    setupScore: 50, formModifier: 0, aggression: numberField(driver, "aggression"),
    tyreManagement: numberField(driver, "tyre_management"), mechanicalGrip: numberField(driver, "mechanical_grip"),
    compound, weatherAdaptation: numberField(driver, "wet_skill"),
  }));
  const weekend = simulateRaceWeekend({
    worldSeed: seed, season: 1, round: Number(race.round), tier,
    estimatedCircuitLapSeconds: Number(race.estimated_lap_seconds), totalLaps: Number(race.laps),
    trackAbrasion: Number(race.abrasion), trackTemperatureCelsius: 25,
    trackCondition: "dry", referenceSetupScore: 50,
    hasSprint: Number(race.has_sprint) === 1,
    drivers: driverInputs,
  });
  const teamByDriver = new Map(raceDrivers.map((driver) => [String(driver.driver_id), String(driver.team_id)]));
  const gridByDriver = new Map(weekend.qualifying.classification.map((row) => [row.driverId, row.gridPosition]));
  const raceLaps = weekend.race.laps.flat();
  const fastestRaceTime = Math.min(...raceLaps.map((lap) => lap.lapTimeSeconds));
  const fastestRaceDrivers = new Set(raceLaps.filter((lap) => lap.lapTimeSeconds === fastestRaceTime).map((lap) => lap.driverId));
  const sprintLaps = weekend.sprint?.laps.flat() ?? [];
  const fastestSprintTime = sprintLaps.length ? Math.min(...sprintLaps.map((lap) => lap.lapTimeSeconds)) : Infinity;
  const fastestSprintDrivers = new Set(sprintLaps.filter((lap) => lap.lapTimeSeconds === fastestSprintTime).map((lap) => lap.driverId));
  const orderedRace = [...weekend.race.classification].sort((a, b) => a.position - b.position);
  const orderedSprint = [...(weekend.sprint?.classification ?? [])].sort((a, b) => a.position - b.position);

  await database.transaction(async () => {
    if (weekend.sprint) {
      for (const row of orderedSprint) {
        const teamId = teamByDriver.get(row.driverId);
        if (!teamId) throw new Error("Tim driver sprint tidak ditemukan.");
        const points = calculateSprintRacePoints(row.position);
        await database.run(
          "INSERT INTO race_results (race_id, session_type, driver_id, team_id, grid_position, finish_position, laps_completed, fastest_lap, pit_stops, tyre_strategy, points, dnf, race_time) VALUES (?, 'sprint', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?);",
          [String(race.race_id), row.driverId, teamId, gridByDriver.get(row.driverId) ?? null, row.position,
            weekend.sprint.totalLaps, fastestSprintDrivers.has(row.driverId) ? 1 : 0, compound, points, row.cumulativeTimeSeconds],
        );
        await upsertDriverStanding(database, tier, season, String(race.race_id) + "_sprint", row.driverId, points);
      }
      const sprintTeamPoints = new Map<string, number>();
      for (const row of orderedSprint) {
        const teamId = teamByDriver.get(row.driverId)!;
        sprintTeamPoints.set(teamId, (sprintTeamPoints.get(teamId) ?? 0) + calculateSprintRacePoints(row.position));
      }
      for (const [teamId, points] of sprintTeamPoints) {
        await upsertTeamStanding(database, tier, season, String(race.race_id) + "_sprint", teamId, points);
      }
    }

    for (const row of orderedRace) {
      const teamId = teamByDriver.get(row.driverId);
      if (!teamId) throw new Error("Tim driver race tidak ditemukan.");
      const fastestLap = fastestRaceDrivers.has(row.driverId) ? 1 : 0;
      const points = calculateMainRacePoints(tier, row.position, fastestLap === 1);
      await database.run(
        "INSERT INTO race_results (race_id, session_type, driver_id, team_id, grid_position, finish_position, laps_completed, fastest_lap, pit_stops, tyre_strategy, points, dnf, race_time) VALUES (?, 'race', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?);",
        [String(race.race_id), row.driverId, teamId, gridByDriver.get(row.driverId) ?? null, row.position,
          weekend.race.totalLaps, fastestLap, compound, points, row.cumulativeTimeSeconds],
      );
      await upsertDriverStanding(database, tier, season, String(race.race_id), row.driverId, points,
        row.position === 1 ? 1 : 0, row.position <= 3 ? 1 : 0, fastestLap);
    }
    const teamPoints = new Map<string, { points: number; wins: number; podiums: number }>();
    for (const row of orderedRace) {
      const teamId = teamByDriver.get(row.driverId)!;
      const current = teamPoints.get(teamId) ?? { points: 0, wins: 0, podiums: 0 };
      current.points += calculateMainRacePoints(tier, row.position, fastestRaceDrivers.has(row.driverId));
      if (row.position === 1) current.wins += 1;
      if (row.position <= 3) current.podiums += 1;
      teamPoints.set(teamId, current);
    }
    for (const [teamId, summary] of teamPoints) {
      await upsertTeamStanding(database, tier, season, String(race.race_id), teamId, summary.points, summary.wins, summary.podiums);
    }

    const teamRows = await database.query(
      "SELECT team_id, cash FROM teams WHERE career_id = ? AND division_id = ? AND is_active = 1 ORDER BY team_id;",
      [careerId, "T" + tier],
    );
    const rounds = TIER_CONFIG[tier].roundsPerSeason;
    const raceCosts = [
      { category: "operating-cost", amount: -calculateOperatingCostPerRound(tier) },
      { category: "driver-payroll", amount: tier === 6 ? 0 : -Math.round(calculateAverageDriverPayroll(tier) / rounds) },
      { category: "staff-payroll", amount: tier === 6 ? 0 : -Math.round(calculateAverageStaffPayroll(tier) / rounds) },
    ];
    for (const teamRow of teamRows) {
      let balance = Number(teamRow.cash);
      for (const cost of raceCosts) {
        if (cost.amount === 0) continue;
        const next = calculateBalanceAfterTransaction({ currentBalance: balance, amount: cost.amount, tier });
        if (!next.withinOverdraft) {
          throw new Error("Race dibatalkan: tim " + String(teamRow.team_id) + " akan melewati batas overdraft setelah " + cost.category + ".");
        }
        balance = next.balanceAfter;
        const transactionId = String(race.race_id) + "_" + cost.category + "_" + String(teamRow.team_id);
        await database.run("UPDATE teams SET cash = ? WHERE team_id = ?;", [balance, String(teamRow.team_id)]);
        await database.run(
          "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, ?, ?, 'expense', ?, ?, ?);",
          [transactionId, String(teamRow.team_id), season, Number(race.round), cost.category, cost.amount, balance],
        );
      }
    }
    if (tier === playerTier) await advanceCareerDevelopmentProjectsAfterRace(database, {
      careerId, tier, season, round: Number(race.round),
    });
    await database.run("UPDATE races SET status = 'completed' WHERE race_id = ? AND status = 'scheduled';", [String(race.race_id)]);
    if (tier === playerTier) await database.run("UPDATE career SET current_race = ?, updated_at = CURRENT_TIMESTAMP WHERE career_id = ?;", [Number(race.round) + 1, careerId]);
  });
  return weekend;
}

export default function CareerMode() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [managerName, setManagerName] = useState("");
  const [managerCountryCode, setManagerCountryCode] = useState("IDN");
  const [managerGender, setManagerGender] = useState<"male" | "female">("male");
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [path, setPath] = useState<"new-team" | "takeover">("new-team");
  const [tier, setTier] = useState<TierId>(3);
  const [teamId, setTeamId] = useState("D3-01");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamCode, setNewTeamCode] = useState("PAX");
  const [newTeamCountryCode, setNewTeamCountryCode] = useState("IDN");
  const [worldSeed, setWorldSeed] = useState(() => "paddock-" + (globalThis.crypto?.randomUUID?.().slice(0, 8) ?? "career-001"));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [database, setDatabase] = useState<IDatabase | null>(null);
  const [activeSave, setActiveSave] = useState<SaveSlot | null>(null);
  const [saveSlots, setSaveSlots] = useState<SaveSlot[]>([]);
  const [generation, setGeneration] = useState<CareerGenerationResult | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [runningRace, setRunningRace] = useState(false);
  const [settlingSeason, setSettlingSeason] = useState(false);
  const [settlementError, setSettlementError] = useState("");
  const [developmentProjectId, setDevelopmentProjectId] = useState("E01");
  const [developmentSize, setDevelopmentSize] = useState<DevelopmentProjectSize>("minor");
  const [developmentBusy, setDevelopmentBusy] = useState(false);
  const [developmentError, setDevelopmentError] = useState("");
  const [facilityBusy, setFacilityBusy] = useState(false);
  const [facilityError, setFacilityError] = useState("");
  const [raceError, setRaceError] = useState("");
  const [lastRace, setLastRace] = useState<RaceWeekendResult | null>(null);
  const [showQa, setShowQa] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCatalog().then((loaded) => {
      if (!cancelled) {
        setCatalog(loaded);
        if (loaded.countries.some((country) => country.countryCode === "IDN")) {
          setManagerCountryCode("IDN"); setNewTeamCountryCode("IDN");
        } else if (loaded.countries[0]) {
          setManagerCountryCode(loaded.countries[0].countryCode); setNewTeamCountryCode(loaded.countries[0].countryCode);
        }
        const freeCode = ["PAX", "PLX", "VRE", "NXT", "PAD"].find((code) => !loaded.teams.some((team) => team.code === code));
        if (freeCode) setNewTeamCode(freeCode);
        setTeamId(loaded.teams.find((team) => team.tier === 3 && team.strength !== "Kuat")?.id ?? loaded.teams[0]?.id ?? "");
      }
    }).catch((caught) => {
      if (!cancelled) setCatalogError(caught instanceof Error ? caught.message : "Katalog gagal dimuat.");
    }).finally(() => { if (!cancelled) setLoadingCatalog(false); });
    setSaveSlots(readSaveSlots());
    return () => { cancelled = true; };
  }, []);

  const selectableTeams = useMemo(() => (catalog?.teams ?? []).filter((team) =>
    path === "takeover" ? team.tier === tier && tier <= 5 : team.tier === tier && team.strength !== "Kuat"), [catalog, path, tier]);
  useEffect(() => {
    if (selectableTeams.length && !selectableTeams.some((team) => team.id === teamId)) setTeamId(selectableTeams[0]!.id);
  }, [selectableTeams, teamId]);

  const refreshDashboard = useCallback(async (db: IDatabase, slot: SaveSlot) => {
    const data = await loadDashboard(db, slot.careerId, (await db.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1;", [slot.careerId]))[0]?.team_id as string, slot.tier);
    setDashboard(data);
  }, []);

  async function createCareer() {
    if (!catalog) return;
    setError("");
    try {
      const candidate = catalog.teams.find((team) => team.id === teamId);
      if (!candidate) throw new Error("Pilih tim yang valid.");
      const draft: CareerSetupDraft = {
        managerName, managerCountryCode, difficulty, path, worldSeed,
        ...(path === "new-team" ? { newTeam: { name: newTeamName, code: newTeamCode, countryCode: newTeamCountryCode, tier, replacedTeamId: teamId } } : { takeoverTeamId: teamId }),
      };
      const teamPool: CareerTeamCandidate[] = catalog.teams.map((team) => ({ teamId: team.id, tier: team.tier, name: team.name, strength: team.strength }));
      validateCareerSetupDraft(draft, {
        availableCountryCodes: new Set(catalog.countries.map((country) => country.countryCode)),
        blockedManagerNames: catalog.blockedNames,
        blockedTeamNames: new Set(),
        existingTeamNames: new Set(catalog.teams.map((team) => team.name)),
        existingTeamCodes: new Set(catalog.teams.map((team) => team.code)),
        teamPool,
      });
      setCreating(true);
      const dbName = "save_" + (globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? String(Date.now()));
      const db = await openCareerDatabase(dbName);
      try {
        const result = await generateCareerWorld(db, draft, { managerGender });
        const playerTeam = (await db.query("SELECT team_id, name FROM teams WHERE career_id = ? AND is_player_team = 1;", [result.careerId]))[0];
        if (!playerTeam) throw new Error("Tim pemain tidak ditemukan setelah world generation.");
        const slot: SaveSlot = { dbName, careerId: result.careerId, managerName, teamName: String(playerTeam.name), tier: result.selectedTier, savedAt: new Date().toISOString() };
        const nextSlots = [slot, ...readSaveSlots().filter((item) => item.dbName !== dbName)].slice(0, 10);
        writeSaveSlots(nextSlots); setSaveSlots(nextSlots); setActiveSave(slot); setGeneration(result);
        setDatabase(db); setDashboard(await loadDashboard(db, result.careerId, result.playerTeamId, result.selectedTier)); setTab("overview");
      } catch (caught) {
        await db.close();
        throw caught;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Career gagal dibuat. Save tidak dibuat dalam kondisi parsial.");
    } finally {
      setCreating(false);
    }
  }

  async function resumeCareer(slot: SaveSlot) {
    setError("");
    setCreating(true);
    try {
      const db = await openCareerDatabase(slot.dbName);
      const teams = await db.query("SELECT team_id, name FROM teams WHERE career_id = ? AND is_player_team = 1;", [slot.careerId]);
      if (!teams[0]) { await db.close(); throw new Error("Save slot ini tidak memiliki tim pemain."); }
      setDatabase(db); setActiveSave(slot); setGeneration(null);
      setDashboard(await loadDashboard(db, slot.careerId, String(teams[0].team_id), slot.tier)); setTab("overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save tidak bisa dibuka.");
      setSaveSlots(readSaveSlots().filter((item) => item.dbName !== slot.dbName));
    } finally { setCreating(false); }
  }

  async function decideSponsorOffer(offerId: string, accept: boolean) {
    if (!database || !activeSave) return;
    setError("");
    try {
      await database.transaction(async () => {
        const rows = await database.query(
          "SELECT * FROM sponsor_offers WHERE offer_id = ? AND career_id = ? AND team_id = ?;",
          [offerId, activeSave.careerId, String(dashboard?.team.team_id)],
        );
        const offer = rows[0];
        if (!offer || field(offer, "status") !== "offered") throw new Error("Penawaran sponsor sudah diproses atau tidak tersedia.");
        if (accept) {
          await database.run(
            "INSERT INTO team_sponsors (team_sponsor_id, team_id, sponsor_id, start_season, end_season, contract_value, focus, is_active) VALUES (?, ?, ?, 1, ?, ?, ?, 1);",
            ["contract_" + offerId, String(offer.team_id), String(offer.sponsor_id), Number(offer.duration_seasons), Number(offer.contract_value), String(offer.focus)],
          );
          await database.run("UPDATE sponsor_offers SET status = 'accepted' WHERE offer_id = ? AND status = 'offered';", [offerId]);
        } else {
          await database.run("UPDATE sponsor_offers SET status = 'declined' WHERE offer_id = ? AND status = 'offered';", [offerId]);
        }
      });
      const playerTeamId = String(dashboard?.team.team_id ?? "");
      setDashboard(await loadDashboard(database, activeSave.careerId, playerTeamId, activeSave.tier));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Penawaran sponsor gagal diproses.");
    }
  }

  async function upgradeFacility(facility: FacilityId) {
    if (!database || !activeSave || !dashboard) return;
    setFacilityBusy(true); setFacilityError("");
    try {
      await upgradeTeamFacility(database, { teamId: String(dashboard.team.team_id), facility, season: numberField(dashboard.career, "current_season", 1) });
      setDashboard(await loadDashboard(database, activeSave.careerId, String(dashboard.team.team_id), activeSave.tier));
    } catch (caught) {
      setFacilityError(caught instanceof Error ? caught.message : "Upgrade fasilitas gagal.");
    } finally { setFacilityBusy(false); }
  }
  async function startDevelopment() {
    if (!database || !activeSave || !dashboard) return;
    setDevelopmentBusy(true); setDevelopmentError("");
    try {
      await startCareerDevelopmentProject(database, {
        careerId: activeSave.careerId,
        teamId: String(dashboard.team.team_id),
        tier: activeSave.tier,
        season: numberField(dashboard.career, "current_season", 1),
        round: numberField(dashboard.career, "current_race", 1),
        projectCatalogId: developmentProjectId,
        size: developmentSize,
        worldSeed: String(dashboard.career.world_seed),
      });
      setDashboard(await loadDashboard(database, activeSave.careerId, String(dashboard.team.team_id), activeSave.tier));
    } catch (caught) {
      setDevelopmentError(caught instanceof Error ? caught.message : "Project development gagal dimulai.");
    } finally { setDevelopmentBusy(false); }
  }

  async function cancelDevelopment(projectInstanceId: string) {
    if (!database || !activeSave || !dashboard) return;
    setDevelopmentBusy(true); setDevelopmentError("");
    try {
      const refund = await cancelCareerDevelopmentProject(database, {
        careerId: activeSave.careerId,
        teamId: String(dashboard.team.team_id),
        projectInstanceId,
        season: numberField(dashboard.career, "current_season", 1),
        round: numberField(dashboard.career, "current_race", 1),
        tier: activeSave.tier,
      });
      setDevelopmentError("Project dibatalkan. Refund: " + formatCash(refund) + ".");
      setDashboard(await loadDashboard(database, activeSave.careerId, String(dashboard.team.team_id), activeSave.tier));
    } catch (caught) {
      setDevelopmentError(caught instanceof Error ? caught.message : "Project tidak dapat dibatalkan.");
    } finally { setDevelopmentBusy(false); }
  }

  async function settleSeason() {
    if (!database || !activeSave || !dashboard) return;
    setSettlingSeason(true); setSettlementError("");
    try {
      await settleCareerSeason(database, { careerId: activeSave.careerId, season: numberField(dashboard.career, "current_season", 1), tier: activeSave.tier });
      setDashboard(await loadDashboard(database, activeSave.careerId, String(dashboard.team.team_id), activeSave.tier));
    } catch (caught) {
      setSettlementError(caught instanceof Error ? caught.message : "Season settlement gagal; transaksi dibatalkan.");
    } finally { setSettlingSeason(false); }
  }

  async function runNextRace() {
    if (!database || !activeSave) return;
    setRunningRace(true); setRaceError(""); setLastRace(null);
    try {
      const result = await simulateNextRace(database, activeSave.careerId, activeSave.tier, String(dashboard?.career.world_seed ?? ""));
      setLastRace(result);
      setDashboard(await loadDashboard(database, activeSave.careerId, (await database.query("SELECT team_id FROM teams WHERE career_id = ? AND is_player_team = 1;", [activeSave.careerId]))[0]?.team_id as string, activeSave.tier));
    } catch (caught) {
      setRaceError(caught instanceof Error ? caught.message : "Race gagal disimulasikan; status race tidak diubah.");
    } finally { setRunningRace(false); }
  }

  async function leaveCareer() {
    if (database) await database.close().catch(() => undefined);
    setDatabase(null); setActiveSave(null); setGeneration(null); setDashboard(null); setLastRace(null);
    setSaveSlots(readSaveSlots());
  }

  if (showQa) return <div className="career-mode-root"><button className="secondary-button qa-back" onClick={() => setShowQa(false)}>← Kembali ke Career Mode</button><RaceWorkbench /></div>;

  if (dashboard && activeSave) {
    const team = dashboard.team;
    const nextRace = dashboard.races.find((race) => field(race, "status") === "scheduled");
    const developmentOptions = DEVELOPMENT_CATALOG.filter((project) => activeSave.tier >= project.minimumTier && activeSave.tier <= project.maximumTier);
    const selectedDevelopment = developmentOptions.find((project) => project.id === developmentProjectId) ?? developmentOptions[0];
    const chiefEngineer = dashboard.staff.find((member) => field(member, "role") === "Chief Engineer");
    const selectedFacilityLevel = selectedDevelopment
      ? numberField(team, selectedDevelopment.category === "aero" ? "aero_center_level" : selectedDevelopment.category === "engine" ? "engine_dept_level" : selectedDevelopment.category === "chassis" ? "chassis_level" : "rnd_level", 1)
      : 1;
    const developmentEligibility = selectedDevelopment ? validateDevelopmentSelection({
      projectId: selectedDevelopment.id, tier: activeSave.tier, size: developmentSize,
      chiefEngineerSkill: numberField(chiefEngineer, "skill"), facilityLevel: selectedFacilityLevel,
    }) : { eligible: false, reasons: ["Tidak ada project yang tersedia untuk tier ini."] };
    const developmentReasons = [...developmentEligibility.reasons];
    if (!chiefEngineer) developmentReasons.unshift("Tim belum memiliki Chief Engineer.");
    if (developmentSize === "major" && numberField(team, "rnd_level", 1) < 6) developmentReasons.push("Major project membutuhkan R&D Department minimal level 6.");
    if (numberField(team, "cash") < 0) developmentReasons.push("Development tidak bisa dimulai saat saldo tim negatif.");
    if (dashboard.developmentProjects.filter((project) => field(project, "status") === "active").length >= Math.ceil(numberField(team, "rnd_level", 1) / 2)) {
      developmentReasons.push("Semua slot development sedang terpakai.");
    }
    const tabs: { id: Tab; label: string }[] = [
      { id: "overview", label: "Overview" }, { id: "calendar", label: "Calendar" }, { id: "roster", label: "Drivers" }, { id: "market", label: "Driver Market" },
      { id: "staff", label: "Staff" }, { id: "development", label: "Development" }, { id: "sponsors", label: "Sponsors" }, { id: "finance", label: "Finance" }, { id: "standings", label: "Standings" },
    ];
    return <main className="career-mode-root">
      <header className="career-header">
        <div className="career-brand"><span className="brand-mark">PL</span><div><small>CAREER MODE</small><strong>PADDOCK LIFE</strong></div></div>
        <button className="secondary-button" onClick={() => void leaveCareer()}>Main Menu</button>
      </header>
      <section className="career-team-hero">
        <div><p className="eyebrow">SEASON {numberField(dashboard.career, "current_season", 1)} · TIER {activeSave.tier}</p><h1>{field(team, "name", activeSave.teamName)}</h1><p>{TIER_CONFIG[activeSave.tier].name} · {field(team, "personality", "Team")}</p></div>
        <div className="cash-card"><small>TEAM CASH</small><strong>{formatCash(numberField(team, "cash"))}</strong><span>Debt {formatCash(numberField(team, "debt"))}</span></div>
      </section>
      <nav className="career-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
      {tab === "overview" && <section className="career-grid">
        <article className="career-panel wide-panel"><div className="panel-title"><div><small>RACE CONTROL</small><h2>{nextRace ? "Next race" : "Season completed"}</h2></div><span className="status-chip">{nextRace ? "SCHEDULED" : "COMPLETE"}</span></div>
          {nextRace ? <><p className="next-race-name">{field(nextRace, "circuit_name")} <span>· {field(nextRace, "circuit_country")}</span></p><div className="stat-strip"><span>ROUND <b>{field(nextRace, "round")}/{dashboard.races.length}</b></span><span>LAPS <b>{field(nextRace, "laps")}</b></span><span>SPRINT <b>{numberField(nextRace, "has_sprint") ? "YES" : "NO"}</b></span></div><button className="primary-button" disabled={runningRace} onClick={() => void runNextRace()}>{runningRace ? "Simulating race…" : "Run race weekend →"}</button>{raceError && <p className="inline-error">{raceError}</p>}</> : dashboard.settlements.length ? <><p className="muted-text">Season 1 sudah ditutup. Saldo akhir tim: {formatCash(numberField(dashboard.settlements[0], "closing_cash"))}. Season progression dan transfer window belum diaktifkan.</p><div className="settlement-summary"><span>Prize money <b>{formatCash(numberField(dashboard.settlements[0], "prize_money"))}</b></span><span>Commercial <b>{formatCash(numberField(dashboard.settlements[0], "commercial_revenue"))}</b></span><span>Sponsor <b>{formatCash(numberField(dashboard.settlements[0], "sponsor_revenue"))}</b></span><span>Net season <b>{formatCash(numberField(dashboard.settlements[0], "net_amount"))}</b></span></div></> : <><p className="muted-text">Semua ronde season ini selesai. Tutup season untuk memproses hadiah, pendapatan komersial, sponsor, bunga utang, dan maintenance fasilitas.</p><button className="primary-button" disabled={settlingSeason} onClick={() => void settleSeason()}>{settlingSeason ? "Settling finances…" : "Settle season finances →"}</button>{settlementError && <p className="inline-error">{settlementError}</p>}</>}
        </article>
        <article className="career-panel"><small>WORLD STATUS</small><div className="big-number">{dashboard.teams.length}<span>/ 12</span></div><p>Teams in this division</p><div className="stat-line"><span>Drivers in roster</span><b>{dashboard.roster.length}/2</b></div><div className="stat-line"><span>Active sponsor offers</span><b>{dashboard.sponsors.length}</b></div></article>
        <article className="career-panel"><small>CAR DEVELOPMENT</small><h2>Season 1</h2><p className="muted-text">Project development kini tersedia di tab Development. Facility upgrades dan kontrak driver belum tersedia.</p></article>
        {lastRace && <>
          <article className="career-panel wide-panel"><small>QUALIFYING CLASSIFICATION</small><h2>Starting grid</h2><div className="table-scroll"><table className="career-table"><thead><tr><th>GRID</th><th>DRIVER</th><th>BEST LAP</th></tr></thead><tbody>{[...lastRace.qualifying.classification].sort((a,b)=>a.gridPosition-b.gridPosition).map((row) => <tr key={row.driverId}><td>{row.gridPosition}</td><td>{row.driverName}</td><td>{row.bestLapSeconds.toFixed(3)}s</td></tr>)}</tbody></table></div></article>
          {lastRace.sprint && <article className="career-panel wide-panel"><small>SPRINT CLASSIFICATION · {lastRace.sprintLaps} LAPS</small><h2>Sprint result</h2><div className="table-scroll"><table className="career-table"><thead><tr><th>POS</th><th>DRIVER</th><th>TIME</th><th>POINTS</th></tr></thead><tbody>{[...lastRace.sprint.classification].sort((a,b)=>a.position-b.position).slice(0,12).map((row) => <tr key={row.driverId}><td>{row.position}</td><td>{row.driverName}</td><td>{row.cumulativeTimeSeconds.toFixed(3)}s</td><td>{calculateSprintRacePoints(row.position)}</td></tr>)}</tbody></table></div></article>}
          <article className="career-panel wide-panel"><small>RACE CLASSIFICATION</small><h2>Race result</h2><div className="table-scroll"><table className="career-table"><thead><tr><th>POS</th><th>DRIVER</th><th>TIME</th><th>POINTS</th></tr></thead><tbody>{[...lastRace.race.classification].sort((a,b)=>a.position-b.position).slice(0,12).map((row) => <tr key={row.driverId}><td>{row.position}</td><td>{row.driverName}</td><td>{row.cumulativeTimeSeconds.toFixed(3)}s</td><td>{calculateMainRacePoints(activeSave.tier, row.position, lastRace.fastestLapDriverIds.includes(row.driverId))}</td></tr>)}</tbody></table></div></article>
        </>}
      </section>}
      {tab === "calendar" && <section className="career-panel"><div className="panel-title"><div><small>SEASON 1</small><h2>Race calendar</h2></div><span>{dashboard.races.filter((race) => field(race, "status") === "completed").length}/{dashboard.races.length} completed</span></div><div className="table-scroll"><table className="career-table"><thead><tr><th>ROUND</th><th>CIRCUIT</th><th>LAPS</th><th>SPRINT</th><th>STATUS</th></tr></thead><tbody>{dashboard.races.map((race) => <tr key={field(race, "race_id")}><td>{field(race, "round")}</td><td>{field(race, "circuit_name")}<small>{field(race, "circuit_country")}</small></td><td>{field(race, "laps")}</td><td>{numberField(race, "has_sprint") ? "Yes" : "No"}</td><td><span className={field(race, "status") === "completed" ? "status-chip complete" : "status-chip"}>{field(race, "status")}</span></td></tr>)}</tbody></table></div></section>}
      {tab === "roster" && <section className="career-panel"><div className="panel-title"><div><small>RACE TEAM</small><h2>Driver roster</h2></div><span>{dashboard.roster.length} drivers</span></div><div className="table-scroll"><table className="career-table"><thead><tr><th>DRIVER</th><th>AGE</th><th>PACE</th><th>QUALI</th><th>RACECRAFT</th><th>TYRE MGMT</th><th>SALARY</th></tr></thead><tbody>{dashboard.roster.map((driver) => <tr key={field(driver, "driver_id")}><td>{field(driver, "name")}<small>{field(driver, "nationality")}</small></td><td>{field(driver, "age")}</td><td>{numberField(driver, "pace").toFixed(1)}</td><td>{numberField(driver, "qualifying").toFixed(1)}</td><td>{numberField(driver, "racecraft").toFixed(1)}</td><td>{numberField(driver, "tyre_management").toFixed(1)}</td><td>{formatCash(numberField(driver, "salary"))}</td></tr>)}</tbody></table></div></section>}
      {tab === "market" && database && activeSave && dashboard && <DriverMarketPanel database={database} careerId={activeSave.careerId} teamId={String(dashboard.team.team_id)} currentSeason={numberField(dashboard.career, "current_season", 1) + 1} worldSeed={String(dashboard.career.world_seed ?? "")} tier={activeSave.tier} drivers={dashboard.marketDrivers} onChanged={async () => { await refreshDashboard(database, activeSave); }} />}
      {tab === "staff" && <section className="career-panel"><div className="panel-title"><div><small>OPERATIONS</small><h2>Team staff</h2></div><span>{dashboard.staff.length} staff</span></div><div className="table-scroll"><table className="career-table"><thead><tr><th>ROLE</th><th>NAME</th><th>AGE</th><th>SKILL</th><th>SALARY</th></tr></thead><tbody>{dashboard.staff.map((member) => <tr key={field(member, "staff_id")}><td>{field(member, "role")}</td><td>{field(member, "name")}</td><td>{field(member, "age")}</td><td>{numberField(member, "skill").toFixed(1)}</td><td>{formatCash(numberField(member, "salary"))}</td></tr>)}</tbody></table></div></section>}
      {tab === "development" && <section className="career-grid">
        <article className="career-panel wide-panel">
          <div className="panel-title"><div><small>R&D / CAR DEVELOPMENT</small><h2>Build the next upgrade</h2></div><span>{dashboard.developmentProjects.filter((project) => field(project, "status") === "active").length}/{Math.ceil(numberField(team, "rnd_level", 1) / 2)} active slots</span></div>
          <p className="muted-text">Success chance is fixed at 70%. Failed projects keep the old part and do not refund their cost. Facility level reduces duration and narrows variance.</p>
          <div className="form-grid development-form">
            <label>Project<select value={selectedDevelopment?.id ?? ""} onChange={(event) => {
              const project = developmentOptions.find((item) => item.id === event.target.value);
              if (!project) return;
              setDevelopmentProjectId(project.id);
              if (!project.availableSizes.includes(developmentSize)) setDevelopmentSize(project.availableSizes[0]!);
              setDevelopmentError("");
            }}>{developmentOptions.map((project) => <option key={project.id} value={project.id}>{project.id} · {getDevelopmentProjectName(project.id, activeSave.tier) ?? project.name}</option>)}</select></label>
            <label>Project size<select value={developmentSize} onChange={(event) => setDevelopmentSize(event.target.value as DevelopmentProjectSize)}>{(selectedDevelopment?.availableSizes ?? []).map((size) => <option key={size} value={size}>{size.charAt(0).toUpperCase() + size.slice(1)}</option>)}</select></label>
          </div>
          {selectedDevelopment && <div className="development-preview">
            <div><span>CATEGORY</span><b>{selectedDevelopment.category.toUpperCase()}</b></div>
            <div><span>MAIN ATTRIBUTE</span><b>{selectedDevelopment.mainAttribute}</b></div>
            <div><span>SECONDARY</span><b>{selectedDevelopment.secondaryAttributes.join(", ") || "None"}</b></div>
            <div><span>SUCCESS CHANCE</span><b>70%</b></div>
            <div><span>PROJECT COST</span><b>{formatCash(calculateDevelopmentProjectCost(activeSave.tier, developmentSize))}</b></div>
            <div><span>EFFECTIVE DURATION</span><b>{calculateEffectiveDevelopmentDuration(developmentSize, selectedFacilityLevel).toFixed(2)} races</b></div>
          </div>}
          {developmentReasons.length > 0 && <div className="development-reasons"><strong>Cannot start yet</strong><ul>{[...new Set(developmentReasons)].map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
          {developmentError && <p className="inline-error">{developmentError}</p>}
          <button className="primary-button" disabled={developmentBusy || !selectedDevelopment || developmentReasons.length > 0} onClick={() => void startDevelopment()}>{developmentBusy ? "Processing…" : "Start development project →"}</button>
        </article>
        <article className="career-panel wide-panel">
          <div className="panel-title"><div><small>ACTIVE PROGRAMMES</small><h2>Projects in progress</h2></div><span>{dashboard.developmentProjects.filter((project) => field(project, "status") === "active").length} active</span></div>
          {dashboard.developmentProjects.filter((project) => field(project, "status") === "active").length ? <div className="development-project-list">{dashboard.developmentProjects.filter((project) => field(project, "status") === "active").map((project) => {
            const progress = numberField(project, "progress_races");
            const duration = numberField(project, "duration_races", 1);
            const pct = Math.min(100, Math.round(progress / duration * 100));
            return <div className="development-project-card" key={field(project, "project_instance_id")}><div className="development-project-head"><div><strong>{field(project, "project_name")}</strong><span>{field(project, "project_catalog_id")} · {field(project, "size")} · {formatCash(numberField(project, "cost"))}</span></div><button className="mini-action" disabled={developmentBusy} onClick={() => void cancelDevelopment(field(project, "project_instance_id"))}>Cancel</button></div><div className="development-progress"><span style={{ width: pct + "%" }} /></div><small>{progress.toFixed(0)} / {duration.toFixed(2)} race progress · {pct}%</small></div>;
          })}</div> : <p className="muted-text">Belum ada project aktif. Pilih upgrade yang memenuhi syarat di atas untuk memulai.</p>}
        </article>
        <article className="career-panel wide-panel">
          <div className="panel-title"><div><small>TEAM INFRASTRUCTURE</small><h2>Facility upgrades</h2></div><span>MAX LEVEL 10</span></div>
          <p className="muted-text">Upgrade costs follow the documented RB-based formula. Each purchase and its finance ledger entry are committed atomically.</p>
          {facilityError && <p className="inline-error">{facilityError}</p>}
          <div className="facility-grid">{FACILITY_CATALOG.map((facility) => {
            const level = numberField(team, facility.column, 1);
            const cost = level < 10 ? calculateFacilityUpgradeCost(activeSave.tier, level) : 0;
            return <div className="facility-card" key={facility.id}>
              <div><small>{facility.id.replaceAll("_", " ").toUpperCase()}</small><strong>{facility.label}</strong></div>
              <div className="facility-level"><span>LEVEL</span><b>{level}<i>/10</i></b></div>
              <div className="facility-cost"><span>{level < 10 ? "NEXT UPGRADE" : "MAXIMUM LEVEL"}</span><b>{level < 10 ? formatCash(cost) : "MAX"}</b></div>
              <button className="mini-action accept" disabled={facilityBusy || level >= 10} onClick={() => void upgradeFacility(facility.id)}>{facilityBusy ? "Processing…" : level >= 10 ? "Fully upgraded" : "Upgrade to L" + (level + 1)}</button>
            </div>;
          })}</div>
        </article>
        <article className="career-panel wide-panel">
          <div className="panel-title"><div><small>DEVELOPMENT HISTORY</small><h2>Completed and cancelled</h2></div><span>{dashboard.developmentHistory.length} records</span></div>
          {dashboard.developmentHistory.length ? <div className="table-scroll"><table className="career-table"><thead><tr><th>ROUND</th><th>PROJECT</th><th>SIZE</th><th>STATUS</th><th>RESULT / REASON</th><th>COST</th><th>REFUND</th></tr></thead><tbody>{dashboard.developmentHistory.map((item) => <tr key={field(item, "history_id")}><td>{field(item, "season")} · {field(item, "round")}</td><td>{field(item, "project_name")}</td><td>{field(item, "size")}</td><td>{field(item, "status")}</td><td>{field(item, "success") === "1" || numberField(item, "success", -1) === 1 ? "Success" : field(item, "success") === "0" || numberField(item, "success", -1) === 0 ? field(item, "reason", "Failed") : field(item, "reason", "Cancelled")}</td><td>{formatCash(numberField(item, "cost"))}</td><td>{formatCash(numberField(item, "refund"))}</td></tr>)}</tbody></table></div> : <p className="muted-text">Riwayat project akan tercatat setelah project selesai atau dibatalkan.</p>}
        </article>
      </section>}
      {tab === "sponsors" && <section className="career-panel"><div className="panel-title"><div><small>COMMERCIAL</small><h2>Sponsor offers</h2></div><span>{dashboard.sponsors.length} offers</span></div>{error && <p className="inline-error">{error}</p>}{dashboard.sponsors.length ? <div className="table-scroll"><table className="career-table"><thead><tr><th>SPONSOR</th><th>TIER</th><th>FOCUS</th><th>VALUE</th><th>DURATION</th><th>STATUS / ACTION</th></tr></thead><tbody>{dashboard.sponsors.map((sponsor) => <tr key={field(sponsor, "offer_id")}><td>{field(sponsor, "name")}<small>{field(sponsor, "category")}</small></td><td>T{field(sponsor, "tier")}</td><td>{field(sponsor, "focus")}</td><td>{formatCash(numberField(sponsor, "contract_value"))}</td><td>{field(sponsor, "duration_seasons")} seasons</td><td>{field(sponsor, "status") === "offered" ? <div className="sponsor-actions"><button className="mini-action accept" onClick={() => void decideSponsorOffer(field(sponsor, "offer_id"), true)}>Accept</button><button className="mini-action" onClick={() => void decideSponsorOffer(field(sponsor, "offer_id"), false)}>Decline</button></div> : <span className={field(sponsor, "status") === "accepted" ? "status-chip complete" : "status-chip"}>{field(sponsor, "status")}</span>}</td></tr>)}</tbody></table></div> : <p className="muted-text">Belum ada sponsor yang memenuhi syarat untuk tier ini.</p>}</section>}
      {tab === "finance" && <section className="career-grid"><article className="career-panel"><small>TEAM CASH</small><div className="big-number">{formatCash(numberField(team, "cash"))}</div><p>Starting balance</p></article><article className="career-panel"><small>DEBT</small><div className="big-number">{formatCash(numberField(team, "debt"))}</div><p>Interest rate 8% per season</p></article><article className="career-panel"><small>REQUIRED BUDGET</small><div className="big-number">{formatCash(numberField(team, "budget"))}</div><p>Budget reference for this tier</p></article><article className="career-panel wide-panel"><small>LEDGER</small><h2>Finance transactions</h2><p className="muted-text">{dashboard.finance.length ? "Transactions" : "Belum ada transaksi. Ledger akan terisi ketika ekonomi race mulai diproses."}</p>{dashboard.finance.length > 0 && <div className="table-scroll"><table className="career-table"><thead><tr><th>TYPE</th><th>CATEGORY</th><th>AMOUNT</th><th>BALANCE</th></tr></thead><tbody>{dashboard.finance.map((item, index) => <tr key={field(item, "transaction_id", String(index))}><td>{field(item, "type")}</td><td>{field(item, "category")}</td><td>{formatCash(numberField(item, "amount"))}</td><td>{formatCash(numberField(item, "balance_after"))}</td></tr>)}</tbody></table></div>}</article></section>}
      {tab === "standings" && <section className="career-panel"><div className="panel-title"><div><small>CHAMPIONSHIP</small><h2>Standings</h2></div></div>{dashboard.standings.length ? <div className="table-scroll"><table className="career-table"><thead><tr><th>POS</th><th>DRIVER / TEAM</th><th>POINTS</th><th>WINS</th><th>PODIUMS</th></tr></thead><tbody>{dashboard.standings.map((standing, index) => <tr key={field(standing, "driver_id", field(standing, "team_id", String(index)))}><td>{index + 1}</td><td>{field(standing, "driver_name", field(standing, "team_name"))}</td><td>{numberField(standing, "points")}</td><td>{numberField(standing, "wins")}</td><td>{numberField(standing, "podiums")}</td></tr>)}</tbody></table></div> : <p className="muted-text">Belum ada hasil balapan.</p>}</section>}
      <footer className="career-footer"><span>LOCAL-FIRST SAVE · {activeSave.dbName}</span><button className="text-button" onClick={() => setShowQa(true)}>Open Race QA Workbench ↗</button></footer>
    </main>;
  }

  return <main className="career-mode-root">
    <header className="career-header"><div className="career-brand"><span className="brand-mark">PL</span><div><small>MOTORSPORT MANAGEMENT</small><strong>PADDOCK LIFE</strong></div></div><span className="build-label">DEVELOPMENT BUILD</span></header>
    {saveSlots.length > 0 && <section className="career-panel save-slots-panel"><div className="panel-title"><div><small>LOCAL SAVES</small><h2>Continue career</h2></div><span>{saveSlots.length} save slots</span></div>{saveSlots.map((slot) => <div className="save-slot" key={slot.dbName}><div><strong>{slot.teamName}</strong><span>{slot.managerName} · Tier {slot.tier} · {new Date(slot.savedAt).toLocaleDateString("id-ID")}</span></div><button className="secondary-button" disabled={creating} onClick={() => void resumeCareer(slot)}>Continue →</button></div>)}</section>}
    <section className="new-career-heading"><p className="eyebrow">CAREER MODE / NEW SAVE</p><h1>Build your <span>legacy.</span></h1><p>Pilih identitas manager, tentukan jalur karier, lalu bangun dunia balap dari seed sumber proyek.</p></section>
    {loadingCatalog && <section className="career-panel"><p>Memuat data dunia dan pool nama resmi…</p></section>}
    {catalogError && <section className="career-panel"><p className="inline-error">{catalogError}</p><button className="secondary-button" onClick={() => { setLoadingCatalog(true); setCatalogError(""); void loadCatalog().then(setCatalog).catch((caught) => setCatalogError(caught instanceof Error ? caught.message : "Katalog gagal dimuat.")).finally(() => setLoadingCatalog(false)); }}>Retry data load</button></section>}
    {catalog && <form className="new-career-form" onSubmit={(event) => { event.preventDefault(); void createCareer(); }}>
      <section className="career-panel"><div className="panel-title"><div><small>01 / MANAGER PROFILE</small><h2>Who takes the seat?</h2></div><span className="step-index">01</span></div><div className="form-grid">
        <label>Manager name<input required minLength={2} maxLength={24} value={managerName} onChange={(event) => setManagerName(event.target.value)} placeholder="Nama manager" /></label>
        <label>Nationality<select required value={managerCountryCode} onChange={(event) => setManagerCountryCode(event.target.value)}>{catalog.countries.slice().sort((a,b)=>a.countryName.localeCompare(b.countryName)).map((country) => <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>)}</select></label>
        <label>Gender<select value={managerGender} onChange={(event) => setManagerGender(event.target.value as "male" | "female")}><option value="male">Male</option><option value="female">Female</option></select></label>
        <label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as "easy" | "normal" | "hard")}><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>
      </div></section>
      <section className="career-panel"><div className="panel-title"><div><small>02 / CAREER PATH</small><h2>Choose your entry</h2></div><span className="step-index">02</span></div><div className="path-choice">
        <button type="button" className={path === "new-team" ? "path-card selected" : "path-card"} onClick={() => { setPath("new-team"); setTier(3); }}><small>01</small><strong>Found a team</strong><span>Create a new team in Tier 5, 4, or 3. Replace a weak or medium AI team.</span></button>
        <button type="button" className={path === "takeover" ? "path-card selected" : "path-card"} onClick={() => { setPath("takeover"); setTier(3); }}><small>02</small><strong>Take over</strong><span>Take charge of an existing team in Tier 5 through Tier 1.</span></button>
      </div><div className="form-grid">
        {path === "new-team" && <><label>Team name<input required minLength={3} maxLength={24} value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Nama tim baru" /></label><label>Team code<input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" value={newTeamCode} onChange={(event) => setNewTeamCode(event.target.value.toUpperCase())} /></label><label>Team base country<select value={newTeamCountryCode} onChange={(event) => setNewTeamCountryCode(event.target.value)}>{catalog.countries.slice().sort((a,b)=>a.countryName.localeCompare(b.countryName)).map((country) => <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>)}</select></label></>}
        <label>Starting tier<select value={tier} onChange={(event) => setTier(Number(event.target.value) as TierId)}>{(path === "new-team" ? [5,4,3] : TIER_PICKER).map((value) => <option key={value} value={value}>Tier {value} · {TIER_CONFIG[value as TierId].name}</option>)}</select></label>
        <label>{path === "new-team" ? "Team to replace" : "Choose your team"}<select value={teamId} onChange={(event) => setTeamId(event.target.value)}>{selectableTeams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.strength} · Finance {team.financeGrade} / Performance {team.performanceGrade}</option>)}</select></label>
      </div><p className="form-note">{path === "new-team" ? "Tim baru dimulai dengan Performance C dan Finance C. Tier 6 tidak tersedia untuk Career Mode." : "Kamu mengambil alih struktur dan kekuatan tim yang dipilih."}</p></section>
      <section className="career-panel"><div className="panel-title"><div><small>03 / WORLD GENERATION</small><h2>Set your world seed</h2></div><span className="step-index">03</span></div><div className="form-grid"><label className="full-field">World seed<input required maxLength={128} value={worldSeed} onChange={(event) => setWorldSeed(event.target.value)} /></label></div><p className="form-note">Seed yang sama menghasilkan dunia awal yang sama. World generation dijalankan dalam satu transaksi career.</p></section>
      {error && <section className="career-panel"><p className="inline-error">{error}</p></section>}
      <div className="create-career-actions"><button className="primary-button" type="submit" disabled={creating || loadingCatalog}>{creating ? "Generating world…" : "Create career →"}</button><span>72 teams · 30 circuits · 100 sponsors · seeded local save</span></div>
    </form>}
    <footer className="career-footer"><span>PADDOCK LIFE · LOCAL-FIRST DEVELOPMENT BUILD</span><button className="text-button" onClick={() => setShowQa(true)}>Open Race QA Workbench ↗</button></footer>
  </main>;
}
