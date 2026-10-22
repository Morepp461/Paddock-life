import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const parts = [
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
];
const encoded = parts.map((part) => readFileSync(new URL("../app/public/seed/" + part, import.meta.url), "utf8").trim()).join("");
const payload = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));

if (payload.schemaVersion !== 1) throw new Error("Unsupported name pool seed schema version.");
if (!Array.isArray(payload.cultures) || payload.cultures.length !== 52) throw new Error("Name pool must contain exactly 52 cultures.");
if (!Array.isArray(payload.countries) || payload.countries.length !== 199) throw new Error("Name pool must contain exactly 199 country profiles.");
if (!Array.isArray(payload.blockedFullNames) || payload.blockedFullNames.length !== 51) throw new Error("Name pool must contain exactly 51 blocked full names.");

const cultureIds = new Set();
let totalNames = 0;
for (const culture of payload.cultures) {
  if (!culture || typeof culture.id !== "string" || cultureIds.has(culture.id)) throw new Error("Invalid or duplicate name culture ID.");
  for (const key of ["maleGivenNames", "femaleGivenNames", "surnames"]) {
    if (!Array.isArray(culture[key]) || culture[key].length === 0 || !culture[key].every((name) => typeof name === "string" && name.trim())) {
      throw new Error("Empty or invalid name list for culture " + culture.id + ".");
    }
    totalNames += culture[key].length;
  }
  cultureIds.add(culture.id);
}
if (totalNames !== 3325) throw new Error("Name pool must contain exactly 3,325 names; got " + totalNames + ".");

const countryCodes = new Set();
for (const country of payload.countries) {
  if (!country || typeof country.countryCode !== "string" || !/^[A-Z]{2,3}$/.test(country.countryCode) || countryCodes.has(country.countryCode)) {
    throw new Error("Invalid or duplicate country code in name pool.");
  }
  if (!Number.isFinite(country.globalWeight) || country.globalWeight < 0 || !Array.isArray(country.cultures) || country.cultures.length === 0) {
    throw new Error("Invalid nationality weighting for " + country.countryCode + ".");
  }
  const weightTotal = country.cultures.reduce((sum, entry) => {
    if (!entry || !cultureIds.has(entry.cultureId) || !Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error("Invalid culture mapping for " + country.countryCode + ".");
    }
    return sum + entry.weight;
  }, 0);
  if (Math.abs(weightTotal - 100) > 0.01) throw new Error("Culture weights must total 100% for " + country.countryCode + ".");
  countryCodes.add(country.countryCode);
}
const blocked = new Set(payload.blockedFullNames.map((name) => String(name).trim().toLocaleLowerCase("en-US")));
if (blocked.size !== 51 || payload.blockedFullNames.some((name) => typeof name !== "string" || !name.trim())) {
  throw new Error("Blocked full names must be 51 non-empty unique values.");
}
console.log("Validated 3,325 names across 52 cultures, 199 country profiles, and 51 blocked full names.");
