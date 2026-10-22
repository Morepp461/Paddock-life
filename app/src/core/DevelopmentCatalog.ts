import type { DevelopmentProjectSize } from "./EconomyEngine";
import type { TierId } from "./GameConfig";

export type DevelopmentCategory = "aero" | "engine" | "chassis" | "reliability";
export interface DevelopmentCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: DevelopmentCategory;
  readonly mainAttribute: string;
  readonly secondaryAttributes: readonly string[];
  readonly availableSizes: readonly DevelopmentProjectSize[];
  readonly minimumTier: TierId;
  readonly maximumTier: TierId;
  readonly kartName?: string;
}

const ALL_SIZES: readonly DevelopmentProjectSize[] = ["minor", "standard", "major"];
const MINOR_STANDARD: readonly DevelopmentProjectSize[] = ["minor", "standard"];
const STANDARD_MAJOR: readonly DevelopmentProjectSize[] = ["standard", "major"];
const MINOR_ONLY: readonly DevelopmentProjectSize[] = ["minor"];

export const DEVELOPMENT_CATALOG: readonly DevelopmentCatalogEntry[] = [
  { id: "A01", name: "Front Wing", category: "aero", mainAttribute: "Aero", secondaryAttributes: ["High Speed"], availableSizes: ALL_SIZES, minimumTier: 1, maximumTier: 4 },
  { id: "A02", name: "Rear Wing", category: "aero", mainAttribute: "Aero", secondaryAttributes: ["Low Speed"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "A03", name: "Floor & Diffuser", category: "aero", mainAttribute: "Aero", secondaryAttributes: ["Medium Speed"], availableSizes: STANDARD_MAJOR, minimumTier: 1, maximumTier: 4 },
  { id: "A04", name: "Sidepod Redesign", category: "aero", mainAttribute: "Aero", secondaryAttributes: ["Engine Reliability (-)"], availableSizes: ["standard"], minimumTier: 1, maximumTier: 4 },
  { id: "A05", name: "Vortex Control (bargeboard)", category: "aero", mainAttribute: "High Speed", secondaryAttributes: ["Aero"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "A06", name: "Low-Drag Kit", category: "aero", mainAttribute: "High Speed", secondaryAttributes: ["Engine"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "A07", name: "Full Aero Package", category: "aero", mainAttribute: "Aero", secondaryAttributes: ["High Speed", "Medium Speed", "Low Speed"], availableSizes: ["major"], minimumTier: 1, maximumTier: 4 },
  { id: "A08", name: "Endplate & Cascade Redesign", category: "aero", mainAttribute: "High Speed", secondaryAttributes: ["Aero"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "A09", name: "Front Suspension Fairing", category: "aero", mainAttribute: "Aero", secondaryAttributes: ["Low Speed"], availableSizes: MINOR_ONLY, minimumTier: 1, maximumTier: 4 },

  { id: "E01", name: "Engine Calibration", category: "engine", mainAttribute: "Engine", secondaryAttributes: ["Traction"], availableSizes: ALL_SIZES, minimumTier: 1, maximumTier: 6, kartName: "Karburator/tuning mesin" },
  { id: "E02", name: "Turbo/Compressor Upgrade", category: "engine", mainAttribute: "Engine", secondaryAttributes: ["High Speed"], availableSizes: STANDARD_MAJOR, minimumTier: 1, maximumTier: 4 },
  { id: "E03", name: "Energy Recovery System", category: "engine", mainAttribute: "Engine", secondaryAttributes: ["Traction"], availableSizes: STANDARD_MAJOR, minimumTier: 1, maximumTier: 3 },
  { id: "E04", name: "Cooling Layout", category: "engine", mainAttribute: "Engine", secondaryAttributes: ["Engine Reliability (+)"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Sistem pendingin kart" },
  { id: "E05", name: "Fuel Mapping", category: "engine", mainAttribute: "Traction", secondaryAttributes: ["Engine"], availableSizes: MINOR_ONLY, minimumTier: 1, maximumTier: 6, kartName: "Pemetaan bahan bakar kart" },
  { id: "E06", name: "Full Engine Specification", category: "engine", mainAttribute: "Engine", secondaryAttributes: ["Traction", "Reliability (-)"], availableSizes: ["major"], minimumTier: 1, maximumTier: 6, kartName: "Paket mesin kart" },
  { id: "E07", name: "Exhaust Layout", category: "engine", mainAttribute: "Engine", secondaryAttributes: ["Traction"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Knalpot kart" },
  { id: "E08", name: "Deployment Strategy Software", category: "engine", mainAttribute: "Traction", secondaryAttributes: ["Engine"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },

  { id: "C01", name: "Suspension Geometry", category: "chassis", mainAttribute: "Mechanical Grip", secondaryAttributes: ["Low Speed"], availableSizes: ALL_SIZES, minimumTier: 1, maximumTier: 6, kartName: "Setelan sasis kart" },
  { id: "C02", name: "Chassis Stiffness", category: "chassis", mainAttribute: "Medium Speed", secondaryAttributes: ["Mechanical Grip"], availableSizes: STANDARD_MAJOR, minimumTier: 1, maximumTier: 6, kartName: "Kekakuan sasis kart" },
  { id: "C03", name: "Brake System", category: "chassis", mainAttribute: "Braking", secondaryAttributes: ["Brake Reliability (-)"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Sistem rem kart" },
  { id: "C04", name: "Gearbox Ratios", category: "chassis", mainAttribute: "Traction", secondaryAttributes: ["Gearbox Reliability (-)"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "C05", name: "Weight Reduction", category: "chassis", mainAttribute: "Mechanical Grip", secondaryAttributes: ["Low Speed"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Pengurangan bobot kart" },
  { id: "C06", name: "Steering Geometry", category: "chassis", mainAttribute: "Low Speed", secondaryAttributes: ["Mechanical Grip"], availableSizes: MINOR_ONLY, minimumTier: 1, maximumTier: 6, kartName: "Geometri kemudi kart" },
  { id: "C07", name: "Differential Tuning", category: "chassis", mainAttribute: "Traction", secondaryAttributes: ["Low Speed"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "C08", name: "Full Chassis Redesign", category: "chassis", mainAttribute: "Mechanical Grip", secondaryAttributes: ["Medium Speed", "Low Speed", "Braking"], availableSizes: ["major"], minimumTier: 1, maximumTier: 6, kartName: "Sasis kart baru" },
  { id: "C09", name: "Tyre Management Package", category: "chassis", mainAttribute: "Tyre Management", secondaryAttributes: ["Mechanical Grip"], availableSizes: ALL_SIZES, minimumTier: 1, maximumTier: 6, kartName: "Setelan ban dan sasis kart" },
  { id: "C10", name: "Damper & Anti-Roll Tuning", category: "chassis", mainAttribute: "Medium Speed", secondaryAttributes: ["Mechanical Grip"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Peredam dan stabilizer kart" },
  { id: "C11", name: "Brake Balance System", category: "chassis", mainAttribute: "Braking", secondaryAttributes: ["Traction"], availableSizes: MINOR_ONLY, minimumTier: 1, maximumTier: 6, kartName: "Distribusi rem" },

  { id: "R01", name: "Engine Durability", category: "reliability", mainAttribute: "Engine Reliability", secondaryAttributes: [], availableSizes: ALL_SIZES, minimumTier: 1, maximumTier: 6, kartName: "Ketahanan mesin kart" },
  { id: "R02", name: "Gearbox Reinforcement", category: "reliability", mainAttribute: "Gearbox Reliability", secondaryAttributes: [], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "R03", name: "Brake Cooling Ducts", category: "reliability", mainAttribute: "Brake Reliability", secondaryAttributes: [], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Pendingin rem kart" },
  { id: "R04", name: "Suspension Hardening", category: "reliability", mainAttribute: "Suspension Reliability", secondaryAttributes: [], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Penguatan sasis kart" },
  { id: "R05", name: "Electronics Harness", category: "reliability", mainAttribute: "Electronics Reliability", secondaryAttributes: [], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
  { id: "R06", name: "Reliability Overhaul", category: "reliability", mainAttribute: "All Component Reliability", secondaryAttributes: [], availableSizes: ["major"], minimumTier: 1, maximumTier: 6, kartName: "Perawatan menyeluruh kart" },
  { id: "R07", name: "Cooling System Reliability", category: "reliability", mainAttribute: "Engine Reliability", secondaryAttributes: ["Electronics Reliability"], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 6, kartName: "Pendinginan mesin kart" },
  { id: "R08", name: "Hydraulics & Steering Reliability", category: "reliability", mainAttribute: "Suspension Reliability", secondaryAttributes: [], availableSizes: MINOR_STANDARD, minimumTier: 1, maximumTier: 4 },
];

export const CHIEF_ENGINEER_MINIMUM_SKILL: Readonly<Record<TierId, Readonly<Record<DevelopmentProjectSize, number>>>> = {
  1: { minor: 62, standard: 72, major: 80 },
  2: { minor: 54, standard: 64, major: 72 },
  3: { minor: 46, standard: 56, major: 64 },
  4: { minor: 38, standard: 48, major: 56 },
  5: { minor: 28, standard: 38, major: 46 },
  6: { minor: 20, standard: 30, major: 38 },
};

export const MINIMUM_FACILITY_LEVEL: Readonly<Record<DevelopmentProjectSize, number>> = {
  minor: 2, standard: 4, major: 6,
};

export interface DevelopmentEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export function validateDevelopmentSelection(input: {
  readonly projectId: string;
  readonly tier: TierId;
  readonly size: DevelopmentProjectSize;
  readonly chiefEngineerSkill: number;
  readonly facilityLevel: number;
}): DevelopmentEligibility {
  const project = DEVELOPMENT_CATALOG.find((entry) => entry.id === input.projectId);
  if (!project) return { eligible: false, reasons: ["Project tidak ditemukan di katalog."] };
  const reasons: string[] = [];
  if (input.tier < project.minimumTier || input.tier > project.maximumTier) {
    reasons.push(`Project ${project.id} hanya tersedia di Tier ${project.minimumTier}–${project.maximumTier}.`);
  }
  if (!project.availableSizes.includes(input.size)) {
    reasons.push(`Project ${project.id} tidak tersedia dalam skala ${input.size}.`);
  }
  if (!Number.isFinite(input.chiefEngineerSkill) || input.chiefEngineerSkill < 0 || input.chiefEngineerSkill > 100) {
    reasons.push("Skill Chief Engineer harus berada pada rentang 0–100.");
  } else if (input.chiefEngineerSkill < CHIEF_ENGINEER_MINIMUM_SKILL[input.tier][input.size]) {
    reasons.push(`Chief Engineer membutuhkan skill minimal ${CHIEF_ENGINEER_MINIMUM_SKILL[input.tier][input.size]} untuk ${input.size}.`);
  }
  if (!Number.isSafeInteger(input.facilityLevel) || input.facilityLevel < MINIMUM_FACILITY_LEVEL[input.size] || input.facilityLevel > 10) {
    reasons.push(`Fasilitas terkait minimal level ${MINIMUM_FACILITY_LEVEL[input.size]}.`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function getDevelopmentProjectName(projectId: string, tier: TierId): string | undefined {
  const project = DEVELOPMENT_CATALOG.find((entry) => entry.id === projectId);
  if (!project) return undefined;
  return tier >= 5 && project.kartName ? project.kartName : project.name;
}

export function getSecondaryReliabilityEffect(projectId: string): "positive" | "negative" | undefined {
  const project = DEVELOPMENT_CATALOG.find((entry) => entry.id === projectId);
  if (!project) return undefined;
  if (project.secondaryAttributes.some((attribute) => attribute.includes("Reliability (+)"))) return "positive";
  if (project.secondaryAttributes.some((attribute) => attribute.includes("Reliability (-)"))) return "negative";
  return undefined;
}

export function validateDevelopmentCatalog(): void {
  if (DEVELOPMENT_CATALOG.length !== 36) throw new Error("Katalog development harus berisi tepat 36 project.");
  const ids = new Set<string>();
  for (const project of DEVELOPMENT_CATALOG) {
    if (ids.has(project.id)) throw new Error(`ID project duplikat: ${project.id}.`);
    ids.add(project.id);
    if (!project.availableSizes.length || project.minimumTier > project.maximumTier) {
      throw new Error(`Definisi project tidak valid: ${project.id}.`);
    }
  }
}
