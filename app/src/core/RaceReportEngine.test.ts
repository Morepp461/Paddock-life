import { describe, expect, it } from "vitest";
import { buildRaceReport, type RaceReportCause } from "./RaceReportEngine";

const causes: RaceReportCause[] = [
  { type: "pace", secondsLost: 4.2, explanation: "Mobil lebih lambat dari referensi." },
  { type: "tyre", secondsLost: 8.5, explanation: "Keausan ban melewati cliff." },
  { type: "strategy", secondsLost: 12, explanation: "Strategi berhenti kurang optimal." },
  { type: "reliability", secondsLost: 0, explanation: "Tidak ada waktu hilang karena reliability." },
  { type: "pit-loss", secondsLost: 5.1, explanation: "Pit stop lebih lama dari rencana." },
];

describe("race report", () => {
  it("calculates strategy score and orders the five documented causes by time lost", () => {
    const report = buildRaceReport({ actualRaceTimeSeconds: 6000, optimalRaceTimeSeconds: 5995, causes });
    expect(report.strategyDeficitSeconds).toBe(5);
    expect(report.strategyScore).toBe(30);
    expect(report.mainCauses.map((cause) => cause.type)).toEqual(["strategy", "tyre", "pit-loss", "pace", "reliability"]);
  });

  it("clamps strategy score to the 0–100 scale", () => {
    expect(buildRaceReport({ actualRaceTimeSeconds: 7000, optimalRaceTimeSeconds: 6000, causes }).strategyScore).toBe(0);
    expect(buildRaceReport({ actualRaceTimeSeconds: 5900, optimalRaceTimeSeconds: 6000, causes }).strategyScore).toBe(100);
  });

  it("rejects missing, duplicate, or invalid causes and race times", () => {
    expect(() => buildRaceReport({ actualRaceTimeSeconds: 0, optimalRaceTimeSeconds: 1, causes })).toThrow(RangeError);
    expect(() => buildRaceReport({ actualRaceTimeSeconds: 10, optimalRaceTimeSeconds: 9, causes: causes.slice(0, 4) })).toThrow("lima penyebab");
    expect(() => buildRaceReport({ actualRaceTimeSeconds: 10, optimalRaceTimeSeconds: 9, causes: [...causes, causes[0]] })).toThrow("duplikat");
  });
});
