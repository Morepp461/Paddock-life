import { SeededRandom } from "./SeededRandom";
import type { TierId } from "./GameConfig";

interface PitStopCommonInput {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly round: number;
  readonly driverId: string;
  readonly stopNumber: number;
}
export type PitStopInput =
  | (PitStopCommonInput & {
      readonly tier: 1 | 2 | 3 | 4;
      readonly pitLaneLengthMeters: number;
      readonly pitLaneSpeedMetersPerSecond: number;
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
    })
  | (PitStopCommonInput & { readonly tier: 5; readonly fixedTotalLossSeconds: number })
  | (PitStopCommonInput & { readonly tier: 6 });

export interface PitStopResult {
  readonly pitLaneSeconds: number;
  readonly stationarySeconds: number;
  readonly crewErrorSeconds: number;
  readonly unsafeReleaseDelaySeconds: number;
  readonly totalLossSeconds: number;
  readonly crewErrorOccurred: boolean;
  readonly unsafeReleaseOccurred: boolean;
}

function validateCommonInput(input: PitStopCommonInput): void {
  if (![input.season, input.round, input.stopNumber].every((value) => Number.isSafeInteger(value) && value >= 1)) {
    throw new RangeError("Season, round, dan stop number harus integer positif.");
  }
  if (!input.driverId.trim()) throw new Error("Driver ID wajib diisi.");
}

function validateStandardPitInput(input: Extract<PitStopInput, { tier: 1 | 2 | 3 | 4 }>): void {
  if (!Number.isFinite(input.pitLaneLengthMeters) || input.pitLaneLengthMeters <= 0) {
    throw new RangeError("Panjang pit lane harus berupa angka positif.");
  }
  if (!Number.isFinite(input.pitLaneSpeedMetersPerSecond) || input.pitLaneSpeedMetersPerSecond <= 0) {
    throw new RangeError("Kecepatan pit lane harus berasal dari konfigurasi positif.");
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
}

/** Document 02, Section 11. All pit timing values are explicit configuration inputs. */
export function simulatePitStop(input: PitStopInput): PitStopResult {
  if (input.tier === 6) throw new Error("Pit stop tidak tersedia untuk Tier 6.");
  validateCommonInput(input);
  if (input.tier === 5) {
    if (!Number.isFinite(input.fixedTotalLossSeconds) || input.fixedTotalLossSeconds < 0) {
      throw new RangeError("Fixed pit loss Tier 5 harus berupa angka non-negatif.");
    }
    return {
      pitLaneSeconds: 0,
      stationarySeconds: 0,
      crewErrorSeconds: 0,
      unsafeReleaseDelaySeconds: 0,
      totalLossSeconds: input.fixedTotalLossSeconds,
      crewErrorOccurred: false,
      unsafeReleaseOccurred: false,
    };
  }

  validateStandardPitInput(input);
  const random = new SeededRandom(hashPitSeed(input));
  const crewErrorOccurred = random.next() < input.crewErrorProbability;
  const unsafeReleaseOccurred = random.next() < input.unsafeReleaseProbability;
  const pitLaneSeconds = input.pitLaneLengthMeters / input.pitLaneSpeedMetersPerSecond;
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

function hashPitSeed(input: PitStopCommonInput): number {
  let hash = 2166136261;
  const key = `${input.worldSeed}|pit|${input.season}|${input.round}|${input.driverId}|${input.stopNumber}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
