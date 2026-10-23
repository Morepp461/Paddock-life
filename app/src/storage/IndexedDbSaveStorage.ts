import type { SaveRecord, SaveStorage } from "./SaveManager";

const DATABASE_NAME = "paddock-life-save-backups-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "save-records";

interface StoredSaveRecord {
  readonly id: string;
  readonly slotId: string;
  readonly key: "current" | "backup-1" | "backup-2";
  readonly record: SaveRecord;
}

function recordId(slotId: string, key: StoredSaveRecord["key"]): string {
  return slotId + ":" + key;
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

/** IndexedDB-backed atomic storage for the current save snapshot and two rotating backups. */
export class IndexedDbSaveStorage implements SaveStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;

  constructor(factory?: IDBFactory) {
    const resolvedFactory = factory ?? globalThis.indexedDB;
    if (!resolvedFactory) throw new Error("IndexedDB tidak tersedia di runtime ini.");
    this.factory = resolvedFactory;
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        this.databasePromise = null;
        reject(error instanceof Error ? error : new Error("Database backup gagal dibuka."));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error("Database backup tidak bisa dibuka."));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error("Database backup sedang diblokir oleh tab atau proses lain."));
      };
    });
    return this.databasePromise;
  }

  async read(slotId: string, key: StoredSaveRecord["key"]): Promise<SaveRecord | null> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const request = requestResult<StoredSaveRecord | undefined>(
      transaction.objectStore(STORE_NAME).get(recordId(slotId, key)),
    );
    const [stored] = await Promise.all([request, done]);
    return stored?.record ?? null;
  }

  async writeAtomic(slotId: string, key: StoredSaveRecord["key"], record: SaveRecord): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const stored: StoredSaveRecord = {
      id: recordId(slotId, key),
      slotId,
      key,
      record: { ...record, data: new Uint8Array(record.data) },
    };
    transaction.objectStore(STORE_NAME).put(stored);
    await done;
  }

  async delete(slotId: string, key: StoredSaveRecord["key"]): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(recordId(slotId, key));
    await done;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
