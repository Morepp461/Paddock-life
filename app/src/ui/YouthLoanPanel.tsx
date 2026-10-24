import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { IDatabase, DatabaseRow } from "../storage/IDatabase";
import { TIER_CONFIG, type TierId } from "../core/GameConfig";
import { createYouthDriverLoan } from "../core/YouthLoanService";

interface YouthLoanPanelProps {
  readonly database: IDatabase;
  readonly careerId: string;
  readonly ownerTeamId: string;
  readonly ownerTier: TierId;
  readonly onChanged: () => Promise<void> | void;
}
type AcademyDriver = DatabaseRow & { driver_id: string; name: string; age: number; salary: number };
type LoanTeam = DatabaseRow & { team_id: string; name: string; division_id: string };
type LoanRow = DatabaseRow & {
  loan_id: string; driver_name: string; owner_name: string; borrower_name: string;
  start_season: number; status: string; salary: number;
};
function textValue(row: DatabaseRow, key: string): string { return String(row[key] ?? ""); }
function numberValue(row: DatabaseRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}
function cash(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value) + " ¢p";
}
function tierFromDivision(value: string): TierId {
  return Number(value.replace(/^T/, "")) as TierId;
}

export default function YouthLoanPanel({ database, careerId, ownerTeamId, ownerTier, onChanged }: YouthLoanPanelProps) {
  const [season, setSeason] = useState(1);
  const [currentRace, setCurrentRace] = useState(1);
  const [academyDrivers, setAcademyDrivers] = useState<AcademyDriver[]>([]);
  const [lowerTeams, setLowerTeams] = useState<LoanTeam[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [driverId, setDriverId] = useState("");
  const [loanTeamId, setLoanTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const [careerRows, drivers, teams, loanRows] = await Promise.all([
      database.query("SELECT current_season, current_race FROM career WHERE career_id = ?;", [careerId]),
      database.query(
        `SELECT d.driver_id, d.name, d.age, dc.salary
         FROM drivers d JOIN driver_contracts dc ON dc.driver_id = d.driver_id
         WHERE d.career_id = ? AND dc.team_id = ? AND dc.start_season <=
           (SELECT current_season FROM career WHERE career_id = ?) AND dc.end_season >=
           (SELECT current_season FROM career WHERE career_id = ?)
           AND d.is_academy_driver = 1 AND d.is_retired = 0 AND d.loaned_to_team_id IS NULL
         ORDER BY d.age DESC, d.name;`,
        [careerId, ownerTeamId, careerId, careerId],
      ),
      database.query(
        "SELECT team_id, name, division_id FROM teams WHERE career_id = ? AND is_active = 1 AND CAST(SUBSTR(division_id, 2) AS INTEGER) > ? ORDER BY CAST(SUBSTR(division_id, 2) AS INTEGER), name;",
        [careerId, ownerTier],
      ),
      database.query(
        `SELECT l.loan_id, l.start_season, l.status, d.name AS driver_name, ot.name AS owner_name, bt.name AS borrower_name, dc.salary
         FROM driver_loans l
         JOIN drivers d ON d.driver_id = l.driver_id
         JOIN teams ot ON ot.team_id = l.owner_team_id
         JOIN teams bt ON bt.team_id = l.loan_team_id
         JOIN driver_contracts dc ON dc.driver_id = l.driver_id AND dc.team_id = l.owner_team_id
         WHERE l.career_id = ? AND (l.owner_team_id = ? OR l.loan_team_id = ?)
         ORDER BY l.start_season DESC, d.name;`,
        [careerId, ownerTeamId, ownerTeamId],
      ),
    ]);
    setSeason(numberValue(careerRows[0] ?? {}, "current_season") || 1);
    setCurrentRace(numberValue(careerRows[0] ?? {}, "current_race") || 1);
    setAcademyDrivers(drivers as AcademyDriver[]);
    setLowerTeams(teams as LoanTeam[]);
    setLoans(loanRows as LoanRow[]);
    setDriverId((current) => drivers.some((row) => textValue(row, "driver_id") === current) ? current : textValue(drivers[0] ?? {}, "driver_id"));
    setLoanTeamId((current) => teams.some((row) => textValue(row, "team_id") === current) ? current : textValue(teams[0] ?? {}, "team_id"));
  }, [database, careerId, ownerTeamId, ownerTier]);

  useEffect(() => { void reload().catch((caught) => setError(caught instanceof Error ? caught.message : "Youth Loan data gagal dimuat.")); }, [reload]);

  const selectedDriver = academyDrivers.find((driver) => driver.driver_id === driverId);
  const compatibleTeams = useMemo(() => lowerTeams.filter((team) => {
    if (!selectedDriver) return true;
    const tier = tierFromDivision(team.division_id);
    const band = TIER_CONFIG[tier].driverAge;
    return selectedDriver.age >= band.min && selectedDriver.age <= band.max;
  }), [lowerTeams, selectedDriver]);

  useEffect(() => {
    if (!compatibleTeams.some((team) => team.team_id === loanTeamId)) setLoanTeamId(compatibleTeams[0]?.team_id ?? "");
  }, [compatibleTeams, loanTeamId]);

  async function submitLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !driverId || !loanTeamId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await createYouthDriverLoan(database, {
        careerId, driverId, ownerTeamId, loanTeamId, season,
      });
      setNotice(`Loan dibuat untuk Season ${result.season}. Tim pemilik menanggung 80% gaji dan tim peminjam 20%.`);
      await reload();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Youth Loan gagal dibuat.");
    } finally { setBusy(false); }
  }

  return <section className="career-panel youth-loan-panel">
    <div className="panel-title"><div><small>DRIVER ACADEMY</small><h2>Youth Loan</h2></div><span className="status-chip">{loans.filter((loan) => loan.status === "active").length} active</span></div>
    <p className="muted-text">Pinjamkan driver akademi ke divisi lebih rendah selama satu season penuh. Kontrak tetap di tim asal; gaji dibagi 80% / 20%.</p>
    {currentRace !== 1 && <p className="inline-error">Youth Loan hanya dapat dimulai sebelum race pertama season berjalan.</p>}
    {currentRace === 1 && <form className="contract-offer-form youth-loan-form" onSubmit={(event) => void submitLoan(event)}>
      <label>Academy driver<select required value={driverId} onChange={(event) => setDriverId(event.target.value)}><option value="" disabled>Pilih driver akademi</option>{academyDrivers.map((driver) => <option key={driver.driver_id} value={driver.driver_id}>{driver.name} · Age {driver.age} · {cash(driver.salary)}/season</option>)}</select></label>
      <label>Borrower team<select required value={loanTeamId} onChange={(event) => setLoanTeamId(event.target.value)}><option value="" disabled>Pilih tim divisi lebih rendah</option>{compatibleTeams.map((team) => <option key={team.team_id} value={team.team_id}>Tier {tierFromDivision(team.division_id)} · {team.name}</option>)}</select></label>
      <button className="primary-button" type="submit" disabled={busy || !driverId || !loanTeamId || compatibleTeams.length === 0}>{busy ? "Creating loan…" : "Create one-season loan →"}</button>
    </form>}
    {!academyDrivers.length && <p className="muted-text">Tidak ada driver akademi tersedia untuk dipinjamkan.</p>}
    {currentRace === 1 && selectedDriver && !compatibleTeams.length && <p className="muted-text">Tidak ada tim divisi lebih rendah yang cocok dengan batas umur driver ini.</p>}
    {error && <p className="inline-error">{error}</p>}
    {notice && <p className="form-note">{notice}</p>}
    <div className="table-scroll"><table className="career-table"><thead><tr><th>DRIVER</th><th>OWNER</th><th>BORROWER</th><th>SEASON</th><th>STATUS</th></tr></thead><tbody>
      {loans.map((loan) => <tr key={loan.loan_id}><td>{loan.driver_name}<small>{cash(numberValue(loan, "salary"))}/season</small></td><td>{loan.owner_name}</td><td>{loan.borrower_name}</td><td>{loan.start_season}</td><td><span className={loan.status === "active" ? "status-chip complete" : "status-chip"}>{loan.status}</span></td></tr>)}
      {!loans.length && <tr><td colSpan={5} className="muted-text">Belum ada riwayat Youth Loan.</td></tr>}
    </tbody></table></div>
  </section>;
}
