import { TIER_CONFIG, type TierId } from "./GameConfig";
import { SeededRandom } from "./SeededRandom";

export type IncidentOutcome = "lock-up" | "spin" | "minor-collision" | "crash" | "fatal-incident";

export interface IncidentRiskInput {
  readonly tier: TierId;
  readonly baseRisk: number;
  readonly aggression: number;
  readonly tyreStress: number;
  readonly weatherRisk: number;
  readonly pressure: number;
  readonly consistency: number;
  readonly focus: number;
}

export interface IncidentRisk {
  readonly mistakeScore: number;
  readonly perLapProbability: number;
}

export interface IncidentOutcomeResult {
  readonly outcome: IncidentOutcome;
  readonly timeLossSeconds: number;
  readonly tyreWearIncreasePercent: number;
  readonly losesPosition: boolean;
  readonly wingDamage: boolean;
  readonly dnf: boolean;
  readonly triggersSafetyCar: boolean;
  readonly triggersRedFlag: boolean;
  readonly fatal: boolean;
}

const OUTCOME_WEIGHTS: readonly { readonly outcome: IncidentOutcome; readonly weight: number }[] = [
  { outcome: "lock-up", weight: 54 },
  { outcome: "spin", weight: 22 },
  { outcome: "minor-collision", weight: 13 },
  { outcome: "crash", weight: 9 },
  { outcome: "fatal-incident", weight: 2 },
];

function validateScore(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} harus berada pada rentang 0–100.`);
  }
}

/** Document 02, Section 7. Tier multiplier is applied after the base probability clamp. */
export function calculateIncidentRisk(input: IncidentRiskInput): IncidentRisk {
  for (const [name, value] of Object.entries(input)) {
    if (name === "tier") continue;
    validateScore(name, value);
  }
  const mistakeScore = input.baseRisk + input.aggression + input.tyreStress + input.weatherRisk
    + input.pressure - input.consistency - input.focus;
  const baseProbability = Math.max(0, Math.min(0.05, 0.002 * (1 + mistakeScore / 50)));
  return {
    mistakeScore,
    perLapProbability: baseProbability * TIER_CONFIG[input.tier].incidentMultiplier,
  };
}

function pickOutcome(random: SeededRandom): IncidentOutcome {
  const roll = random.next() * 100;
  let cumulative = 0;
  for (const item of OUTCOME_WEIGHTS) {
    cumulative += item.weight;
    if (roll < cumulative) return item.outcome;
  }
  return "fatal-incident";
}

/** Resolves a single incident without graphic details; every random choice is seeded. */
export function resolveIncidentOutcome(random: SeededRandom): IncidentOutcomeResult {
  const outcome = pickOutcome(random);
  switch (outcome) {
    case "lock-up":
      return {
        outcome, timeLossSeconds: 1 + random.next() * 2, tyreWearIncreasePercent: 5,
        losesPosition: false, wingDamage: false, dnf: false, triggersSafetyCar: false,
        triggersRedFlag: false, fatal: false,
      };
    case "spin":
      return {
        outcome, timeLossSeconds: 5 + random.next() * 7, tyreWearIncreasePercent: 0,
        losesPosition: true, wingDamage: false, dnf: false, triggersSafetyCar: false,
        triggersRedFlag: false, fatal: false,
      };
    case "minor-collision":
      return {
        outcome, timeLossSeconds: 10, tyreWearIncreasePercent: 0,
        losesPosition: true, wingDamage: random.next() < 0.2, dnf: false,
        triggersSafetyCar: false, triggersRedFlag: false, fatal: false,
      };
    case "crash":
      return {
        outcome, timeLossSeconds: 0, tyreWearIncreasePercent: 0,
        losesPosition: true, wingDamage: true, dnf: true, triggersSafetyCar: random.next() < 0.4,
        triggersRedFlag: false, fatal: false,
      };
    case "fatal-incident":
      return {
        outcome, timeLossSeconds: 0, tyreWearIncreasePercent: 0,
        losesPosition: true, wingDamage: true, dnf: true, triggersSafetyCar: false,
        triggersRedFlag: true, fatal: true,
      };
  }
}

export function rollLapIncident(input: {
  readonly risk: IncidentRiskInput;
  readonly random: SeededRandom;
}): { readonly risk: IncidentRisk; readonly result: IncidentOutcomeResult | null } {
  const risk = calculateIncidentRisk(input.risk);
  if (input.random.next() >= risk.perLapProbability) return { risk, result: null };
  return { risk, result: resolveIncidentOutcome(input.random) };
}
