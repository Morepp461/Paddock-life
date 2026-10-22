import { SeededRandom } from "./SeededRandom";
import type { TrackCondition } from "./TyreEngine";

export interface WeatherState {
  readonly condition: TrackCondition;
  /** Number of consecutive laps in the current rain period. */
  readonly rainLapsElapsed: number;
}

export type WeatherTransitionMatrix = Readonly<Record<TrackCondition, Readonly<Record<TrackCondition, number>>>>;

export const TRACK_GRIP_MULTIPLIER: Readonly<Record<TrackCondition, number>> = {
  dry: 1,
  damp: 0.9,
  wet: 0.8,
  "heavy-wet": 0.7,
};

const CONDITIONS: readonly TrackCondition[] = ["dry", "damp", "wet", "heavy-wet"];
export const MINIMUM_RAIN_DURATION_LAPS = 6;

function validateTransitionMatrix(matrix: WeatherTransitionMatrix): void {
  for (const condition of CONDITIONS) {
    const row = matrix[condition];
    const values = CONDITIONS.map((next) => row[next]);
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
        Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.000001) {
      throw new RangeError(`Probabilitas transisi cuaca untuk ${condition} harus berjumlah 1.`);
    }
  }
}

/** One Markov transition. The transition matrix is configuration, not guessed here. */
export function advanceWeather(
  state: WeatherState,
  matrix: WeatherTransitionMatrix,
  random: SeededRandom,
): WeatherState {
  validateTransitionMatrix(matrix);
  if (!Number.isSafeInteger(state.rainLapsElapsed) || state.rainLapsElapsed < 0) {
    throw new RangeError("Durasi hujan harus berupa integer non-negatif.");
  }

  const roll = random.next();
  let cumulative = 0;
  let nextCondition: TrackCondition = state.condition;
  for (const candidate of CONDITIONS) {
    cumulative += matrix[state.condition][candidate];
    if (roll < cumulative) {
      nextCondition = candidate;
      break;
    }
  }

  const currentlyRaining = state.condition !== "dry";
  const rainPeriodHasMinimumDuration = currentlyRaining && state.rainLapsElapsed < MINIMUM_RAIN_DURATION_LAPS;
  if (rainPeriodHasMinimumDuration && nextCondition === "dry") nextCondition = state.condition;

  if (nextCondition === "dry") return { condition: "dry", rainLapsElapsed: 0 };
  const rainLapsElapsed = currentlyRaining ? state.rainLapsElapsed + 1 : 1;
  return { condition: nextCondition, rainLapsElapsed };
}

/** Document 02, Section 6. Adaptation is only applied in wet conditions. */
export function calculateWeatherDeltaSeconds(input: {
  readonly condition: TrackCondition;
  readonly weatherAdaptation: number;
  readonly tyreMismatchDeltaSeconds: number;
}): number {
  if (!Number.isFinite(input.weatherAdaptation) || input.weatherAdaptation < 0 || input.weatherAdaptation > 100) {
    throw new RangeError("WeatherAdaptation harus berada pada rentang 0–100.");
  }
  if (!Number.isFinite(input.tyreMismatchDeltaSeconds)) throw new RangeError("Tyre mismatch delta harus valid.");
  const gripLossSeconds = (1 - TRACK_GRIP_MULTIPLIER[input.condition]) * 6;
  const adaptationDelta = input.condition === "dry" ? 0 : input.weatherAdaptation * 0.02;
  return gripLossSeconds - adaptationDelta + input.tyreMismatchDeltaSeconds;
}

export function createWeatherRandom(
  worldSeed: string | number,
  season: number,
  round: number,
  lap: number,
): SeededRandom {
  if (![season, round, lap].every((value) => Number.isSafeInteger(value) && value >= 1)) {
    throw new RangeError("Season, round, dan lap harus integer positif.");
  }
  let hash = 2166136261;
  const key = `${worldSeed}|weather|${season}|${round}|${lap}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return new SeededRandom(hash >>> 0);
}
