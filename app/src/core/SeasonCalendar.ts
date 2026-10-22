import { calculateRaceLapCount, TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed } from "./RandomDistributions";
import { SeededRandom } from "./SeededRandom";

export interface CalendarCircuit {
  readonly id: string;
  readonly name: string;
  readonly lengthKm: number;
  readonly estimatedLapSeconds: number;
  readonly rainProbability: number;
  readonly safetyCarProbability: number;
}

export interface ScheduledRace {
  readonly season: number;
  readonly round: number;
  readonly circuitId: string;
  readonly circuitName: string;
  readonly totalLaps: number;
  readonly hasSprint: boolean;
  readonly rainProbability: number;
  readonly safetyCarProbability: number;
}

function shuffle<T>(items: readonly T[], random: SeededRandom): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random.next() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function validateCircuits(circuits: readonly CalendarCircuit[]): void {
  if (circuits.length < 1) throw new RangeError("Pool sirkuit tidak boleh kosong.");
  const ids = new Set<string>();
  for (const circuit of circuits) {
    if (!circuit.id.trim() || !circuit.name.trim() || ids.has(circuit.id)) {
      throw new Error("Data sirkuit kalender memiliki ID kosong atau duplikat.");
    }
    if (!Number.isFinite(circuit.lengthKm) || circuit.lengthKm <= 0 ||
        !Number.isFinite(circuit.estimatedLapSeconds) || circuit.estimatedLapSeconds <= 0 ||
        !Number.isFinite(circuit.rainProbability) || circuit.rainProbability < 0 || circuit.rainProbability > 1 ||
        !Number.isFinite(circuit.safetyCarProbability) || circuit.safetyCarProbability < 0 || circuit.safetyCarProbability > 1) {
      throw new RangeError(`Data kalender sirkuit tidak valid: ${circuit.id}.`);
    }
    ids.add(circuit.id);
  }
}

/** Generates a reproducible season schedule without repeating a circuit within the season. */
export function generateSeasonCalendar(input: {
  readonly worldSeed: string | number;
  readonly season: number;
  readonly tier: TierId;
  readonly circuits: readonly CalendarCircuit[];
}): readonly ScheduledRace[] {
  if (!Number.isSafeInteger(input.season) || input.season < 1) throw new RangeError("Season harus integer positif.");
  validateCircuits(input.circuits);
  const config = TIER_CONFIG[input.tier];
  if (config.roundsPerSeason > input.circuits.length) {
    throw new RangeError("Pool sirkuit tidak cukup untuk jumlah round musim ini.");
  }
  const random = new SeededRandom(hashSeed([input.worldSeed, input.season, input.tier, "calendar"]));
  const selected = shuffle(input.circuits, random).slice(0, config.roundsPerSeason);
  const sprintCount = config.sprintRacesPerSeason;
  const sprintRounds = new Set(
    shuffle(Array.from({ length: config.roundsPerSeason }, (_, index) => index + 1), random).slice(0, sprintCount),
  );

  return selected.map((circuit, index) => ({
    season: input.season,
    round: index + 1,
    circuitId: circuit.id,
    circuitName: circuit.name,
    totalLaps: calculateRaceLapCount(circuit.lengthKm, input.tier),
    hasSprint: sprintRounds.has(index + 1),
    rainProbability: circuit.rainProbability,
    safetyCarProbability: circuit.safetyCarProbability,
  }));
}
