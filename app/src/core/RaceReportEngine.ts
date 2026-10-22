export type RaceReportCauseType = "pace" | "tyre" | "strategy" | "reliability" | "pit-loss";

export interface RaceReportCause {
  readonly type: RaceReportCauseType;
  /** Positive values mean time lost; negative values mean time gained. */
  readonly secondsLost: number;
  readonly explanation: string;
}

export interface RaceReportInput {
  readonly actualRaceTimeSeconds: number;
  readonly optimalRaceTimeSeconds: number;
  readonly causes: readonly RaceReportCause[];
}

export interface RaceReport {
  readonly actualRaceTimeSeconds: number;
  readonly optimalRaceTimeSeconds: number;
  readonly strategyScore: number;
  readonly strategyDeficitSeconds: number;
  readonly mainCauses: readonly RaceReportCause[];
}

const REQUIRED_CAUSES: readonly RaceReportCauseType[] = ["pace", "tyre", "strategy", "reliability", "pit-loss"];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Document 02, Section 3. The report explains five documented performance causes. */
export function buildRaceReport(input: RaceReportInput): RaceReport {
  if (!Number.isFinite(input.actualRaceTimeSeconds) || input.actualRaceTimeSeconds <= 0 ||
      !Number.isFinite(input.optimalRaceTimeSeconds) || input.optimalRaceTimeSeconds <= 0) {
    throw new RangeError("Actual dan optimal race time harus berupa angka positif.");
  }
  const byType = new Map<RaceReportCauseType, RaceReportCause>();
  for (const cause of input.causes) {
    if (!Number.isFinite(cause.secondsLost) || !cause.explanation.trim()) {
      throw new Error("Penyebab race report harus memiliki waktu valid dan penjelasan.");
    }
    if (byType.has(cause.type)) throw new Error(`Penyebab duplikat: ${cause.type}.`);
    byType.set(cause.type, cause);
  }
  if (byType.size !== REQUIRED_CAUSES.length || REQUIRED_CAUSES.some((type) => !byType.has(type))) {
    throw new Error("Race report harus mencakup lima penyebab: pace, tyre, strategy, reliability, dan pit-loss.");
  }
  const mainCauses = REQUIRED_CAUSES.map((type) => byType.get(type)!)
    .sort((left, right) => right.secondsLost - left.secondsLost || left.type.localeCompare(right.type));
  const strategyDeficitSeconds = input.actualRaceTimeSeconds - input.optimalRaceTimeSeconds;
  return {
    actualRaceTimeSeconds: input.actualRaceTimeSeconds,
    optimalRaceTimeSeconds: input.optimalRaceTimeSeconds,
    strategyScore: clampScore(50 - strategyDeficitSeconds * 4),
    strategyDeficitSeconds,
    mainCauses,
  };
}
