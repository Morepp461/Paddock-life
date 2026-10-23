import type { IDatabase } from "./IDatabase";

export type GameConfigScope = "global" | "tier" | "circuit";

export interface GameConfigEntry<T = unknown> {
  readonly key: string;
  readonly scope: GameConfigScope;
  readonly scopeId: string;
  readonly value: T;
  readonly sourceDocument: string;
}

export interface GameConfigLookup {
  readonly scope?: GameConfigScope;
  readonly scopeId?: string;
  readonly allowGlobalFallback?: boolean;
}

/**
 * Reads only explicitly configured simulation values. Missing values are never
 * silently replaced with invented defaults.
 */
export async function getGameConfig<T = unknown>(
  database: IDatabase,
  key: string,
  lookup: GameConfigLookup = {},
): Promise<GameConfigEntry<T> | null> {
  if (!key.trim()) throw new Error("Game config key wajib diisi.");
  const scope = lookup.scope ?? "global";
  const scopeId = lookup.scopeId ?? "global";
  if (!scopeId.trim()) throw new Error("Game config scope ID wajib diisi.");
  if (scope === "global" && scopeId !== "global") {
    throw new Error("Global game config harus menggunakan scope ID 'global'.");
  }
  if (scope !== "global" && scopeId === "global") {
    throw new Error("Config tier/circuit harus memiliki scope ID spesifik.");
  }

  const rows = await database.query(
    "SELECT config_key, scope, scope_id, value_json, source_document FROM game_config WHERE config_key = ? AND scope = ? AND scope_id = ? LIMIT 1;",
    [key, scope, scopeId],
  );
  const row = rows[0];
  if (row) return parseConfigRow<T>(row);

  if (scope !== "global" && lookup.allowGlobalFallback === true) {
    return getGameConfig<T>(database, key, { scope: "global", scopeId: "global" });
  }
  return null;
}

export async function requireGameConfig<T = unknown>(
  database: IDatabase,
  key: string,
  lookup: GameConfigLookup = {},
): Promise<GameConfigEntry<T>> {
  const entry = await getGameConfig<T>(database, key, lookup);
  if (!entry) {
    const scope = lookup.scope ?? "global";
    const scopeId = lookup.scopeId ?? "global";
    throw new Error(`Konfigurasi simulasi wajib belum tersedia: ${key} [${scope}:${scopeId}].`);
  }
  return entry;
}

export function parseConfigRow<T>(row: Record<string, unknown>): GameConfigEntry<T> {
  const key = String(row.config_key ?? "");
  const scope = String(row.scope ?? "");
  const scopeId = String(row.scope_id ?? "");
  const sourceDocument = String(row.source_document ?? "");
  if (!key.trim() || !sourceDocument.trim()) {
    throw new Error("Game config tidak memiliki key atau sumber dokumen.");
  }
  if (scope !== "global" && scope !== "tier" && scope !== "circuit") {
    throw new Error(`Scope game config tidak dikenal: ${scope}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(String(row.value_json));
  } catch {
    throw new Error(`JSON game config tidak valid: ${key}.`);
  }
  return { key, scope, scopeId, value: value as T, sourceDocument };
}
