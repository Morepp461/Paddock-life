export type SaveTrigger =
  | "manual"
  | "race-completed"
  | "major-transaction"
  | "development-completed"
  | "contract-signed"
  | "season-transition";

export interface SaveRecord {
  readonly schemaVersion: number;
  readonly slotId: string;
  readonly careerId: string;
  readonly createdAt: string;
  readonly trigger: SaveTrigger;
  readonly isSandbox: boolean;
  readonly data: Uint8Array;
  readonly checksumSha256: string;
}

export interface SaveStorage {
  read(slotId: string, key: "current" | "backup-1" | "backup-2"): Promise<SaveRecord | null>;
  /** Each individual record must be written atomically by the platform adapter. */
  writeAtomic(slotId: string, key: "current" | "backup-1" | "backup-2", record: SaveRecord): Promise<void>;
  delete(slotId: string, key: "current" | "backup-1" | "backup-2"): Promise<void>;
}

export interface SaveManagerOptions {
  readonly now?: () => Date;
  readonly digest?: (data: Uint8Array) => Promise<string>;
}

const CURRENT_SCHEMA_VERSION = 1;
const SAVE_KEYS = ["current", "backup-1", "backup-2"] as const;

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateSlotId(slotId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(slotId)) throw new Error("ID save slot tidak valid.");
}

function validateRecordMetadata(record: SaveRecord, slotId: string, careerId: string): void {
  if (record.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error("Versi save tidak didukung.");
  if (record.slotId !== slotId || record.careerId !== careerId) throw new Error("Save tidak cocok dengan slot atau career yang diminta.");
  if (!(record.data instanceof Uint8Array)) throw new Error("Data save tidak valid.");
  if (!/^[a-f0-9]{64}$/.test(record.checksumSha256)) throw new Error("Checksum save tidak valid.");
}

export class SaveManager {
  private readonly now: () => Date;
  private readonly digest: (data: Uint8Array) => Promise<string>;

  constructor(private readonly storage: SaveStorage, options: SaveManagerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.digest = options.digest ?? sha256Hex;
  }

  async save(input: {
    readonly slotId: string;
    readonly careerId: string;
    readonly data: Uint8Array;
    readonly trigger: SaveTrigger;
    readonly isSandbox: boolean;
  }): Promise<SaveRecord> {
    validateSlotId(input.slotId);
    if (!input.careerId.trim()) throw new Error("Career ID wajib diisi.");
    if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0) {
      throw new Error("Snapshot save kosong atau tidak valid.");
    }

    const current = await this.storage.read(input.slotId, "current");
    if (current) {
      await this.verifyRecord(current, input.slotId, input.careerId);
      const backup1 = await this.storage.read(input.slotId, "backup-1");
      if (backup1) await this.storage.writeAtomic(input.slotId, "backup-2", backup1);
      else await this.storage.delete(input.slotId, "backup-2");
      await this.storage.writeAtomic(input.slotId, "backup-1", current);
    }

    const data = new Uint8Array(input.data);
    const record: SaveRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      slotId: input.slotId,
      careerId: input.careerId,
      createdAt: this.now().toISOString(),
      trigger: input.trigger,
      isSandbox: input.isSandbox,
      data,
      checksumSha256: await this.digest(data),
    };
    await this.storage.writeAtomic(input.slotId, "current", record);
    return record;
  }

  async load(slotId: string, careerId: string): Promise<SaveRecord | null> {
    validateSlotId(slotId);
    const record = await this.storage.read(slotId, "current");
    if (!record) return null;
    await this.verifyRecord(record, slotId, careerId);
    return { ...record, data: new Uint8Array(record.data) };
  }

  async restoreBackup(slotId: string, careerId: string, backup: "backup-1" | "backup-2"): Promise<SaveRecord> {
    validateSlotId(slotId);
    const record = await this.storage.read(slotId, backup);
    if (!record) throw new Error("Backup save tidak ditemukan.");
    await this.verifyRecord(record, slotId, careerId);

    const current = await this.storage.read(slotId, "current");
    if (current) {
      await this.verifyRecord(current, slotId, careerId);
      await this.storage.writeAtomic(slotId, "backup-1", current);
    }
    const restored: SaveRecord = {
      ...record,
      createdAt: this.now().toISOString(),
      trigger: "manual",
      data: new Uint8Array(record.data),
      checksumSha256: await this.digest(record.data),
    };
    await this.storage.writeAtomic(slotId, "current", restored);
    return restored;
  }

  async verifyRecord(record: SaveRecord, slotId: string, careerId: string): Promise<void> {
    validateRecordMetadata(record, slotId, careerId);
    const actual = await this.digest(record.data);
    if (actual !== record.checksumSha256) throw new Error("Checksum save tidak cocok; data mungkin rusak atau berubah.");
  }

  static readonly retainedBackupCount = SAVE_KEYS.length - 1;
}
