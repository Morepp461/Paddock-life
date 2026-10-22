import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { type TierId } from "./GameConfig";
import {
  calculateBalanceAfterTransaction,
  calculateDevelopmentProjectCost,
  type DevelopmentProjectSize,
} from "./EconomyEngine";
import { DEVELOPMENT_CATALOG, getDevelopmentProjectName, getSecondaryReliabilityEffect, validateDevelopmentSelection } from "./DevelopmentCatalog";
import { calculateCancellationRefund, calculateDiminishingReturn, resolveDevelopmentProject } from "./DevelopmentEngine";
import { hashSeed } from "./RandomDistributions";

type AttributeKey =
  | "engine_power" | "aero" | "high_speed" | "medium_speed" | "low_speed"
  | "mechanical_grip" | "traction" | "braking" | "tyre_management"
  | "engine_reliability" | "gearbox_reliability" | "brake_reliability"
  | "suspension_reliability" | "electronics_reliability";

const ATTRIBUTE_COLUMNS: Readonly<Record<string, AttributeKey>> = {
  Engine: "engine_power", Aero: "aero", "High Speed": "high_speed", "Medium Speed": "medium_speed",
  "Low Speed": "low_speed", "Mechanical Grip": "mechanical_grip", Traction: "traction",
  Braking: "braking", "Tyre Management": "tyre_management",
  "Engine Reliability": "engine_reliability", "Gearbox Reliability": "gearbox_reliability",
  "Brake Reliability": "brake_reliability", "Suspension Reliability": "suspension_reliability",
  "Electronics Reliability": "electronics_reliability",
};
const RELIABILITY_COLUMNS: readonly AttributeKey[] = [
  "engine_reliability", "gearbox_reliability", "brake_reliability",
  "suspension_reliability", "electronics_reliability",
];
const FAILURE_REASONS = [
  "reason.dev.fail.wind_tunnel", "reason.dev.fail.dyno", "reason.dev.fail.simulation",
  "reason.dev.fail.material", "reason.dev.fail.integration",
] as const;

export interface DevelopmentActionResult {
  readonly projectInstanceId: string;
  readonly projectName: string;
  readonly cost: number;
  readonly durationRaces: number;
  readonly progressRaces: number;
  readonly successProbability: number;
}
export interface DevelopmentCompletion {
  readonly projectInstanceId: string;
  readonly projectName: string;
  readonly status: "completed" | "failed";
  readonly success: boolean;
  readonly reason: string | null;
  readonly result: ReturnType<typeof resolveDevelopmentProject>;
}

function num(row: DatabaseRow | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function attrKey(label: string, category: string): AttributeKey | null {
  const cleaned = label.replace(/\s*\([+-]\)\s*/g, "").trim();
  if (cleaned === "All Component Reliability") return "engine_reliability";
  if (cleaned === "Reliability") return category === "chassis" ? "gearbox_reliability" : "engine_reliability";
  return ATTRIBUTE_COLUMNS[cleaned] ?? null;
}
function facilityColumn(category: string): string {
  if (category === "aero") return "aero_center_level";
  if (category === "engine") return "engine_dept_level";
  if (category === "chassis") return "chassis_level";
  return "rnd_level";
}
function parseSecondaryLabels(project: typeof DEVELOPMENT_CATALOG[number]): string[] {
  const labels: string[] = [];
  for (const source of project.secondaryAttributes) {
    if (source.includes("Reliability")) {
      labels.push(source);
      continue;
    }
    for (const part of source.split(",")) {
      for (const token of part.split("/")) {
        const value = token.trim();
        if (value && value !== "–" && value !== "-") labels.push(value);
      }
    }
  }
  return [...new Set(labels)];
}
function mainLabel(project: typeof DEVELOPMENT_CATALOG[number]): string {
  return project.mainAttribute === "All Component Reliability" ? "Engine Reliability" : project.mainAttribute;
}
function reliabilityTarget(label: string, category: string): { key: AttributeKey; sign: 1 | -1 } | null {
  const negative = /\(-\)/.test(label);
  const positive = /\(\+\)/.test(label);
  const base = label.replace(/\s*\([+-]\)\s*/g, "").trim();
  let key = attrKey(base, category);
  if (!key && base === "Reliability") key = category === "chassis" ? "gearbox_reliability" : "engine_reliability";
  if (!key || !key.endsWith("_reliability")) return null;
  if (negative) return { key, sign: -1 };
  if (positive || category === "reliability") return { key, sign: 1 };
  return null;
}
function clampAttribute(value: number): number {
  return Math.max(0, Math.min(100, value));
}
async function divisionMeans(database: IDatabase, careerId: string, tier: TierId, season: number): Promise<DatabaseRow> {
  const row = (await database.query(
    `SELECT AVG(c.engine_power) AS engine_power, AVG(c.aero) AS aero, AVG(c.high_speed) AS high_speed,
      AVG(c.medium_speed) AS medium_speed, AVG(c.low_speed) AS low_speed,
      AVG(c.mechanical_grip) AS mechanical_grip, AVG(c.traction) AS traction, AVG(c.braking) AS braking,
      AVG(c.tyre_management) AS tyre_management, AVG(c.engine_reliability) AS engine_reliability,
      AVG(c.gearbox_reliability) AS gearbox_reliability, AVG(c.brake_reliability) AS brake_reliability,
      AVG(c.suspension_reliability) AS suspension_reliability, AVG(c.electronics_reliability) AS electronics_reliability
     FROM cars c JOIN teams t ON t.team_id = c.team_id
     WHERE t.career_id = ? AND t.division_id = ? AND c.season = ? AND t.is_active = 1;`,
    [careerId, "T" + tier, season],
  ))[0];
  if (!row) throw new Error("Rata-rata atribut divisi tidak tersedia.");
  return row;
}
function deterministicFailureReason(projectInstanceId: string): string {
  return FAILURE_REASONS[hashSeed([projectInstanceId, "failure-reason"]) % FAILURE_REASONS.length]!;
}

export async function startCareerDevelopmentProject(
  database: IDatabase,
  input: {
    readonly careerId: string; readonly teamId: string; readonly tier: TierId;
    readonly season: number; readonly round: number; readonly projectCatalogId: string;
    readonly size: DevelopmentProjectSize; readonly worldSeed: string;
  },
): Promise<DevelopmentActionResult> {
  const project = DEVELOPMENT_CATALOG.find((entry) => entry.id === input.projectCatalogId);
  if (!project) throw new Error("Project tidak ditemukan di katalog.");
  const result = await database.transaction(async () => {
    const teams = await database.query(
      "SELECT team_id, career_id, division_id, cash, rnd_level, aero_center_level, engine_dept_level, chassis_level, reliability FROM teams WHERE team_id = ? AND career_id = ? AND is_player_team = 1 AND is_active = 1;",
      [input.teamId, input.careerId],
    );
    const team = teams[0];
    if (!team) throw new Error("Tim pemain tidak ditemukan.");
    if (String(team.division_id) !== "T" + input.tier) throw new Error("Tier tim tidak sesuai dengan Career Mode.");
    if (num(team, "cash") < 0) throw new Error("Development tidak bisa dimulai saat saldo tim negatif.");
    const active = await database.query(
      "SELECT COUNT(*) AS count FROM development_projects WHERE career_id = ? AND team_id = ? AND status = 'active';",
      [input.careerId, input.teamId],
    );
    const rndLevel = num(team, "rnd_level");
    const slots = Math.ceil(rndLevel / 2);
    if (num(active[0], "count") >= slots) throw new Error("Semua slot development aktif sedang terpakai. Upgrade R&D Department untuk menambah slot.");
    const engineers = await database.query(
      "SELECT skill FROM staff WHERE career_id = ? AND team_id = ? AND role = 'Chief Engineer' AND is_free_agent = 0 ORDER BY skill DESC LIMIT 1;",
      [input.careerId, input.teamId],
    );
    if (!engineers[0]) throw new Error("Tim belum memiliki Chief Engineer. Development tidak bisa dimulai.");
    const engineerSkill = num(engineers[0], "skill");
    const facilityLevel = num(team, facilityColumn(project.category));
    const eligibility = validateDevelopmentSelection({
      projectId: project.id, tier: input.tier, size: input.size,
      chiefEngineerSkill: engineerSkill, facilityLevel,
    });
    if (!eligibility.eligible) throw new Error(eligibility.reasons.join(" "));
    if (input.size === "major" && rndLevel < 6) throw new Error("Major project membutuhkan R&D Department minimal level 6.");
    const cars = await database.query("SELECT * FROM cars WHERE team_id = ? AND season = ?;", [input.teamId, input.season]);
    const car = cars[0];
    if (!car) throw new Error("Mobil untuk season aktif tidak ditemukan.");
    const carId = String(car.car_id);
    const countRows = await database.query("SELECT COUNT(*) AS count FROM development_projects WHERE career_id = ? AND team_id = ?;", [input.careerId, input.teamId]);
    const instanceId = "dev_" + hashSeed([
      input.worldSeed, input.careerId, input.teamId, input.season, input.round,
      project.id, input.size, num(countRows[0], "count"),
    ]).toString(16).padStart(8, "0");
    const mainKey = attrKey(mainLabel(project), project.category);
    if (!mainKey) throw new Error("Atribut utama belum memiliki pemetaan database: " + project.mainAttribute);
    const labels = parseSecondaryLabels(project);
    const secondaryKey = labels.map((label) => attrKey(label, project.category)).find((key) => key !== null) ?? null;
    const means = await divisionMeans(database, input.careerId, input.tier, input.season);
    const efficiency = 1;
    const preview = resolveDevelopmentProject({
      projectId: instanceId, tier: input.tier, size: input.size, facilityLevel,
      engineerSkill, developmentEfficiency: efficiency,
      currentMainAttribute: num(car, mainKey), divisionMeanMainAttribute: num(means, mainKey),
      ...(secondaryKey ? { currentSecondaryAttribute: num(car, secondaryKey), divisionMeanSecondaryAttribute: num(means, secondaryKey) } : {}),
      category: project.category, ...(getSecondaryReliabilityEffect(project.id) ? { secondaryReliabilityEffect: getSecondaryReliabilityEffect(project.id)! } : {}),
      worldSeed: input.worldSeed,
    });
    const cost = calculateDevelopmentProjectCost(input.tier, input.size);
    const balance = calculateBalanceAfterTransaction({ currentBalance: num(team, "cash"), amount: -cost, tier: input.tier });
    if (!balance.withinOverdraft) throw new Error("Biaya project melewati batas overdraft 25% RequiredBudget.");
    await database.run("UPDATE teams SET cash = ? WHERE team_id = ?;", [balance.balanceAfter, input.teamId]);
    await database.run(
      "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, ?, ?, 'expense', 'development-project', ?, ?);",
      ["dev-start_" + instanceId, input.teamId, input.season, input.round, -cost, balance.balanceAfter],
    );
    const projectName = getDevelopmentProjectName(project.id, input.tier) ?? project.name;
    await database.run(
      `INSERT INTO development_projects
        (project_instance_id, career_id, team_id, car_id, project_catalog_id, project_name, category, size, cost,
         progress_races, duration_races, start_season, start_round, world_seed, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active');`,
      [instanceId, input.careerId, input.teamId, carId, project.id, projectName, project.category, input.size, cost,
        preview.effectiveDurationRaces, input.season, input.round, input.worldSeed],
    );
    return { projectInstanceId: instanceId, projectName, cost, durationRaces: preview.effectiveDurationRaces, progressRaces: 0, successProbability: preview.successProbability };
  });
  return result;
}

export async function cancelCareerDevelopmentProject(
  database: IDatabase,
  input: { readonly careerId: string; readonly teamId: string; readonly projectInstanceId: string; readonly season: number; readonly round: number; readonly tier: TierId },
): Promise<number> {
  return database.transaction(async () => {
    const rows = await database.query(
      "SELECT * FROM development_projects WHERE project_instance_id = ? AND career_id = ? AND team_id = ? AND status = 'active';",
      [input.projectInstanceId, input.careerId, input.teamId],
    );
    const project = rows[0];
    if (!project) throw new Error("Project aktif tidak ditemukan atau sudah diproses.");
    const progress = Math.min(1, Math.max(0, num(project, "progress_races") / num(project, "duration_races", 1)));
    const refund = calculateCancellationRefund(num(project, "cost"), progress);
    const teams = await database.query("SELECT cash FROM teams WHERE team_id = ? AND career_id = ?;", [input.teamId, input.careerId]);
    if (!teams[0]) throw new Error("Tim project tidak ditemukan.");
    const balance = calculateBalanceAfterTransaction({ currentBalance: num(teams[0], "cash"), amount: refund, tier: input.tier });
    if (!balance.withinOverdraft) throw new Error("Refund project tidak dapat diterapkan karena saldo melampaui batas overdraft.");
    if (refund > 0) {
      await database.run("UPDATE teams SET cash = ? WHERE team_id = ?;", [balance.balanceAfter, input.teamId]);
      await database.run(
        "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, ?, ?, 'income', 'development-cancel-refund', ?, ?);",
        ["dev-refund_" + input.projectInstanceId, input.teamId, input.season, input.round, refund, balance.balanceAfter],
      );
    }
    await database.run("UPDATE development_projects SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE project_instance_id = ?;", [input.projectInstanceId]);
    await database.run(
      `INSERT INTO development_history
        (history_id, project_instance_id, career_id, team_id, season, round, project_catalog_id, project_name, size, status, success, reason, cost, refund, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cancelled', NULL, 'cancelled-by-player', ?, ?, NULL);`,
      ["dev-history_" + input.projectInstanceId, input.projectInstanceId, input.careerId, input.teamId, input.season, input.round,
        String(project.project_catalog_id), String(project.project_name), String(project.size), num(project, "cost"), refund],
    );
    return refund;
  });
}

export async function advanceCareerDevelopmentProjectsAfterRace(
  database: IDatabase,
  input: { readonly careerId: string; readonly tier: TierId; readonly season: number; readonly round: number },
): Promise<DevelopmentCompletion[]> {
  const activeProjects = await database.query(
    "SELECT * FROM development_projects WHERE career_id = ? AND status = 'active' ORDER BY start_round, project_instance_id;",
    [input.careerId],
  );
  const completed: DevelopmentCompletion[] = [];
  const means = await divisionMeans(database, input.careerId, input.tier, input.season);
  for (const projectRow of activeProjects) {
    const project = DEVELOPMENT_CATALOG.find((entry) => entry.id === String(projectRow.project_catalog_id));
    if (!project) throw new Error("Project aktif tidak ada di katalog: " + String(projectRow.project_catalog_id));
    const nextProgress = num(projectRow, "progress_races") + 1;
    if (nextProgress + 1e-9 < num(projectRow, "duration_races")) {
      await database.run("UPDATE development_projects SET progress_races = ?, updated_at = CURRENT_TIMESTAMP WHERE project_instance_id = ? AND status = 'active';", [nextProgress, String(projectRow.project_instance_id)]);
      continue;
    }
    const cars = await database.query("SELECT * FROM cars WHERE car_id = ?;", [String(projectRow.car_id)]);
    const car = cars[0];
    if (!car) throw new Error("Mobil project development tidak ditemukan.");
    const teamRows = await database.query("SELECT reliability FROM teams WHERE team_id = ? AND career_id = ?;", [String(projectRow.team_id), input.careerId]);
    if (!teamRows[0]) throw new Error("Tim project development tidak ditemukan.");
    const category = String(projectRow.category);
    const mainKey = attrKey(mainLabel(project), category);
    if (!mainKey) throw new Error("Atribut utama belum memiliki pemetaan database: " + project.mainAttribute);
    const labels = parseSecondaryLabels(project);
    const secondaryKeys = labels.map((label) => ({ label, key: attrKey(label, category) })).filter((item): item is { label: string; key: AttributeKey } => item.key !== null);
    const firstSecondary = secondaryKeys[0];
    const facilityLevel = num((await database.query(
      "SELECT " + facilityColumn(category) + " AS facility_level FROM teams WHERE team_id = ?;",
      [String(projectRow.team_id)],
    ))[0], "facility_level", 1);
    const engineerRows = await database.query(
      "SELECT skill FROM staff WHERE career_id = ? AND team_id = ? AND role = 'Chief Engineer' AND is_free_agent = 0 ORDER BY skill DESC LIMIT 1;",
      [input.careerId, String(projectRow.team_id)],
    );
    if (!engineerRows[0]) throw new Error("Chief Engineer tidak ditemukan saat project selesai.");
    const engineerSkill = num(engineerRows[0], "skill");
    const result = resolveDevelopmentProject({
      projectId: String(projectRow.project_instance_id), tier: input.tier, size: String(projectRow.size) as DevelopmentProjectSize,
      facilityLevel, engineerSkill, developmentEfficiency: 1,
      currentMainAttribute: num(car, mainKey), divisionMeanMainAttribute: num(means, mainKey),
      ...(firstSecondary ? { currentSecondaryAttribute: num(car, firstSecondary.key), divisionMeanSecondaryAttribute: num(means, firstSecondary.key) } : {}),
      category: project.category,
      ...(getSecondaryReliabilityEffect(project.id) ? { secondaryReliabilityEffect: getSecondaryReliabilityEffect(project.id)! } : {}),
      worldSeed: String(projectRow.world_seed),
    });
    const nextCarValues = new Map<AttributeKey, number>();
    if (result.success) {
      if (category === "reliability") {
        if (project.id === "R06") {
          for (const key of RELIABILITY_COLUMNS) nextCarValues.set(key, clampAttribute(num(car, key) + result.reliabilityGain * 0.5));
        } else {
          nextCarValues.set(mainKey, clampAttribute(num(car, mainKey) + result.reliabilityGain));
        }
      } else {
        nextCarValues.set(mainKey, clampAttribute(num(car, mainKey) + result.mainAttributeGain));
      }
      const mainDiminishing = calculateDiminishingReturn(num(car, mainKey), num(means, mainKey));
      const effectiveMainGain = category === "reliability" ? result.reliabilityGain : result.mainAttributeGain;
      for (const secondary of secondaryKeys) {
        if (secondary.key.endsWith("_reliability")) {
          const target = reliabilityTarget(secondary.label, category);
          if (target) {
            const secondaryGain = category === "reliability"
              ? result.reliabilityGain * 0.5
              : result.mainAttributeGain * 0.5 * calculateDiminishingReturn(num(car, secondary.key), num(means, secondary.key)) / mainDiminishing;
            nextCarValues.set(target.key, clampAttribute(num(car, target.key) + target.sign * secondaryGain));
          }
        } else {
          const secondaryGain = effectiveMainGain * 0.5 * calculateDiminishingReturn(num(car, secondary.key), num(means, secondary.key)) / mainDiminishing;
          nextCarValues.set(secondary.key, clampAttribute(num(car, secondary.key) + secondaryGain));
        }
      }
      for (const [key, value] of nextCarValues) {
        await database.run("UPDATE cars SET " + key + " = ? WHERE car_id = ?;", [value, String(car.car_id)]);
      }
      if (result.reliabilityPenalty !== 0) {
        await database.run("UPDATE teams SET reliability = ? WHERE team_id = ?;", [clampAttribute(num(teamRows[0], "reliability") + result.reliabilityPenalty), String(projectRow.team_id)]);
      }
    }
    const status = result.success ? "completed" : "failed";
    const reason = result.success ? null : deterministicFailureReason(String(projectRow.project_instance_id));
    await database.run(
      "UPDATE development_projects SET status = ?, progress_races = duration_races, result_json = ?, completed_season = ?, completed_round = ?, updated_at = CURRENT_TIMESTAMP WHERE project_instance_id = ? AND status = 'active';",
      [status, JSON.stringify(result), input.season, input.round, String(projectRow.project_instance_id)],
    );
    await database.run(
      `INSERT INTO development_history
        (history_id, project_instance_id, career_id, team_id, season, round, project_catalog_id, project_name, size, status, success, reason, cost, refund, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
      ["dev-history_" + String(projectRow.project_instance_id), String(projectRow.project_instance_id), input.careerId,
        String(projectRow.team_id), input.season, input.round, project.id, String(projectRow.project_name), String(projectRow.size),
        status, result.success ? 1 : 0, reason, num(projectRow, "cost"), JSON.stringify(result)],
    );
    completed.push({
      projectInstanceId: String(projectRow.project_instance_id), projectName: String(projectRow.project_name),
      status, success: result.success, reason, result,
    });
  }
  return completed;
}
