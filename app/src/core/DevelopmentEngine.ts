import { calculateDevelopmentProjectCost, type DevelopmentProjectSize, type EconomyTierId } from "./EconomyEngine";
import { hashSeed } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";

export const DEVELOPMENT_PROJECT_CONFIG: Readonly<Record<DevelopmentProjectSize, {
  readonly nominalGain: number;
  readonly durationRaces: number;
  readonly reliabilityGain: number;
  readonly reliabilityPenalty: number;
}>> = {
  minor: { nominalGain: 0.8, durationRaces: 2, reliabilityGain: 2, reliabilityPenalty: 0 },
  standard: { nominalGain: 1.6, durationRaces: 3, reliabilityGain: 4, reliabilityPenalty: -1 },
  major: { nominalGain: 3.2, durationRaces: 5, reliabilityGain: 7, reliabilityPenalty: -3 },
};

export const DEVELOPMENT_SUCCESS_PROBABILITY = 0.7;

const ENGINEER_MULTIPLIER_POINTS = [[20, 0.92], [40, 0.99], [60, 1.06], [80, 1.13], [100, 1.2]] as const;
const FACILITY_POINTS = [
  { level: 1, multiplier: 0.94, varianceMin: 0.815, varianceMax: 1.185, durationReduction: 0.03 },
  { level: 3, multiplier: 1.02, varianceMin: 0.845, varianceMax: 1.155, durationReduction: 0.09 },
  { level: 5, multiplier: 1.10, varianceMin: 0.875, varianceMax: 1.125, durationReduction: 0.15 },
  { level: 7, multiplier: 1.18, varianceMin: 0.905, varianceMax: 1.095, durationReduction: 0.21 },
  { level: 10, multiplier: 1.30, varianceMin: 0.95, varianceMax: 1.05, durationReduction: 0.30 },
] as const;

function interpolate(points: readonly (readonly [number, number])[], value: number): number {
  if (value <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (value <= current[0]) {
      const fraction = (value - previous[0]) / (current[0] - previous[0]);
      return previous[1] + (current[1] - previous[1]) * fraction;
    }
  }
  return points[points.length - 1][1];
}

function facilityAtLevel(level: number) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 10) throw new RangeError("Level fasilitas harus integer 1–10.");
  if (level <= 1) return FACILITY_POINTS[0];
  for (let index = 1; index < FACILITY_POINTS.length; index += 1) {
    const previous = FACILITY_POINTS[index - 1];
    const current = FACILITY_POINTS[index];
    if (level <= current.level) {
      const fraction = (level - previous.level) / (current.level - previous.level);
      return {
        level,
        multiplier: previous.multiplier + (current.multiplier - previous.multiplier) * fraction,
        varianceMin: previous.varianceMin + (current.varianceMin - previous.varianceMin) * fraction,
        varianceMax: previous.varianceMax + (current.varianceMax - previous.varianceMax) * fraction,
        durationReduction: previous.durationReduction + (current.durationReduction - previous.durationReduction) * fraction,
      };
    }
  }
  return FACILITY_POINTS[FACILITY_POINTS.length - 1];
}

export function calculateEngineerMultiplier(skill: number): number {
  if (!Number.isFinite(skill) || skill < 0 || skill > 100) throw new RangeError("Skill engineer harus berada pada rentang 0–100.");
  return interpolate(ENGINEER_MULTIPLIER_POINTS, skill);
}

export function calculateDiminishingReturn(currentAttribute: number, divisionMean: number): number {
  if (![currentAttribute, divisionMean].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
    throw new RangeError("Atribut saat ini dan rata-rata divisi harus berada pada rentang 0–100.");
  }
  return Math.max(0.4, Math.min(1.2, 1 - (currentAttribute - divisionMean) / 60));
}

export function calculateCancellationRefund(cost: number, progress: number): number {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("Biaya atau progress pembatalan tidak valid.");
  }
  return Math.round(cost * (1 - progress) * 0.5);
}

export interface DevelopmentProjectInput {
  readonly projectId: string;
  readonly tier: EconomyTierId;
  readonly size: DevelopmentProjectSize;
  readonly facilityLevel: number;
  readonly engineerSkill: number;
  /** Explicit game_config input; no undocumented efficiency multiplier is guessed. */
  readonly developmentEfficiency: number;
  readonly currentMainAttribute: number;
  readonly divisionMeanMainAttribute: number;
  readonly currentSecondaryAttribute?: number;
  readonly divisionMeanSecondaryAttribute?: number;
  readonly category: "aero" | "engine" | "chassis" | "reliability";
  readonly secondaryReliabilityEffect?: "positive" | "negative";
  readonly worldSeed: string | number;
}

export interface DevelopmentProjectResult {
  readonly projectId: string;
  readonly size: DevelopmentProjectSize;
  readonly cost: number;
  readonly success: boolean;
  readonly variance: number | null;
  readonly mainAttributeGain: number;
  readonly secondaryAttributeGain: number;
  readonly reliabilityGain: number;
  readonly reliabilityPenalty: number;
  readonly secondaryReliabilityDelta: number;
  readonly effectiveDurationRaces: number;
  readonly successProbability: number;
}

export function resolveDevelopmentProject(input: DevelopmentProjectInput): DevelopmentProjectResult {
  if (!input.projectId.trim()) throw new Error("Project ID wajib diisi.");
  if (!Number.isFinite(input.developmentEfficiency) || input.developmentEfficiency <= 0 || input.developmentEfficiency > 2) {
    throw new RangeError("DevelopmentEfficiency harus berada pada rentang (0, 2].");
  }
  if ((input.currentSecondaryAttribute === undefined) !== (input.divisionMeanSecondaryAttribute === undefined)) {
    throw new Error("Atribut sekunder dan rata-rata sekunder harus diberikan bersama.");
  }

  const config = DEVELOPMENT_PROJECT_CONFIG[input.size];
  const facility = facilityAtLevel(input.facilityLevel);
  const engineerMultiplier = calculateEngineerMultiplier(input.engineerSkill);
  const mainDiminishingReturn = calculateDiminishingReturn(input.currentMainAttribute, input.divisionMeanMainAttribute);
  const secondaryDiminishingReturn = input.currentSecondaryAttribute === undefined
    ? 0
    : calculateDiminishingReturn(input.currentSecondaryAttribute, input.divisionMeanSecondaryAttribute!);
  const random = new SeededRandom(hashSeed([input.worldSeed, input.projectId, input.size, "development"]));
  const success = random.next() < DEVELOPMENT_SUCCESS_PROBABILITY;
  const variance = success ? facility.varianceMin + random.next() * (facility.varianceMax - facility.varianceMin) : null;
  const effectiveGain = success
    ? config.nominalGain * engineerMultiplier * facility.multiplier * input.developmentEfficiency * mainDiminishingReturn * variance!
    : 0;
  const secondaryGain = success && input.currentSecondaryAttribute !== undefined
    ? config.nominalGain * engineerMultiplier * facility.multiplier * input.developmentEfficiency * secondaryDiminishingReturn * variance! * 0.5
    : 0;
  const reliabilityProject = input.category === "reliability";
  const reliabilityGain = success && reliabilityProject ? config.reliabilityGain : 0;
  const reliabilityPenalty = success && !reliabilityProject ? config.reliabilityPenalty : 0;
  const secondaryReliabilityDelta = success && input.secondaryReliabilityEffect !== undefined
    ? secondaryAttributeGain * (input.secondaryReliabilityEffect === "positive" ? 1 : -1)
    : 0;

  return {
    projectId: input.projectId,
    size: input.size,
    cost: calculateDevelopmentProjectCost(input.tier, input.size),
    success,
    variance,
    mainAttributeGain: effectiveGain,
    secondaryAttributeGain: secondaryGain,
    reliabilityGain,
    reliabilityPenalty,
    secondaryReliabilityDelta,
    effectiveDurationRaces: config.durationRaces * (1 - facility.durationReduction),
    successProbability: DEVELOPMENT_SUCCESS_PROBABILITY,
  };
}
