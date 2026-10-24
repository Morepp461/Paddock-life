import { SeededRandom } from "./SeededRandom";
import type { TierId } from "./GameConfig";

export interface PitStopInput {
  readonly tier: TierId;
  readonly pitLaneLengthMeters: number;
  /** Loaded from game_config; never silently hardcoded by the engine. */
  readonly pitLaneSpeedMetersPerSecond?: number;
  /** Fraction of pit-lane time removed during a configured SC/VSC period. */
  readonly pitLaneTimeReduction?: number;
  readonly mechanicSkillAverage?: number;
  /** Mean stationary time from the tier's game_config entry. */
  readonly stationarySeconds?: number;
  /** Seeded jitter already sampled from the tier's documented ± range. */
  readonly stationaryJitterSeconds?: number;
  /** Configured probability in the documented 2–10% range. */
  readonly crewErrorProbability?: number;
  /** Seeded jitter applied to the mechanic-skill error base. */
  readonly crewErrorJitterSeconds?: number;
  /** Configured probability in the documented 1–5% range. */
  readonly unsafeReleaseProbability?: number;
  readonly unsafeReleaseDelaySeconds?: number;
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

function validateIdentity(input: PitStopInput): void {
  if (![input.season, input.round, input.stopNumber].every((value) => Number.isSafeInteger(value) && value >= 1)) {
    throw new RangeError("Season, round, dan stop number harus integer positif.");
  }
  if (!input.driverId.trim()) throw new Error("Driver ID wajib diisi.");
}

function validateConfiguredPitInput(input: PitStopInput): void {
  const required: ReadonlyArray<[string, number | undefined]> = [
    ["pitLaneLengthMeters", input.pitLaneLengthMeters],
    ["pitLaneSpeedMetersPerSecond", input.pitLaneSpeedMetersPerSecond],
    ["mechanicSkillAverage", input.mechanicSkillAverage],
    ["stationarySeconds", input.stationarySeconds],
    ["stationaryJitterSeconds", input.stationaryJitterSeconds],
    ["crewErrorProbability", input.crewErrorProbability],
    ["crewErrorJitterSeconds", input.crewErrorJitterSeconds],
    ["unsafeReleaseProbability", input.unsafeReleaseProbability],
    ["unsafeReleaseDelaySeconds", input.unsafeReleaseDelaySeconds],
  ];
  for (const [name, value] of required) {
    if (value === undefined || !Number.isFinite(value)) throw new Error("Konfigurasi pit wajib belum tersedia: " + name + ".");
  }
  if (input.pitLaneLengthMeters <= 0 || input.pitLaneSpeedMetersPerSecond! <= 0) {
    throw new RangeError("Panjang dan kecepatan pit lane harus positif.");
  }
  if (input.mechanicSkillAverage! < 0 || input.mechanicSkillAverage! > 100) {
    throw new RangeError("Skill mekanik harus berada pada rentang 0–100.");
  }
  if (input.stationarySeconds! + input.stationaryJitterSeconds! < 0) {
    throw new RangeError("Waktu stationary setelah jitter tidak boleh negatif.");
  }
  if (!Number.isFinite(input.pitLaneTimeReduction ?? 0) || (input.pitLaneTimeReduction ?? 0) < 0 || (input.pitLaneTimeReduction ?? 0) > 1) {
    throw new RangeError("Pengurangan waktu pit lane harus berada pada rentang 0–1.");
  }
  if (input.crewErrorProbability! < 0.02 || input.crewErrorProbability! > 0.1) {
    throw new RangeError("Peluang kesalahan pit crew harus berada pada rentang 2–10%.");
  }
  if (input.unsafeReleaseProbability! < 0.01 || input.unsafeReleaseProbability! > 0.05) {
    throw new RangeError("Peluang unsafe release harus berada pada rentang 1–5%.");
  }
}
/** Document 02, Section 11. Probabilities and tier stationary parameters come from game_config. */
export function simulatePitStop(input: PitStopInput): PitStopResult {
  validateIdentity(input);
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

  validateConfiguredPitInput(input);
  const random = new SeededRandom(hashPitSeed(input));
  const crewErrorOccurred = random.next() < input.crewErrorProbability!;
  const unsafeReleaseOccurred = random.next() < input.unsafeReleaseProbability!;
  const pitLaneSeconds = (input.pitLaneLengthMeters / input.pitLaneSpeedMetersPerSecond!) * (1 - (input.pitLaneTimeReduction ?? 0));
  const stationarySeconds = input.stationarySeconds! + input.stationaryJitterSeconds!;
  const crewErrorBaseSeconds = Math.max(0, (100 - input.mechanicSkillAverage!) * 0.03 + input.crewErrorJitterSeconds!);
  const crewErrorSeconds = crewErrorOccurred ? crewErrorBaseSeconds : 0;
  const unsafeReleaseDelaySeconds = unsafeReleaseOccurred ? input.unsafeReleaseDelaySeconds! : 0;
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
