import { useState } from "react";
import { calculateDriverAskingSalary, generateDriverDemandFactor } from "../core/ContractNegotiationEngine";
import { offerDriverContract } from "../core/CareerContractService";
import type { TierId } from "../core/GameConfig";
import type { IDatabase } from "../storage/IDatabase";

type Row = Readonly<Record<string, unknown>>;
type Props = {
  database: IDatabase;
  careerId: string;
  teamId: string;
  currentSeason: number;
  worldSeed: string;
  tier: TierId;
  drivers: readonly Row[];
  onChanged: () => Promise<void>;
};

function value(row: Row, key: string, fallback = ""): string {
  const raw = row[key];
  return raw === null || raw === undefined ? fallback : String(raw);
}
function numberValue(row: Row, key: string, fallback = 0): number {
  const result = Number(row[key]);
  return Number.isFinite(result) ? result : fallback;
}
function cash(amount: number): string {
  return "¢p " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount);
}

export default function DriverMarketPanel(props: Props) {
  const [driverId, setDriverId] = useState("");
  const [salary, setSalary] = useState("");
  const [duration, setDuration] = useState("2");
  const [bonus, setBonus] = useState("0");
  const [role, setRole] = useState<"lead" | "second">("lead");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = props.drivers.find((driver) => value(driver, "driver_id") === driverId) ?? props.drivers[0];
  const asking = selected ? calculateDriverAskingSalary({
    marketValue: numberValue(selected, "market_value"),
    ambition: numberValue(selected, "ambition"),
    demandFactor: generateDriverDemandFactor({
      worldSeed: props.worldSeed,
      season: props.currentSeason,
      driverId: value(selected, "driver_id"),
    }),
  }) : 0;

  function chooseDriver(nextId: string) {
    setDriverId(nextId);
    const driver = props.drivers.find((item) => value(item, "driver_id") === nextId);
    if (!driver) return;
    const expected = calculateDriverAskingSalary({
      marketValue: numberValue(driver, "market_value"),
      ambition: numberValue(driver, "ambition"),
      demandFactor: generateDriverDemandFactor({
        worldSeed: props.worldSeed,
        season: props.currentSeason,
        driverId: value(driver, "driver_id"),
      }),
    });
    setSalary(String(expected));
    setDuration(numberValue(driver, "age") < 18 ? "1" : "2");
    setMessage("");
    setError("");
  }

  async function submitOffer() {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const offeredSalary = Number(salary || String(asking));
      const signingBonus = Number(bonus);
      if (!Number.isSafeInteger(offeredSalary) || offeredSalary < 0 ||
          !Number.isSafeInteger(signingBonus) || signingBonus < 0) {
        throw new Error("Gaji dan signing bonus harus berupa bilangan bulat non-negatif.");
      }
      const result = await offerDriverContract(props.database, {
        careerId: props.careerId,
        teamId: props.teamId,
        driverId: value(selected, "driver_id"),
        startSeason: props.currentSeason,
        durationSeasons: Number(duration),
        offeredSalary,
        signingBonus,
        role,
      });
      if (result.decision === "accepted") {
        setMessage("Kontrak diterima. " + value(selected, "name") + " bergabung dengan gaji " + cash(offeredSalary) + " per season.");
        await props.onChanged();
      } else if (result.decision === "counter-offer") {
        const counterSalary = result.counterOffer?.salary ?? asking;
        const counterDuration = result.counterOffer?.durationSeasons ?? Number(duration);
        setSalary(String(counterSalary));
        setDuration(String(counterDuration));
        setMessage("Counter-offer: " + cash(counterSalary) + " per season selama " + counterDuration +
          " season. Alasan: " + (result.rejectionReasons ?? []).join(", ") + ".");
      } else {
        setMessage("Penawaran ditolak. Alasan: " + (result.rejectionReasons ?? []).join(", ") +
          ". Coba naikkan skor setidaknya 0,10 atau tunggu satu race.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Negosiasi gagal. Tidak ada kontrak yang disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="career-grid">
    <article className="career-panel wide-panel">
      <div className="panel-title"><div><small>TRANSFER MARKET / FREE AGENTS</small><h2>Find your next driver</h2></div><span>{props.drivers.length} eligible drivers</span></div>
      <p className="muted-text">Daftar ini berisi free agent dan driver academy yang memenuhi batas umur Tier {props.tier} untuk season berikutnya. Kontrak mulai season {props.currentSeason}. Negosiasi dengan driver yang masih terikat kontrak, release clause, dan tawaran AI belum tersedia di layar ini.</p>
      {props.drivers.length === 0 ? <p className="muted-text">Tidak ada free agent yang memenuhi syarat umur divisi saat ini.</p> : <>
        <label className="market-driver-select">Driver
          <select value={value(selected ?? {}, "driver_id")} onChange={(event) => chooseDriver(event.target.value)}>
            {props.drivers.map((driver) => <option key={value(driver, "driver_id")} value={value(driver, "driver_id")}>
              {value(driver, "name")} · age {value(driver, "age")} · pace {numberValue(driver, "pace").toFixed(1)}
            </option>)}
          </select>
        </label>
        {selected && <div className="market-driver-profile">
          <div><small>DRIVER PROFILE</small><h3>{value(selected, "name")}</h3><p>{value(selected, "nationality")} · Age {value(selected, "age")}</p></div>
          <div className="market-stats">
            <span>PACE <b>{numberValue(selected, "pace").toFixed(1)}</b></span>
            <span>QUALI <b>{numberValue(selected, "qualifying").toFixed(1)}</b></span>
            <span>RACECRAFT <b>{numberValue(selected, "racecraft").toFixed(1)}</b></span>
            <span>ASKING SALARY <b>{cash(asking)}</b></span>
          </div>
          <div className="form-grid market-contract-form">
            <label>Offered salary / season<input type="number" min="0" step="1" value={salary || String(asking)} onChange={(event) => setSalary(event.target.value)} required /></label>
            <label>Contract length<select value={duration} onChange={(event) => setDuration(event.target.value)}>
              {[1, 2, 3, 4].filter((item) => numberValue(selected, "age") >= 18 || item <= 2).map((item) =>
                <option key={item} value={item}>{item} season{item > 1 ? "s" : ""}</option>)}
            </select></label>
            <label>Signing bonus<input type="number" min="0" step="1" value={bonus} onChange={(event) => setBonus(event.target.value)} required /></label>
            <label>Driver role<select value={role} onChange={(event) => setRole(event.target.value as "lead" | "second")}><option value="lead">Lead driver</option><option value="second">Second driver</option></select></label>
          </div>
          <p className="form-note">Skor kontrak memakai gaji, peran, reputasi, peluang gelar, durasi, loyalty/ambition, bonus, dan penalti klausul sesuai dokumen Career Rules.</p>
          <button className="primary-button" disabled={busy} onClick={() => void submitOffer()}>{busy ? "Negotiating…" : "Submit contract offer →"}</button>
        </div>}
      </>}
      {error && <p className="inline-error">{error}</p>}
      {message && <p className="market-result-message">{message}</p>}
    </article>
  </section>;
}
