import type { Difficulty } from "./InitialDistributions";
import type { TierId } from "./GameConfig";
function normalizeCareerText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export type CareerPath = "new-team" | "takeover";
export type TeamStrength = "Kuat" | "Menengah" | "Lemah";

export interface CareerTeamCandidate {
  readonly teamId: string;
  readonly tier: TierId;
  readonly name: string;
  readonly strength: TeamStrength;
}

export interface CareerSetupDraft {
  readonly managerName: string;
  readonly managerCountryCode: string;
  readonly difficulty: Difficulty;
  readonly path: CareerPath;
  readonly worldSeed: string;
  readonly newTeam?: {
    readonly name: string;
    readonly code: string;
    readonly countryCode: string;
    readonly tier: TierId;
    readonly replacedTeamId: string;
  };
  readonly takeoverTeamId?: string;
}

export interface CareerSetupValidationContext {
  readonly availableCountryCodes: ReadonlySet<string>;
  readonly blockedManagerNames: ReadonlySet<string>;
  readonly blockedTeamNames: ReadonlySet<string>;
  readonly existingTeamNames: ReadonlySet<string>;
  readonly existingTeamCodes: ReadonlySet<string>;
  readonly teamPool: readonly CareerTeamCandidate[];
}

export interface ValidatedCareerSetup {
  readonly path: CareerPath;
  readonly difficulty: Difficulty;
  readonly selectedTier: TierId;
  readonly highestUnlockedTier: TierId;
  readonly managerName: string;
  readonly managerCountryCode: string;
  readonly worldSeed: string;
  readonly newTeam?: {
    readonly name: string;
    readonly code: string;
    readonly countryCode: string;
    readonly tier: TierId;
    readonly replacedTeamId: string;
  };
  readonly takeoverTeam?: CareerTeamCandidate;
}

/** Source rule: new teams can start in Tier 5–3; Tier 6 is hidden. */
export function getNewTeamCareerTiers(): readonly TierId[] {
  return [5, 4, 3];
}

/** Source rule: takeover is available in Tier 5–1; Tier 6 is hidden. */
export function getTakeoverCareerTiers(): readonly TierId[] {
  return [5, 4, 3, 2, 1];
}

function normalizedSet(values: ReadonlySet<string>): Set<string> {
  return new Set([...values].map(normalizeCareerText));
}

function validateName(value: string, minimum: number, maximum: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw new Error(`${label} harus berisi ${minimum}–${maximum} karakter.`);
  }
  return trimmed;
}

function validateCountry(code: string, available: ReadonlySet<string>, label: string): string {
  const normalized = code.trim().toUpperCase();
  if (!available.has(normalized)) throw new Error(`${label} harus dipilih dari daftar negara yang tersedia.`);
  return normalized;
}

/**
 * Validates the career wizard draft against the final New Career Flow document.
 * It does not create a save or mutate the database; persistence belongs to the
 * atomic world-generation transaction.
 */
export function validateCareerSetupDraft(
  draft: CareerSetupDraft,
  context: CareerSetupValidationContext,
): ValidatedCareerSetup {
  const managerName = validateName(draft.managerName, 2, 24, "Nama manager");
  if (!/^[\p{L}\p{N} -]+$/u.test(managerName)) {
    throw new Error("Nama manager hanya boleh berisi huruf, angka, spasi, dan tanda hubung.");
  }
  if (normalizedSet(context.blockedManagerNames).has(normalizeCareerText(managerName))) {
    throw new Error("Nama manager tidak dapat digunakan.");
  }
  const managerCountryCode = validateCountry(draft.managerCountryCode, context.availableCountryCodes, "Kewarganegaraan manager");
  if (!(["easy", "normal", "hard"] as const).includes(draft.difficulty)) {
    throw new Error("Tingkat kesulitan tidak valid.");
  }
  if (!draft.worldSeed.trim() || draft.worldSeed.length > 128) {
    throw new Error("World seed wajib diisi dan maksimal 128 karakter.");
  }

  if (draft.path === "new-team") {
    const input = draft.newTeam;
    if (!input) throw new Error("Identitas tim baru belum lengkap.");
    const name = validateName(input.name, 3, 24, "Nama tim");
    if (normalizedSet(context.blockedTeamNames).has(normalizeCareerText(name))) {
      throw new Error("Nama tim tidak dapat digunakan.");
    }
    if (normalizedSet(context.existingTeamNames).has(normalizeCareerText(name))) {
      throw new Error("Nama tim sudah dipakai dalam career ini.");
    }
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new Error("Kode tim harus terdiri dari tepat 3 huruf A–Z.");
    if (normalizedSet(context.existingTeamCodes).has(normalizeCareerText(code))) {
      throw new Error("Kode tim sudah dipakai dalam career ini.");
    }
    const countryCode = validateCountry(input.countryCode, context.availableCountryCodes, "Negara basis tim");
    if (!getNewTeamCareerTiers().includes(input.tier)) {
      throw new Error("Tim baru hanya dapat dimulai di Tier 5, 4, atau 3.");
    }
    const replacement = context.teamPool.find((team) => team.teamId === input.replacedTeamId);
    if (!replacement || replacement.tier !== input.tier) {
      throw new Error("Pilih tim pengganti dari tier yang sama.");
    }
    if (replacement.strength === "Kuat") {
      throw new Error("Tim yang digantikan harus berkekuatan Lemah atau Menengah.");
    }
    return {
      path: "new-team",
      difficulty: draft.difficulty,
      selectedTier: input.tier,
      highestUnlockedTier: 3,
      managerName,
      managerCountryCode,
      worldSeed: draft.worldSeed.trim(),
      newTeam: { name, code, countryCode, tier: input.tier, replacedTeamId: replacement.teamId },
    };
  }

  if (draft.path === "takeover") {
    const team = context.teamPool.find((candidate) => candidate.teamId === draft.takeoverTeamId);
    if (!team) throw new Error("Pilih tim yang akan diambil alih.");
    if (!getTakeoverCareerTiers().includes(team.tier)) {
      throw new Error("Tim Tier 6 tidak tersedia untuk Career Mode.");
    }
    return {
      path: "takeover",
      difficulty: draft.difficulty,
      selectedTier: team.tier,
      highestUnlockedTier: team.tier,
      managerName,
      managerCountryCode,
      worldSeed: draft.worldSeed.trim(),
      takeoverTeam: team,
    };
  }

  throw new Error("Jalur career tidak valid.");
}
