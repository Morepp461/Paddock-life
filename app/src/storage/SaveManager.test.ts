import { describe, expect, it } from "vitest";
import { SaveManager, type SaveRecord, type SaveStorage } from "./SaveManager";

class MemorySaveStorage implements SaveStorage {
  private readonly records = new Map<string, SaveRecord>();
  async read(slotId: string, key: "current" | "backup-1" | "backup-2"): Promise<SaveRecord | null> {
    return this.records.get(`${slotId}/${key}`) ?? null;
  }
  async writeAtomic(slotId: string, key: "current" | "backup-1" | "backup-2", record: SaveRecord): Promise<void> {
    this.records.set(`${slotId}/${key}`, { ...record, data: new Uint8Array(record.data) });
  }
  async delete(slotId: string, key: "current" | "backup-1" | "backup-2"): Promise<void> {
    this.records.delete(`${slotId}/${key}`);
  }
}

const digest = async (data: Uint8Array) =>
  Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64);

function makeManager(storage: MemorySaveStorage) {
  let tick = 0;
  return new SaveManager(storage, {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    digest,
  });
}

describe("SaveManager", () => {
  it("saves current data and rotates two verified backups", async () => {
    const storage = new MemorySaveStorage();
    const manager = makeManager(storage);
    await manager.save({ slotId: "career-1", careerId: "career-1", data: new Uint8Array([1]), trigger: "manual", isSandbox: false });
    await manager.save({ slotId: "career-1", careerId: "career-1", data: new Uint8Array([2]), trigger: "race-completed", isSandbox: false });
    await manager.save({ slotId: "career-1", careerId: "career-1", data: new Uint8Array([3]), trigger: "season-transition", isSandbox: false });

    expect(Array.from((await manager.load("career-1", "career-1"))!.data)).toEqual([3]);
    expect(Array.from((await storage.read("career-1", "backup-1"))!.data)).toEqual([2]);
    expect(Array.from((await storage.read("career-1", "backup-2"))!.data)).toEqual([1]);
  });

  it("refuses corrupted snapshots and does not overwrite a valid current save", async () => {
    const storage = new MemorySaveStorage();
    const manager = makeManager(storage);
    const saved = await manager.save({ slotId: "slot1", careerId: "career1", data: new Uint8Array([4, 5]), trigger: "manual", isSandbox: false });
    await storage.writeAtomic("slot1", "current", { ...saved, data: new Uint8Array([9, 9]) });
    await expect(manager.save({ slotId: "slot1", careerId: "career1", data: new Uint8Array([6]), trigger: "manual", isSandbox: false })).rejects.toThrow("Checksum");
    await expect(manager.load("slot1", "career1")).rejects.toThrow("Checksum");
  });

  it("restores a backup only after verifying its checksum", async () => {
    const storage = new MemorySaveStorage();
    const manager = makeManager(storage);
    await manager.save({ slotId: "slot2", careerId: "career2", data: new Uint8Array([10]), trigger: "manual", isSandbox: true });
    await manager.save({ slotId: "slot2", careerId: "career2", data: new Uint8Array([20]), trigger: "manual", isSandbox: true });
    const restored = await manager.restoreBackup("slot2", "career2", "backup-1");
    expect(Array.from(restored.data)).toEqual([10]);
    expect(restored.isSandbox).toBe(true);
    await expect(manager.load("slot2", "wrong-career")).rejects.toThrow("tidak cocok");
  });

  it("restores a verified backup even when the current snapshot is corrupt", async () => {
    const storage = new MemorySaveStorage();
    const manager = makeManager(storage);
    await manager.save({ slotId: "slot3", careerId: "career3", data: new Uint8Array([1]), trigger: "manual", isSandbox: false });
    await manager.save({ slotId: "slot3", careerId: "career3", data: new Uint8Array([2]), trigger: "race-completed", isSandbox: false });
    const corruptCurrent = await storage.read("slot3", "current");
    if (!corruptCurrent) throw new Error("Current save is missing.");
    await storage.writeAtomic("slot3", "current", { ...corruptCurrent, data: new Uint8Array([99]) });

    const restored = await manager.restoreBackup("slot3", "career3", "backup-1");
    expect(Array.from(restored.data)).toEqual([1]);
    expect(Array.from((await manager.load("slot3", "career3"))!.data)).toEqual([1]);
  });

  it("deletes current and both rotating backups for a removed slot", async () => {
    const storage = new MemorySaveStorage();
    const manager = makeManager(storage);
    await manager.save({ slotId: "slot-delete", careerId: "career-delete", data: new Uint8Array([1]), trigger: "manual", isSandbox: false });
    await manager.save({ slotId: "slot-delete", careerId: "career-delete", data: new Uint8Array([2]), trigger: "race-completed", isSandbox: false });
    await manager.save({ slotId: "slot-delete", careerId: "career-delete", data: new Uint8Array([3]), trigger: "race-completed", isSandbox: false });
    await manager.deleteSlot("slot-delete");
    expect(await storage.read("slot-delete", "current")).toBeNull();
    expect(await storage.read("slot-delete", "backup-1")).toBeNull();
    expect(await storage.read("slot-delete", "backup-2")).toBeNull();
  });

  it("rejects invalid slot IDs and empty snapshots", async () => {
    const manager = makeManager(new MemorySaveStorage());
    await expect(manager.save({ slotId: "../escape", careerId: "c", data: new Uint8Array([1]), trigger: "manual", isSandbox: false })).rejects.toThrow("slot");
    await expect(manager.save({ slotId: "slot", careerId: "c", data: new Uint8Array(), trigger: "manual", isSandbox: false })).rejects.toThrow("kosong");
  });
});
