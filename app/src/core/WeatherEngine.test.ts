import { describe, expect, it } from "vitest";
import { SeededRandom } from "./SeededRandom";
import {
  advanceWeather,
  calculateWeatherDeltaSeconds,
  createWeatherRandom,
  MINIMUM_RAIN_DURATION_LAPS,
  TRACK_GRIP_MULTIPLIER,
  type WeatherTransitionMatrix,
} from "./WeatherEngine";

const alwaysRainAfterDry: WeatherTransitionMatrix = {
  dry: { dry: 0, damp: 1, wet: 0, "heavy-wet": 0 },
  damp: { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
  wet: { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
  "heavy-wet": { dry: 1, damp: 0, wet: 0, "heavy-wet": 0 },
};

describe("weather transition and lap delta", () => {
  it("uses configured Markov probabilities and enforces six rain laps minimum", () => {
    let state = advanceWeather({ condition: "dry", rainLapsElapsed: 0 }, alwaysRainAfterDry, new SeededRandom(1));
    expect(state).toEqual({ condition: "damp", rainLapsElapsed: 1 });
    for (let lap = 2; lap <= MINIMUM_RAIN_DURATION_LAPS; lap += 1) {
      state = advanceWeather(state, alwaysRainAfterDry, new SeededRandom(lap));
      expect(state.condition).not.toBe("dry");
      expect(state.rainLapsElapsed).toBe(lap);
    }
    state = advanceWeather(state, alwaysRainAfterDry, new SeededRandom(99));
    expect(state).toEqual({ condition: "dry", rainLapsElapsed: 0 });
  });

  it("calculates source weather delta and only applies adaptation when wet", () => {
    expect(TRACK_GRIP_MULTIPLIER).toEqual({ dry: 1, damp: 0.9, wet: 0.8, "heavy-wet": 0.7 });
    expect(calculateWeatherDeltaSeconds({ condition: "dry", weatherAdaptation: 100, tyreMismatchDeltaSeconds: 6 })).toBe(6);
    expect(calculateWeatherDeltaSeconds({ condition: "wet", weatherAdaptation: 50, tyreMismatchDeltaSeconds: -3 })).toBeCloseTo(-1);
    expect(calculateWeatherDeltaSeconds({ condition: "heavy-wet", weatherAdaptation: 0, tyreMismatchDeltaSeconds: 4 })).toBeCloseTo(5.8);
  });

  it("derives repeatable weather RNG from world, season, round, and lap", () => {
    expect(createWeatherRandom("seed", 1, 2, 3).next()).toBe(createWeatherRandom("seed", 1, 2, 3).next());
    expect(createWeatherRandom("seed", 1, 2, 3).next()).not.toBe(createWeatherRandom("seed", 1, 2, 4).next());
  });

  it("rejects malformed transition matrices and invalid inputs", () => {
    const invalid = { ...alwaysRainAfterDry, dry: { dry: 0.2, damp: 0.2, wet: 0.2, "heavy-wet": 0.2 } } as WeatherTransitionMatrix;
    expect(() => advanceWeather({ condition: "dry", rainLapsElapsed: 0 }, invalid, new SeededRandom(1))).toThrow("berjumlah 1");
    expect(() => advanceWeather({ condition: "wet", rainLapsElapsed: -1 }, alwaysRainAfterDry, new SeededRandom(1))).toThrow("integer");
    expect(() => calculateWeatherDeltaSeconds({ condition: "wet", weatherAdaptation: 101, tyreMismatchDeltaSeconds: 0 })).toThrow(RangeError);
  });
});
