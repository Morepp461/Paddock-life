import { SeededRandom } from "./SeededRandom";

/** Stable 32-bit hash used to derive per-session/per-lap/per-driver RNG seeds. */
export function hashSeed(parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  const input = parts.map(String).join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Box-Muller normal sample, clipped to the documented ±2.5σ bounds. */
export function sampleBoundedNormal(rng: SeededRandom, sigma: number, maxSigma = 2.5): number {
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new RangeError("Sigma harus berupa angka finite dan tidak negatif.");
  }
  if (!Number.isFinite(maxSigma) || maxSigma <= 0) {
    throw new RangeError("Batas sigma harus berupa angka positif yang valid.");
  }
  if (sigma === 0) return 0;

  const first = Math.max(rng.next(), Number.EPSILON);
  const second = rng.next();
  const standardNormal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return Math.max(-maxSigma * sigma, Math.min(maxSigma * sigma, standardNormal * sigma));
}
