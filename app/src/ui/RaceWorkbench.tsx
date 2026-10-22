import { useMemo, useState } from "react";
import { simulateRace, type RaceResult } from "../core/RaceEngine";
import { TIER_CONFIG, type TierId } from "../core/GameConfig";
import { SeededRandom } from "../core/SeededRandom";
import { hashSeed } from "../core/RandomDistributions";
import type { TrackCondition, TyreCompound } from "../core/TyreEngine";

const CONDITIONS: readonly TrackCondition[] = ["dry", "damp", "wet", "heavy-wet"];
const COMPOUNDS: readonly TyreCompound[] = ["soft", "medium", "hard", "intermediate", "wet"];

function scoreAround(random: SeededRandom, reference: number): number {
  return Math.max(5, Math.min(99, Math.round(reference + (random.next() - 0.5) * 18)));
}

function makeTestDrivers(tier: TierId, seed: string, compound: TyreCompound) {
  const config = TIER_CONFIG[tier];
  const random = new SeededRandom(hashSeed([seed, "paddock-life-workbench"]));
  return Array.from({ length: config.gridSize }, (_, index) => ({
    id: `TEST-${String(index + 1).padStart(2, "0")}`,
    name: `Test Driver ${String(index + 1).padStart(2, "0")}`,
    carScore: scoreAround(random, config.referenceCarScore),
    driverScore: scoreAround(random, config.referenceDriverOverall),
    setupScore: scoreAround(random, 50),
    formModifier: Number(((random.next() - 0.5) * 2).toFixed(3)),
    aggression: Math.round(35 + random.next() * 40),
    tyreManagement: Math.round(35 + random.next() * 40),
    mechanicalGrip: scoreAround(random, config.referenceCarScore),
    compound,
    weatherAdaptation: Math.round(25 + random.next() * 60),
  }));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export default function RaceWorkbench() {
  const [tier, setTier] = useState<TierId>(1);
  const [laps, setLaps] = useState(8);
  const [seed, setSeed] = useState("paddock-test-001");
  const [condition, setCondition] = useState<TrackCondition>("dry");
  const [compound, setCompound] = useState<TyreCompound>("medium");
  const [lapSeconds, setLapSeconds] = useState(90);
  const [abrasion, setAbrasion] = useState(50);
  const [temperature, setTemperature] = useState(25);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [error, setError] = useState("");
  const [selectedLap, setSelectedLap] = useState(8);
  const [runCount, setRunCount] = useState(0);

  const drivers = useMemo(() => makeTestDrivers(tier, seed, compound), [tier, seed, compound]);
  const visibleLap = result ? Math.min(selectedLap, result.totalLaps) : 0;
  const lapRows = result?.laps[visibleLap - 1] ?? [];

  function runSimulation() {
    try {
      setError("");
      const nextResult = simulateRace({
        worldSeed: seed,
        season: 1,
        round: 1,
        tier,
        estimatedCircuitLapSeconds: lapSeconds,
        totalLaps: laps,
        trackAbrasion: abrasion,
        trackTemperatureCelsius: temperature,
        trackCondition: condition,
        referenceSetupScore: 50,
        drivers,
      });
      setResult(nextResult);
      setSelectedLap(laps);
      setRunCount((count) => count + 1);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "Simulasi gagal karena kesalahan yang tidak diketahui.");
    }
  }

  return (
    <main className="workbench-shell">
      <header className="workbench-header">
        <a className="brand-mark" href="#" aria-label="Paddock Life">PL</a>
        <div><span className="eyebrow">MOTORSPORT MANAGEMENT</span><strong>PADDOCK LIFE</strong></div>
        <span className="build-tag">QA / SIMULATION</span>
      </header>

      <section className="workbench-intro">
        <p className="eyebrow">DEVELOPMENT BUILD · NOT A RELEASE</p>
        <h1>Race <span>Workbench</span></h1>
        <p>Jalankan simulasi deterministik dari race engine yang sudah ada untuk menguji build di browser atau Android. Data driver di halaman ini adalah fixture QA, bukan roster karier.</p>
      </section>

      <section className="workbench-panel" aria-labelledby="config-title">
        <div className="panel-heading"><div><span className="section-index">01 / CONFIGURATION</span><h2 id="config-title">Race parameters</h2></div><span className="qa-label">TEST INPUTS</span></div>
        <div className="field-grid">
          <label>Tier
            <select value={tier} onChange={(event) => { setTier(Number(event.target.value) as TierId); setResult(null); }}>
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>Tier {value} · {TIER_CONFIG[value as TierId].name}</option>)}
            </select>
          </label>
          <label>Track condition
            <select value={condition} onChange={(event) => { setCondition(event.target.value as TrackCondition); setResult(null); }}>
              {CONDITIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Tyre compound
            <select value={compound} onChange={(event) => { setCompound(event.target.value as TyreCompound); setResult(null); }}>
              {COMPOUNDS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Race laps (min. 8)
            <input type="number" min="8" max="100" step="1" value={laps} onChange={(event) => { setLaps(Number(event.target.value)); setResult(null); }} />
          </label>
          <label>Estimated lap time (seconds)
            <input type="number" min="30" max="300" step="0.1" value={lapSeconds} onChange={(event) => { setLapSeconds(Number(event.target.value)); setResult(null); }} />
          </label>
          <label>Track abrasion (0–100)
            <input type="number" min="0" max="100" step="1" value={abrasion} onChange={(event) => { setAbrasion(Number(event.target.value)); setResult(null); }} />
          </label>
          <label>Track temperature (°C)
            <input type="number" min="-20" max="80" step="1" value={temperature} onChange={(event) => { setTemperature(Number(event.target.value)); setResult(null); }} />
          </label>
          <label>Deterministic seed
            <input value={seed} maxLength={80} onChange={(event) => { setSeed(event.target.value); setResult(null); }} />
          </label>
        </div>
        <div className="workbench-actions">
          <button type="button" onClick={runSimulation} disabled={!seed.trim() || !Number.isInteger(laps) || laps < 8 || laps > 100 || !Number.isFinite(lapSeconds) || lapSeconds <= 0 || !Number.isFinite(abrasion) || abrasion < 0 || abrasion > 100 || !Number.isFinite(temperature)}>Run simulation</button>
          <span>Grid: {TIER_CONFIG[tier].gridSize} test drivers · season 1 / round 1</span>
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>

      {result ? <section className="workbench-panel results-panel" aria-labelledby="results-title">
        <div className="panel-heading"><div><span className="section-index">02 / CLASSIFICATION</span><h2 id="results-title">Race result</h2></div><span className="qa-label">RUN #{runCount}</span></div>
        <div className="result-summary">
          <div><span>Winner</span><strong>{result.classification[0]?.driverName ?? "—"}</strong></div>
          <div><span>Distance</span><strong>{result.totalLaps} laps</strong></div>
          <div><span>Finish time</span><strong>{formatTime(result.classification[0]?.cumulativeTimeSeconds ?? 0)}</strong></div>
          <div><span>Seed</span><strong>{seed}</strong></div>
        </div>
        <div className="lap-selector">
          <label htmlFor="lap-select">Inspect lap</label>
          <input id="lap-select" type="range" min="1" max={result.totalLaps} value={visibleLap} onChange={(event) => setSelectedLap(Number(event.target.value))} />
          <strong>Lap {visibleLap} / {result.totalLaps}</strong>
        </div>
        <div className="table-scroll"><table className="classification-table">
          <thead><tr><th>Pos</th><th>Driver</th><th>Lap time</th><th>Gap</th><th>Tyre wear</th><th>Condition</th></tr></thead>
          <tbody>{lapRows.map((row) => <tr key={row.driverId}><td>{row.position.toString().padStart(2, "0")}</td><td>{row.driverName}</td><td>{formatTime(row.lapTimeSeconds)}</td><td>{row.position === 1 ? "LEADER" : `+${row.gapToLeaderSeconds.toFixed(3)}s`}</td><td>{row.tyreWearPercent.toFixed(1)}%</td><td>{row.trackCondition}</td></tr>)}</tbody>
        </table></div>
        <p className="determinism-note">Ulangi simulasi dengan seed dan input yang sama. Hasil harus identik. Ubah seed untuk menguji variasi hasil yang tetap deterministik.</p>
      </section> : <section className="empty-state"><span className="section-index">02 / RESULTS</span><h2>Waiting for simulation</h2><p>Belum ada hasil. Jalankan simulasi untuk memeriksa classification, lap time, gap, dan tyre wear.</p></section>}

      <footer className="workbench-footer"><span>PADDOCK LIFE / INTERNAL TEST BUILD</span><span>Career Mode belum terhubung ke halaman ini.</span></footer>
    </main>
  );
}
