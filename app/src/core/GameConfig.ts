/**
 * Canonical values transcribed from the final project documents.
 * Sources: 01_Division_Ruleset_v1, 02_Simulation_Rules_Addendum_v1,
 * and 06_Economy_Spec_v1. Do not tune these values without simulation review.
 */
export type TierId = 1 | 2 | 3 | 4 | 5 | 6;
export type DryTyreCompound = "soft" | "medium" | "hard";
export type WetTyreCompound = "intermediate" | "wet";
export type QualifyingFormat = "single-lap" | "10-minute" | "15-minute" | "q1-24-12-q2" | "q1-24-18-q2-18-12-q3";

export interface TierConfig {
  readonly id: TierId;
  readonly name: string;
  readonly paceFactor: number;
  readonly raceDistanceFactor: number;
  readonly roundsPerSeason: number;
  readonly requiredBudget: number;
  readonly referenceDriverOverall: number;
  readonly referenceCarScore: number;
  readonly driverAge: { readonly min: number; readonly max: number };
  readonly tyreWearMultiplier: number;
  readonly incidentMultiplier: number;
  readonly reliabilityMultiplier: number;
  readonly allowedDryCompounds: readonly DryTyreCompound[];
  readonly allowedWetCompounds: readonly WetTyreCompound[];
  readonly practiceSessions: number;
  readonly practiceProgramEnabled: boolean;
  readonly qualifyingFormat: QualifyingFormat;
  readonly sprintRacesPerSeason: number;
  readonly gridSize: number;
  readonly features: {
    readonly aero: boolean;
    readonly drs: boolean;
    readonly pitStopAllowed: boolean;
    readonly scheduledPitStop: boolean;
    readonly emergencyPitStop: boolean;
    readonly safetyCar: boolean;
    readonly vsc: boolean;
    readonly teamOrders: boolean;
    readonly visibleInCareerDivisionPicker: boolean;
  };
}

export const TIER_CONFIG: Readonly<Record<TierId, TierConfig>> = {
  1: {
    id: 1, name: "Caleris World Championship", paceFactor: 1.0, raceDistanceFactor: 1.0,
    roundsPerSeason: 24,
    requiredBudget: 248_000_000, referenceDriverOverall: 76, referenceCarScore: 74,
    driverAge: { min: 18, max: 45 },
    tyreWearMultiplier: 1, incidentMultiplier: 0.95, reliabilityMultiplier: 1,
    allowedDryCompounds: ["soft", "medium", "hard"], allowedWetCompounds: ["intermediate", "wet"],
    practiceSessions: 1, practiceProgramEnabled: true,
    qualifyingFormat: "q1-24-18-q2-18-12-q3", sprintRacesPerSeason: 8, gridSize: 24,
    features: { aero: true, drs: true, pitStopAllowed: true, scheduledPitStop: true, emergencyPitStop: true, safetyCar: true, vsc: true, teamOrders: true, visibleInCareerDivisionPicker: true },
  },
  2: {
    id: 2, name: "Elite Series", paceFactor: 0.96, raceDistanceFactor: 0.85,
    roundsPerSeason: 24,
    requiredBudget: 98_000_000, referenceDriverOverall: 68, referenceCarScore: 66,
    driverAge: { min: 17, max: 25 },
    tyreWearMultiplier: 1, incidentMultiplier: 1, reliabilityMultiplier: 0.95,
    allowedDryCompounds: ["soft", "medium", "hard"], allowedWetCompounds: ["intermediate", "wet"],
    practiceSessions: 1, practiceProgramEnabled: true,
    qualifyingFormat: "q1-24-18-q2-18-12-q3", sprintRacesPerSeason: 6, gridSize: 24,
    features: { aero: true, drs: true, pitStopAllowed: true, scheduledPitStop: true, emergencyPitStop: true, safetyCar: true, vsc: true, teamOrders: true, visibleInCareerDivisionPicker: true },
  },
  3: {
    id: 3, name: "Rising Series", paceFactor: 0.90, raceDistanceFactor: 0.70,
    roundsPerSeason: 18,
    requiredBudget: 38_000_000, referenceDriverOverall: 60, referenceCarScore: 58,
    driverAge: { min: 16, max: 19 },
    tyreWearMultiplier: 0.9, incidentMultiplier: 1.05, reliabilityMultiplier: 0.85,
    allowedDryCompounds: ["soft", "medium", "hard"], allowedWetCompounds: ["intermediate", "wet"],
    practiceSessions: 1, practiceProgramEnabled: true,
    qualifyingFormat: "q1-24-12-q2", sprintRacesPerSeason: 0, gridSize: 24,
    features: { aero: true, drs: true, pitStopAllowed: true, scheduledPitStop: true, emergencyPitStop: true, safetyCar: true, vsc: true, teamOrders: true, visibleInCareerDivisionPicker: true },
  },
  4: {
    id: 4, name: "Challenger Series", paceFactor: 0.84, raceDistanceFactor: 0.55,
    roundsPerSeason: 12,
    requiredBudget: 15_000_000, referenceDriverOverall: 52, referenceCarScore: 50,
    driverAge: { min: 15, max: 18 },
    tyreWearMultiplier: 0.75, incidentMultiplier: 1.15, reliabilityMultiplier: 0.7,
    allowedDryCompounds: ["medium", "hard"], allowedWetCompounds: ["intermediate", "wet"],
    practiceSessions: 1, practiceProgramEnabled: true,
    qualifyingFormat: "15-minute", sprintRacesPerSeason: 0, gridSize: 24,
    features: { aero: true, drs: false, pitStopAllowed: true, scheduledPitStop: false, emergencyPitStop: true, safetyCar: true, vsc: true, teamOrders: false, visibleInCareerDivisionPicker: true },
  },
  5: {
    id: 5, name: "Rookie Kart Series", paceFactor: 0.70, raceDistanceFactor: 0.40,
    roundsPerSeason: 10,
    requiredBudget: 6_000_000, referenceDriverOverall: 40, referenceCarScore: 38,
    driverAge: { min: 10, max: 14 },
    tyreWearMultiplier: 0.5, incidentMultiplier: 1.3, reliabilityMultiplier: 0.4,
    allowedDryCompounds: ["hard"], allowedWetCompounds: ["wet"],
    practiceSessions: 1, practiceProgramEnabled: false,
    qualifyingFormat: "10-minute", sprintRacesPerSeason: 0, gridSize: 24,
    features: { aero: false, drs: false, pitStopAllowed: true, scheduledPitStop: false, emergencyPitStop: true, safetyCar: false, vsc: false, teamOrders: false, visibleInCareerDivisionPicker: true },
  },
  6: {
    id: 6, name: "Regional Karting League", paceFactor: 0.60, raceDistanceFactor: 0.20,
    roundsPerSeason: 8,
    requiredBudget: 3_000_000, referenceDriverOverall: 32, referenceCarScore: 30,
    driverAge: { min: 8, max: 11 },
    tyreWearMultiplier: 0.4, incidentMultiplier: 1.4, reliabilityMultiplier: 0.3,
    allowedDryCompounds: ["hard"], allowedWetCompounds: ["wet"],
    practiceSessions: 0, practiceProgramEnabled: false,
    qualifyingFormat: "single-lap", sprintRacesPerSeason: 0, gridSize: 24,
    features: { aero: false, drs: false, pitStopAllowed: false, scheduledPitStop: false, emergencyPitStop: false, safetyCar: false, vsc: false, teamOrders: false, visibleInCareerDivisionPicker: false },
  },
} as const;

export const SIMULATION_CONFIG = {
  minimumRaceLaps: 8,
  referenceRaceDistanceKm: 305,
  referenceLapSeconds: 90,
  carDeltaSecondsPerPoint: 0.045,
  driverDeltaSecondsPerPoint: 0.030,
  setupDeltaSecondsPerPoint: 0.040,
} as const;

/** Document 01: round up the tier-adjusted 305 km distance, with an 8-lap floor. */
export function calculateRaceLapCount(circuitLengthKm: number, tier: TierId): number {
  if (!Number.isFinite(circuitLengthKm) || circuitLengthKm <= 0) {
    throw new RangeError("Panjang sirkuit harus berupa angka positif yang valid.");
  }
  const distanceKm = SIMULATION_CONFIG.referenceRaceDistanceKm * TIER_CONFIG[tier].raceDistanceFactor;
  return Math.max(SIMULATION_CONFIG.minimumRaceLaps, Math.ceil(distanceKm / circuitLengthKm));
}

export function calculateBaseLapSeconds(estimatedCircuitLapSeconds: number, tier: TierId): number {
  if (!Number.isFinite(estimatedCircuitLapSeconds) || estimatedCircuitLapSeconds <= 0) {
    throw new RangeError("Estimasi waktu lap sirkuit harus berupa angka positif yang valid.");
  }
  return estimatedCircuitLapSeconds / TIER_CONFIG[tier].paceFactor;
}

export interface LapPerformanceScores {
  readonly carScore: number;
  readonly driverScore: number;
  readonly setupScore: number;
}

export interface LapReferenceScores {
  readonly carScore: number;
  readonly driverScore: number;
  readonly setupScore: number;
}

/** Document 02: score deltas are scaled by estimated lap duration / 90 seconds. */
export function calculatePerformanceDeltaSeconds(
  estimatedCircuitLapSeconds: number,
  scores: LapPerformanceScores,
  references: LapReferenceScores,
): number {
  if (!Number.isFinite(estimatedCircuitLapSeconds) || estimatedCircuitLapSeconds <= 0) {
    throw new RangeError("Estimasi waktu lap sirkuit harus berupa angka positif yang valid.");
  }
  const scale = estimatedCircuitLapSeconds / SIMULATION_CONFIG.referenceLapSeconds;
  return (
    (references.carScore - scores.carScore) * SIMULATION_CONFIG.carDeltaSecondsPerPoint +
    (references.driverScore - scores.driverScore) * SIMULATION_CONFIG.driverDeltaSecondsPerPoint +
    (references.setupScore - scores.setupScore) * SIMULATION_CONFIG.setupDeltaSecondsPerPoint
  ) * scale;
}
