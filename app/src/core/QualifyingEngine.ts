import { TIER_CONFIG, type QualifyingFormat, type TierId } from "./GameConfig";

export interface QualifyingDriver {
  readonly driverId: string;
  readonly driverName: string;
}

export interface QualifyingSessionTimes {
  /** Each value is the best lap recorded by the driver during this session. */
  readonly bestLapSecondsByDriver: Readonly<Record<string, number>>;
}

export interface QualifyingClassificationEntry {
  readonly driverId: string;
  readonly driverName: string;
  readonly gridPosition: number;
  readonly bestLapSeconds: number;
  readonly eliminatedIn: "Q1" | "Q2" | null;
}

export interface QualifyingResult {
  readonly tier: TierId;
  readonly format: QualifyingFormat;
  readonly classification: readonly QualifyingClassificationEntry[];
  readonly sessionOrder: readonly (readonly string[])[];
}

function rankSession(
  drivers: readonly QualifyingDriver[],
  times: Readonly<Record<string, number>>,
): QualifyingDriver[] {
  for (const driver of drivers) {
    const time = times[driver.driverId];
    if (!Number.isFinite(time) || time <= 0) {
      throw new Error(`Waktu qualifying tidak valid atau hilang untuk ${driver.driverId}.`);
    }
  }
  return [...drivers].sort((left, right) =>
    times[left.driverId] - times[right.driverId] || left.driverId.localeCompare(right.driverId),
  );
}

function validateDrivers(drivers: readonly QualifyingDriver[], gridSize: number): void {
  if (drivers.length !== gridSize) {
    throw new RangeError(`Grid Tier ini membutuhkan tepat ${gridSize} driver; diterima ${drivers.length}.`);
  }
  const ids = new Set<string>();
  for (const driver of drivers) {
    if (!driver.driverId.trim() || !driver.driverName.trim() || ids.has(driver.driverId)) {
      throw new Error("Driver qualifying harus memiliki ID/nama unik yang valid.");
    }
    ids.add(driver.driverId);
  }
}

/**
 * Classifies best lap times supplied by a session simulator. This module does not
 * invent a lap count for 10/15-minute sessions; it only applies documented cuts.
 */
export function classifyQualifying(input: {
  readonly tier: TierId;
  readonly drivers: readonly QualifyingDriver[];
  readonly sessions: readonly QualifyingSessionTimes[];
}): QualifyingResult {
  const config = TIER_CONFIG[input.tier];
  validateDrivers(input.drivers, config.gridSize);

  const expectedSessions = config.qualifyingFormat === "q1-24-12-q2" ? 2
    : config.qualifyingFormat === "q1-24-18-q2-18-12-q3" ? 3 : 1;
  if (input.sessions.length !== expectedSessions) {
    throw new RangeError(`Format ${config.qualifyingFormat} membutuhkan ${expectedSessions} sesi hasil.`);
  }

  const originalOrder = new Map(input.drivers.map((driver, index) => [driver.driverId, index]));
  const grid: Array<QualifyingClassificationEntry | undefined> = Array(input.drivers.length);
  const sessionOrder: string[][] = [];
  let active = [...input.drivers];

  if (expectedSessions === 1) {
    const ranked = rankSession(active, input.sessions[0].bestLapSecondsByDriver);
    sessionOrder.push(ranked.map((driver) => driver.driverId));
    ranked.forEach((driver, index) => {
      grid[index] = {
        driverId: driver.driverId,
        driverName: driver.driverName,
        gridPosition: index + 1,
        bestLapSeconds: input.sessions[0].bestLapSecondsByDriver[driver.driverId],
        eliminatedIn: null,
      };
    });
  } else {
    const q1 = rankSession(active, input.sessions[0].bestLapSecondsByDriver);
    sessionOrder.push(q1.map((driver) => driver.driverId));
    const q1Cut = config.qualifyingFormat === "q1-24-12-q2" ? 12 : 18;
    const q1Advanced = q1.slice(0, q1Cut);
    const q1Eliminated = q1.slice(q1Cut).sort((left, right) =>
      input.sessions[0].bestLapSecondsByDriver[left.driverId] - input.sessions[0].bestLapSecondsByDriver[right.driverId]
      || (originalOrder.get(left.driverId)! - originalOrder.get(right.driverId)!),
    );
    q1Eliminated.forEach((driver, index) => {
      grid[q1Cut + index] = {
        driverId: driver.driverId,
        driverName: driver.driverName,
        gridPosition: q1Cut + index + 1,
        bestLapSeconds: input.sessions[0].bestLapSecondsByDriver[driver.driverId],
        eliminatedIn: "Q1",
      };
    });

    const q2 = rankSession(q1Advanced, input.sessions[1].bestLapSecondsByDriver);
    sessionOrder.push(q2.map((driver) => driver.driverId));
    if (expectedSessions === 2) {
      q2.forEach((driver, index) => {
        grid[index] = {
          driverId: driver.driverId,
          driverName: driver.driverName,
          gridPosition: index + 1,
          bestLapSeconds: input.sessions[1].bestLapSecondsByDriver[driver.driverId],
          eliminatedIn: null,
        };
      });
    } else {
      const q2Cut = 12;
      const q2Advanced = q2.slice(0, q2Cut);
      const q2Eliminated = q2.slice(q2Cut);
      q2Eliminated.forEach((driver, index) => {
        grid[q2Cut + index] = {
          driverId: driver.driverId,
          driverName: driver.driverName,
          gridPosition: q2Cut + index + 1,
          bestLapSeconds: input.sessions[1].bestLapSecondsByDriver[driver.driverId],
          eliminatedIn: "Q2",
        };
      });
      const q3 = rankSession(q2Advanced, input.sessions[2].bestLapSecondsByDriver);
      sessionOrder.push(q3.map((driver) => driver.driverId));
      q3.forEach((driver, index) => {
        grid[index] = {
          driverId: driver.driverId,
          driverName: driver.driverName,
          gridPosition: index + 1,
          bestLapSeconds: input.sessions[2].bestLapSecondsByDriver[driver.driverId],
          eliminatedIn: null,
        };
      });
    }
  }

  if (grid.some((entry) => entry === undefined)) throw new Error("Klasifikasi qualifying tidak lengkap.");
  return {
    tier: input.tier,
    format: config.qualifyingFormat,
    classification: grid as QualifyingClassificationEntry[],
    sessionOrder,
  };
}
