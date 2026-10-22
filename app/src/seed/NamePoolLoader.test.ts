import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeCompressedNamePool, validateNamePool } from "./NamePoolLoader";

const PARTS = [
  "name-pool-01.b64",
  "name-pool-02.b64",
  "name-pool-03.b64",
  "name-pool-04.b64",
  "name-pool-05.b64",
  "name-pool-05b.b64",
  "name-pool-05c.b64",
  "name-pool-05d.b64",
  "name-pool-05e.b64",
  "name-pool-06.b64",
] as const;

describe("source name pool", () => {
  it("decodes the compressed public payload and validates all source counts", () => {
    const encoded = PARTS.map((part) => readFileSync(new URL("../../public/seed/" + part, import.meta.url), "utf8").trim()).join("");
    const raw = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
    const payload: unknown = JSON.parse(raw);
    expect(() => validateNamePool(payload)).not.toThrow();
  });

  it("decodes gzip/base64 payloads through the same runtime path used by the app", async () => {
    const fixture = { schemaVersion: 1, marker: "paddock-life-seed" };
    const encoded = gzipSync(Buffer.from(JSON.stringify(fixture))).toString("base64");
    await expect(decodeCompressedNamePool([encoded])).resolves.toEqual(fixture);
  });
});
