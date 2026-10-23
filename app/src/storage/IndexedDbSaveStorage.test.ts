import { describe, expect, it } from "vitest";
import { IndexedDbSaveStorage } from "./IndexedDbSaveStorage";

describe("IndexedDbSaveStorage", () => {
  it("retries opening the database after a synchronous IndexedDB factory failure", async () => {
    let attempts = 0;
    const factory = {
      open: () => {
        attempts += 1;
        throw new Error("open attempt " + attempts);
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbSaveStorage(factory);

    await expect(storage.read("slot-1", "current")).rejects.toThrow("open attempt 1");
    await expect(storage.read("slot-1", "current")).rejects.toThrow("open attempt 2");
    expect(attempts).toBe(2);
  });
});
