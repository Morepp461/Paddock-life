/** Deterministic RNG for simulation code. Never replace with Math.random(). */
export class SeededRandom {
  private state: number;
  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new Error("Seed harus berupa safe integer.");
    this.state = seed >>> 0;
  }
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }
  next(): number { return this.nextUint32() / 0x100000000; }
}
