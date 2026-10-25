import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { calculateBalanceAfterTransaction } from "./EconomyEngine";
import { TIER_CONFIG, type TierId } from "./GameConfig";
import { hashSeed } from "./RandomDistributions";
import {
  calculateDriverAskingSalary,
  evaluateContractOffer,
  findSalaryCounterOffer,
  generateDriverDemandFactor,
  isDriverTransferWindowOpen,
  validateContractDuration,
  type ContractAcceptanceTerms,
  type ContractOfferEvaluation,
} from "./ContractNegotiationEngine";

export type DriverContractOfferInput = {
  readonly careerId: string;
  readonly teamId: string;
  readonly driverId: string;
  readonly startSeason: number;
  readonly durationSeasons: number;
  readonly offeredSalary: number;
  readonly signingBonus?: number;
  readonly winBonus?: number;
  readonly podiumBonus?: number;
  readonly championshipBonus?: number;
  readonly releaseClause?: number | null;
  /** Active contract to buy out using its pre-agreed release clause. */
  readonly releaseClauseContractId?: string;
  readonly role: "lead" | "second";
};
export interface ContractOfferResult {
  readonly decision: "accepted" | "counter-offer" | "rejected";
  readonly score: number;
  readonly askingSalary: number;
  readonly contractId?: string;
  readonly counterOffer?: {
    readonly salary: number;
    readonly durationSeasons: number;
    readonly score: number;
  };
  readonly rejectionReasons?: readonly string[];
}
function n(row: DatabaseRow | undefined, key: string, fallback = 0): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}
function clampScore(value: number): number {
  return Math.max(0, Math.min(1.2, value));
}
function preferredLengthScore(age: number, ambition: number, duration: number): number {
  if (age >= 35) return duration >= 3 ? 1 : 0;
  if (age < 18 || ambition > 50) return duration <= 2 ? 1 : 0;
  return duration >= 2 && duration <= 3 ? 1 : 0;
}
function lowScoreReasons(terms: ContractAcceptanceTerms): string[] {
  const weighted = [
    { label: "gaji di bawah ekspektasi", value: 0.35 * Math.min(1.2, terms.offeredSalary / terms.askingSalary) },
    { label: "kursi balap kurang sesuai", value: 0.15 * terms.roleScore },
    { label: "reputasi tim kurang", value: 0.15 * terms.prestigeScore },
    { label: "peluang gelar kurang meyakinkan", value: 0.10 * terms.titleChanceScore },
    { label: "durasi kontrak kurang sesuai", value: 0.10 * terms.lengthScore },
    { label: "loyalty/ambition tidak cocok", value: 0.10 * terms.loyaltyAmbitionScore },
    { label: "bonus performa kurang", value: 0.05 * terms.bonusScore },
  ];
  return weighted.sort((a, b) => a.value - b.value).slice(0, 2).map((item) => item.label);
}
async function contractContext(database: IDatabase, input: DriverContractOfferInput) {
  const [careerRows, teamRows, driverRows, cars] = await Promise.all([
    database.query("SELECT world_seed, current_season, current_race FROM career WHERE career_id = ?;", [input.careerId]),
    database.query("SELECT team_id, reputation, cash, division_id, is_active, is_player_team FROM teams WHERE team_id = ? AND career_id = ?;", [input.teamId, input.careerId]),
    database.query("SELECT driver_id, name, age, ambition, loyalty, reputation, market_value, is_retired, is_academy_driver FROM drivers WHERE driver_id = ? AND career_id = ?;", [input.driverId, input.careerId]),
    database.query("SELECT AVG(engine_power + aero + high_speed + medium_speed + low_speed + mechanical_grip + traction + braking + tyre_management) / 9 AS car_score FROM cars WHERE team_id = ? AND season = ?;", [input.teamId, input.startSeason - 1]),
  ]);
  const career = careerRows[0], team = teamRows[0], driver = driverRows[0];
  if (!career || !team || !driver) throw new Error("Career, tim, atau driver untuk penawaran kontrak tidak ditemukan.");
  if (n(team, "is_active") !== 1) throw new Error("Tim tidak aktif dan tidak dapat merekrut driver.");
  const previousTeamContracts = await database.query(
    "SELECT contract_id FROM driver_contracts WHERE driver_id = ? AND team_id = ? AND start_season <= ? AND end_season = ?;",
    [input.driverId, input.teamId, input.startSeason - 1, input.startSeason - 1],
  );
  const isRenewal = previousTeamContracts.length > 0;
  if (n(team, "cash") < 0 && !isRenewal) {
    throw new Error("Tim tidak dapat merekrut saat saldo kas negatif; perpanjangan driver yang sudah membela tim tetap dapat dinegosiasikan.");
  }
  if (n(driver, "is_retired") === 1) throw new Error("Driver sudah pensiun.");
  const tier = Number(String(team.division_id).replace("T", "")) as TierId;
  const ageAtStart = n(driver, "age") + Math.max(0, input.startSeason - n(career, "current_season"));
  const band = TIER_CONFIG[tier].driverAge;
  if (ageAtStart < band.min || ageAtStart > band.max) throw new Error("Umur driver di luar rentang tier untuk season kontrak dimulai.");
  validateContractDuration(input.durationSeasons, ageAtStart);
  const activeContracts = await database.query(
    "SELECT contract_id, team_id, start_season, end_season, salary, signing_bonus, win_bonus, podium_bonus, championship_bonus, release_clause, team_option, driver_option FROM driver_contracts WHERE driver_id = ? AND start_season <= ? AND end_season >= ?;",
    [input.driverId, input.startSeason, input.startSeason],
  );
  let buyoutContract: DatabaseRow | undefined;
  if (activeContracts.length > 0) {
    if (!input.releaseClauseContractId || activeContracts.length !== 1 ||
        String(activeContracts[0]!.contract_id) !== input.releaseClauseContractId) {
      throw new Error("Driver sudah memiliki kontrak aktif. Transfer hanya dapat dilakukan dengan mengaktifkan release clause kontrak tersebut.");
    }
    buyoutContract = activeContracts[0]!;
    if (String(buyoutContract.team_id) === input.teamId) {
      throw new Error("Release clause tidak dapat digunakan untuk membeli kontrak milik tim sendiri.");
    }
    if (n(buyoutContract, "release_clause") <= 0) {
      throw new Error("Kontrak aktif driver tidak memiliki release clause yang dapat diaktifkan.");
    }
    if (n(team, "cash") < 0) {
      throw new Error("Tim tidak dapat membeli release clause saat saldo kas negatif.");
    }
  } else if (input.releaseClauseContractId) {
    throw new Error("Kontrak release clause yang dipilih tidak lagi aktif pada season target.");
  }
  const ageOffset = Math.max(0, input.startSeason - n(career, "current_season", 1));
  const teamSeatRows = await database.query(
    "SELECT COUNT(DISTINCT dc.driver_id) AS occupied_seats FROM driver_contracts dc JOIN drivers d ON d.driver_id = dc.driver_id WHERE dc.team_id = ? AND dc.start_season <= ? AND dc.end_season >= ? AND d.is_retired = 0 AND d.is_academy_driver = 0 AND d.age + ? BETWEEN ? AND ?;",
    [input.teamId, input.startSeason, input.startSeason, ageOffset, band.min, band.max],
  );
  if (n(teamSeatRows[0], "occupied_seats") >= 2) {
    throw new Error("Dua kursi race tim sudah terisi untuk season kontrak ini. Kontrak baru membutuhkan kursi kosong.");
  }
  const demandFactor = generateDriverDemandFactor({
    worldSeed: String(career.world_seed), season: input.startSeason, driverId: input.driverId,
  });
  const askingSalary = calculateDriverAskingSalary({
    marketValue: n(driver, "market_value"), ambition: n(driver, "ambition"), demandFactor,
  });
  const rankRows = await database.query(
    "SELECT team_id FROM standings WHERE season = ? AND division_id = ? AND driver_id IS NULL ORDER BY points DESC, wins DESC, team_id;",
    [input.startSeason - 1, String(team.division_id)],
  );
  const rankIndex = rankRows.findIndex((row) => String(row.team_id) === input.teamId);
  const rankScore = rankIndex < 0 ? 0.6 : clampScore(1.2 - rankIndex * 0.1);
  const carScore = n(cars[0], "car_score", TIER_CONFIG[tier].referenceCarScore);
  const carScoreRatio = clampScore(carScore / TIER_CONFIG[tier].referenceCarScore);
  const titleChanceScore = clampScore((rankScore + carScoreRatio) / 2);
  const prestigeScore = n(driver, "reputation") <= 0
    ? 1.2
    : clampScore(n(team, "reputation") / n(driver, "reputation"));
  const loyaltyAmbitionScore = input.startSeason > n(career, "current_season") && n(team, "reputation") / 100 < n(driver, "ambition")
    ? clampScore(1 - n(driver, "ambition") / 150)
    : clampScore(n(driver, "loyalty") / 100);
  const bonusTotal = n({ bonus: input.signingBonus ?? 0 }, "bonus") + (input.winBonus ?? 0)
    + (input.podiumBonus ?? 0) + (input.championshipBonus ?? 0);
  const bonusScore = askingSalary <= 0 ? (bonusTotal > 0 ? 1 : 0) : clampScore(bonusTotal / askingSalary);
  const clause = input.releaseClause ?? 0;
  const clausePenalty = clause > 0 && clause < (input.offeredSalary * 1.5) ? 0.05 : 0;
  const roleScore = input.role === "lead" ? 1 : 0.7;
  const lengthScore = preferredLengthScore(ageAtStart, n(driver, "ambition"), input.durationSeasons);
  return {
    career, team, driver, tier, ageAtStart, askingSalary, buyoutContract,
    terms: {
      offeredSalary: input.offeredSalary, askingSalary, roleScore, prestigeScore,
      titleChanceScore, lengthScore, loyaltyAmbitionScore, bonusScore, clausePenalty,
    } satisfies ContractAcceptanceTerms,
  };
}

export async function offerDriverContract(database: IDatabase, input: DriverContractOfferInput): Promise<ContractOfferResult> {
  if (!Number.isSafeInteger(input.startSeason) || input.startSeason < 1) throw new RangeError("Season kontrak harus integer positif.");
  for (const [name, value] of [
    ["offeredSalary", input.offeredSalary], ["signingBonus", input.signingBonus ?? 0],
    ["winBonus", input.winBonus ?? 0], ["podiumBonus", input.podiumBonus ?? 0],
    ["championshipBonus", input.championshipBonus ?? 0], ["releaseClause", input.releaseClause ?? 0],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(name + " tidak boleh negatif.");
  }
  const releaseClause = input.releaseClause ?? 0;
  if (releaseClause > 0 && (releaseClause < input.offeredSalary * 1.5 || releaseClause > input.offeredSalary * 3)) {
    throw new RangeError("Release clause harus 1.5–3 kali gaji tahunan, atau 0 jika tanpa klausul.");
  }
  const context = await contractContext(database, input);
  const currentSeason = n(context.career, "current_season", 1);
  const currentRace = n(context.career, "current_race", 1);
  const seasonStatus = await database.query(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM races WHERE season = ?;",
    [currentSeason],
  );
  const totalSeasonRaces = n(seasonStatus[0], "total");
  const completedSeasonRaces = n(seasonStatus[0], "completed");
  const seasonComplete = totalSeasonRaces > 0 && completedSeasonRaces === totalSeasonRaces;
  if (!isDriverTransferWindowOpen({
    currentSeason,
    targetSeason: input.startSeason,
    currentRace,
    roundsPerSeason: TIER_CONFIG[context.tier].roundsPerSeason,
    seasonComplete,
  })) {
    throw new Error("Jendela transfer driver sedang tertutup. Bursa dibuka sebelum race pertama atau pada tiga race pertengahan season yang ditentukan.");
  }
  const score = evaluateContractOffer(context.terms);
  const cooldownRows = await database.query(
    "SELECT last_score, until_season, until_race FROM driver_negotiation_cooldowns WHERE career_id = ? AND driver_id = ? AND team_id = ?;",
    [input.careerId, input.driverId, input.teamId],
  );
  const cooldown = cooldownRows[0];
  if (cooldown && (
      currentSeason < n(cooldown, "until_season") ||
      (currentSeason === n(cooldown, "until_season") && currentRace < n(cooldown, "until_race"))
    ) && score.score < n(cooldown, "last_score") + 0.1) {
    throw new Error("Driver menolak negosiasi ulang sampai setelah satu race, kecuali skor penawaran naik minimal 0.10.");
  }
  if (score.decision === "accepted") {
    const contractId = "contract_" + hashSeed([
      String(context.career.world_seed), input.careerId, input.teamId, input.driverId,
      input.startSeason, input.durationSeasons, input.offeredSalary,
    ]).toString(16).padStart(8, "0");
    const endSeason = input.startSeason + input.durationSeasons - 1;
    const signingBonus = input.signingBonus ?? 0;
    await database.transaction(async () => {
      const balance = calculateBalanceAfterTransaction({
        currentBalance: n(context.team, "cash"), amount: -signingBonus, tier: context.tier,
      });
      if (!balance.withinOverdraft) throw new Error("Signing bonus melewati batas overdraft 25% RequiredBudget.");
      if (signingBonus > 0) {
        await database.run("UPDATE teams SET cash = ? WHERE team_id = ?;", [balance.balanceAfter, input.teamId]);
        await database.run(
          "INSERT INTO finances (transaction_id, team_id, season, race, type, category, amount, balance_after) VALUES (?, ?, ?, ?, 'expense', 'contract-signing-bonus', ?, ?);",
          ["contract-bonus_" + contractId, input.teamId, currentSeason, currentRace, -signingBonus, balance.balanceAfter],
        );
      }
      await database.run(
        "INSERT INTO driver_contracts (contract_id, driver_id, team_id, start_season, end_season, salary, signing_bonus, win_bonus, podium_bonus, championship_bonus, release_clause, team_option, driver_option) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0);",
        [contractId, input.driverId, input.teamId, input.startSeason, endSeason, input.offeredSalary, signingBonus,
          input.winBonus ?? 0, input.podiumBonus ?? 0, input.championshipBonus ?? 0, input.releaseClause ?? null],
      );
      await database.run("UPDATE drivers SET is_academy_driver = 0 WHERE driver_id = ? AND career_id = ?;", [input.driverId, input.careerId]);
      await database.run("DELETE FROM driver_negotiation_cooldowns WHERE career_id = ? AND driver_id = ? AND team_id = ?;", [input.careerId, input.driverId, input.teamId]);
    });
    return { decision: "accepted", score: score.score, askingSalary: context.askingSalary, contractId };
  }
  if (score.decision === "counter-offer") {
    const counter = findSalaryCounterOffer(context.terms);
    if (counter) return {
      decision: "counter-offer", score: score.score, askingSalary: context.askingSalary,
      counterOffer: { salary: counter.offeredSalary, durationSeasons: input.durationSeasons, score: counter.evaluation.score },
      rejectionReasons: lowScoreReasons(context.terms),
    };
    const maxDuration = context.ageAtStart < 18 ? 2 : 4;
    for (const duration of [1, 2, 3, 4].filter((value) => value <= maxDuration && value !== input.durationSeasons)) {
      const lengthScore = preferredLengthScore(context.ageAtStart, n(context.driver, "ambition"), duration);
      const candidateTerms = { ...context.terms, lengthScore };
      const candidate = findSalaryCounterOffer(candidateTerms);
      if (candidate) return {
        decision: "counter-offer", score: score.score, askingSalary: context.askingSalary,
        counterOffer: { salary: candidate.offeredSalary, durationSeasons: duration, score: candidate.evaluation.score },
        rejectionReasons: lowScoreReasons(context.terms),
      };
    }
  }
  const reasons = lowScoreReasons(context.terms);
  await database.run(
    `INSERT INTO driver_negotiation_cooldowns (career_id, driver_id, team_id, last_score, until_season, until_race, rejection_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(career_id, driver_id, team_id) DO UPDATE SET last_score = excluded.last_score,
       until_season = excluded.until_season, until_race = excluded.until_race,
       rejection_reason = excluded.rejection_reason, updated_at = CURRENT_TIMESTAMP;`,
    [input.careerId, input.driverId, input.teamId, score.score, currentSeason, currentRace + 1, reasons.join("; ")],
  );
  return { decision: "rejected", score: score.score, askingSalary: context.askingSalary, rejectionReasons: reasons };
}
