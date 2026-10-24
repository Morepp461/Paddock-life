import { SeededRandom } from "./SeededRandom";
import type { TierId } from "./GameConfig";

export interface PitStopInput {
  readonly tier: TierId;
  readonly pitLaneLengthMeters: number;
  /** Loaded from game_config; never silently hardcoded by the engine. */
  readonly pitLaneSpeedMetersPerSecond: number;
  /** Fraction of pit-lane time removed during a configured SC/VSC period. */
  readonly pitLaneTimeReduction?: number;
  readonly mechanicSkillAverage: number;
  /** Mean stationary time from the tier's game_config entry. */
  readonly stationarySeconds: number;
  /** Seeded jitter already sampled from the tier's documented ± range. */
  readonly stationaryJitterSeconds: number;
  /** Configured probability in the documented 2–10% range. */
  readonly crewErrorProbability: number;
  /** Seeded jitter applied to the mechanic-skill error base. */
  readonly crewErrorJitterSeconds: number;
  /** Configured probability in the documented 1–5% range. */
  readonly unsafeReleaseProbability: number;
  readonly unsafeReleaseDelaySeconds: number;
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly driverId: string;
  readonly stopNumber: number;
}

export interface PitStopResult {
  readonly pitLaneSeconds: number;
  readonly stationarySeconds: number;
  readonly crewErrorSeconds: number;
  readonly unsafeReleaseDelaySeconds: number;
  readonly totalLossSeconds: number;
  readonly crewErrorOccurred: boolean;
  readonly unsafeReleaseOccurred: boolean;
}

function validateInput(input: PitStopInput): void {
  if (!Number.isFinite(input.pitLaneLengthMeters) || input.pitLaneLengthMeters <= 0) {
    throw new RangeError("Panjang pit lane harus berupa angka positif.");
  }
  if (!Number.isFinite(input.pitLaneSpeedMetersPerSecond) || input.pitLaneSpeedMetersPerSecond <= 0) {
    throw new RangeError("Kecepatan pit lane harus berasal dari konfigurasi positif.");
  }
  const pitLaneTimeReduction = input.pitLaneTimeReduction ?? 0;
  if (!Number.isFinite(pitLaneTimeReduction) || pitLaneTimeReduction < 0 || pitLaneTimeReduction > 1) {
    throw new RangeError("Pengurangan waktu pit lane harus berada pada rentang 0–1.");
  }
  if (!Number.isFinite(input.mechanicSkillAverage) || input.mechanicSkillAverage < 0 || input.mechanicSkillAverage > 100) {
    throw new RangeError("Skill mekanik harus berada pada rentang 0–100.");
  }
  for (const [name, value] of [
    ["stationarySeconds", input.stationarySeconds],
    ["stationaryJitterSeconds", input.stationaryJitterSeconds],
    ["crewErrorJitterSeconds", input.crewErrorJitterSeconds],
    ["unsafeReleaseDelaySeconds", input.unsafeReleaseDelaySeconds],
  ] as const) {
    if (!Number.isFinite(value) || (name !== "stationaryJitterSeconds" && name !== "crewErrorJitterSeconds" && value < 0)) {
      throw new RangeError(`${name} tidak valid.`);
    }
  }
  if (input.stationarySeconds + input.stationaryJitterSeconds < 0) {
    throw new RangeError("Waktu stationary setelah jitter tidak boleh negatif.");
  }
  if (!Number.isFinite(input.crewErrorProbability) || input.crewErrorProbability < 0.02 || input.crewErrorProbability > 0.1) {
    throw new RangeError("Peluang kesalahan pit crew harus berada pada rentang 2–10%.");
  }
  if (!Number.isFinite(input.unsafeReleaseProbability) || input.unsafeReleaseProbability < 0.01 || input.unsafeReleaseProbability > 0.05) {
    throw new RangeError("Peluang unsafe release harus berada pada rentang 1–5%.");
  }
  if (![input.season, input.round, input.stopNumber].every((value) => Number.isSafeInteger(value) && value >= 1)) {
    throw new RangeError("Season, round, dan stop number harus integer positif.");
  }
  if (!input.driverId.trim()) throw new Error("Driver ID wajib diisi.");
}

/** Document 02, Section 11. Probabilities and tier stationary parameters come from game_config. */
export function simulatePitStop(input: PitStopInput): PitStopResult {
  validateInput(input);
  if (input.tier === 6) throw new Error("Pit stop tidak tersedia untuk Tier 6.");

  if (input.tier === 5) {
    return {
      pitLaneSeconds: 20,
      stationarySeconds: 0,
      crewErrorSeconds: 0,
      unsafeReleaseDelaySeconds: 0,
      totalLossSeconds: 20,
      crewErrorOccurred: false,
      unsafeReleaseOccurred: false,
    };
  }

  const random = new SeededRandom(hashPitSeed(input));
  const crewErrorOccurred = random.next() < input.crewErrorProbability;
  const unsafeReleaseOccurred = random.next() < input.unsafeReleaseProbability;
  const pitLaneSeconds = (input.pitLaneLengthMeters / input.pitLaneSpeedMetersPerSecond) * (1 - pitLaneTimeReduction);
  const stationarySeconds = input.stationarySeconds + input.stationaryJitterSeconds;
  const crewErrorBaseSeconds = Math.max(0, (100 - input.mechanicSkillAverage) * 0.03 + input.crewErrorJitterSeconds);
  const crewErrorSeconds = crewErrorOccurred ? crewErrorBaseSeconds : 0;
  const unsafeReleaseDelaySeconds = unsafeReleaseOccurred ? input.unsafeReleaseDelaySeconds : 0;
  return {
    pitLaneSeconds,
    stationarySeconds,
    crewErrorSeconds,
    unsafeReleaseDelaySeconds,
    totalLossSeconds: pitLaneSeconds + stationarySeconds + crewErrorSeconds + unsafeReleaseDelaySeconds,
    crewErrorOccurred,
    unsafeReleaseOccurred,
  };
}

function hashPitSeed(input: PitStopInput): number {
  let hash = 2166136261;
  const key = `${input.worldSeed}|pit|${input.season}|${input.round}|${input.driverId}|${input.stopNumber}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
