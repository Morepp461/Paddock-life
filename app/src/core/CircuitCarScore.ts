import type { TierId } from "./GameConfig";

export interface CircuitPerformanceWeights {
  readonly engine: number;
  readonly aero: number;
  readonly highSpeed: number;
  readonly mediumSpeed: number;
  readonly lowSpeed: number;
  readonly grip: number;
  readonly traction: number;
  readonly braking: number;
}

export interface CarPerformanceAttributes {
  readonly enginePower: number;
  readonly aero: number;
  readonly highSpeed: number;
  readonly mediumSpeed: number;
  readonly lowSpeed: number;
  readonly grip: number;
  readonly traction: number;
  readonly braking: number;
}

/** Calculates car pace from the circuit's normalized performance weights.
 * Kart tiers follow Division Ruleset §1: no aero, and aero/high-speed weight
 * is redistributed 60% to grip and 40% to traction.
 */
export function calculateCircuitCarScore(
  tier: TierId,
  weights: CircuitPerformanceWeights,
  car: CarPerformanceAttributes,
): number {
  const weightEntries = Object.entries(weights) as [keyof CircuitPerformanceWeights, number][];
  const carEntries = Object.entries(car) as [keyof CarPerformanceAttributes, number][];
  if (weightEntries.some(([, value]) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Bobot performa sirkuit harus finite dan non-negatif.");
  }
  if (carEntries.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new RangeError("Atribut performa mobil harus berada pada rentang 0–100.");
  }

  const adjusted: CircuitPerformanceWeights = tier >= 5
    ? {
        ...weights,
        aero: 0,
        highSpeed: 0,
        grip: weights.grip + (weights.aero + weights.highSpeed) * 0.6,
        traction: weights.traction + (weights.aero + weights.highSpeed) * 0.4,
      }
    : weights;
  const totalWeight = Object.values(adjusted).reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) throw new RangeError("Total bobot performa sirkuit harus lebih besar dari nol.");

  const attributeByWeight: Readonly<Record<keyof CircuitPerformanceWeights, number>> = {
    engine: car.enginePower,
    aero: car.aero,
    highSpeed: car.highSpeed,
    mediumSpeed: car.mediumSpeed,
    lowSpeed: car.lowSpeed,
    grip: car.grip,
    traction: car.traction,
    braking: car.braking,
  };
  return weightEntries.reduce((sum, [key]) => sum + adjusted[key] * attributeByWeight[key], 0) / totalWeight;
}
