import { useEffect, useMemo, useState } from "react";
import { simulateRaceWeekend, type RaceWeekendResult } from "../core/RaceWeekendEngine";
import { calculateRaceLapCount, TIER_CONFIG, type TierId } from "../core/GameConfig";
import { SeededRandom } from "../core/SeededRandom";
import { hashSeed } from "../core/RandomDistributions";
import type { TrackCondition, TyreCompound } from "../core/TyreEngine";
import { validateCircuitSeed } from "../seed/SeedDataLoader";
import { planMandatoryDryTwoCompoundStrategy } from "../core/MandatoryDryTyreStrategy";
import { availableTyreCompounds } from "../core/RaceTyreSelection";

const CONDITIONS: readonly TrackCondition[] = ["dry", "damp", "wet", "heavy-wet"];

type TestCircuit = { id: string; name: string; country: string; lengthKm: number; standardLaps: number; estimatedLapSeconds: number; abrasion: number };

function scoreAround(random: SeededRandom, reference: number): number {
  return Math.max(5, Math.min(99, Math.round(reference + (random.next() - 0.5) * 18)));
}

function makeTestDrivers(tier: TierId, seed: string, compound: TyreCompound) {
  const config = TIER_CONFIG[tier];
  const random = new SeededRandom(hashSeed([seed, "paddock-life-workbench"]));
  return Array.from({ length: config.gridSize }, (_, index) => {
    const driverScore = scoreAround(random, config.referenceDriverOverall);
    return {
      id: `TEST-${String(index + 1).padStart(2, "0")}`,
      name: `Test Driver ${String(index + 1).padStart(2, "0")}`,
      carScore: scoreAround(random, config.referenceCarScore),
      driverScore,
      qualifyingScore: scoreAround(random, config.referenceDriverOverall),
      setupScore: scoreAround(random, 50),
      formModifier: Number(((random.next() - 0.5) * 2).toFixed(3)),
      aggression: Math.round(35 + random.next() * 40),
      tyreManagement: Math.round(35 + random.next() * 40),
      mechanicalGrip: scoreAround(random, config.referenceCarScore),
      compound,
      weatherAdaptation: Math.round(25 + random.next() * 60),
      starts: Math.round(35 + random.next() * 40),
      racecraft: driverScore,
      overtakingSkill: Math.round(35 + random.next() * 40),
      defendingSkill: Math.round(35 + random.next() * 40),
    };
  });
}
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export default function RaceWorkbench() {
  const [tier, setTier] = useState<TierId>(1);
  const [laps, setLaps] = useState(8);
  const [circuits, setCircuits] = useState<TestCircuit[]>([]);
  const [circuitId, setCircuitId] = useState("C01");
  const [loadingCircuits, setLoadingCircuits] = useState(true);
  const [seedLoadError, setSeedLoadError] = useState("");
  const [seed, setSeed] = useState("paddock-test-001");
  const [condition, setCondition] = useState<TrackCondition>("dry");
  const [compound, setCompound] = useState<TyreCompound>("medium");
  const [pitLossOverride, setPitLossOverride] = useState("");
  const [temperature, setTemperature] = useState(25);
  const [result, setResult] = useState<RaceWeekendResult | null>(null);
  const [error, setError] = useState("");
  const [selectedLap, setSelectedLap] = useState(8);
  const [runCount, setRunCount] = useState(0);
  const [hasSprint, setHasSprint] = useState(false);
  const sprintEligible = TIER_CONFIG[tier].sprintRacesPerSeason > 0;
  const availableCompounds = useMemo(() => availableTyreCompounds(tier, condition), [tier, condition]);

  useEffect(() => {
    let cancelled = false;
    async function loadCircuits() {
      try {
        const response = await fetch("/seed/circuits.json");
        if (!response.ok) throw new Error("Seed sirkuit tidak bisa dimuat (HTTP " + response.status + ").");
        const payload: unknown = await response.json();
        validateCircuitSeed(payload);
        const loaded = payload.rows.map((row) => ({
          id: String(row[0]), name: String(row[1]), country: String(row[2]),
          lengthKm: Number(row[4]), standardLaps: Number(row[5]),
          estimatedLapSeconds: Number(row[6]), abrasion: Number(row[20]),
        }));
        if (!cancelled) { setCircuits(loaded); setSeedLoadError(""); }
      } catch (caught) {
        if (!cancelled) setSeedLoadError(caught instanceof Error ? caught.message : "Seed sirkuit gagal dimuat.");
      } finally {
        if (!cancelled) setLoadingCircuits(false);
      }
    }
    void loadCircuits();
    return () => { cancelled = true; };
  }, []);

  const selectedCircuit = circuits.find((circuit) => circuit.id === circuitId) ?? circuits[0];
  useEffect(() => {
    if (!selectedCircuit) return;
    setCircuitId(selectedCircuit.id);
    setLaps(calculateRaceLapCount(selectedCircuit.lengthKm, tier));
    setResult(null);
  }, [selectedCircuit?.id, tier]);

  const drivers = useMemo(() => makeTestDrivers(tier, seed, compound), [tier, seed, compound]);
  useEffect(() => {
    if (availableCompounds.length > 0 && !availableCompounds.includes(compound)) {
      setCompound(availableCompounds[0]!);
      setResult(null);
    }
  }, [availableCompounds, compound]);
  useEffect(() => {
    if (!sprintEligible) setHasSprint(false);
  }, [sprintEligible]);
  const visibleLap = result ? Math.min(selectedLap, result.race.totalLaps) : 0;
  const lapRows = result?.race.laps[visibleLap - 1] ?? [];

  function runSimulation() {
    try {
      setError("");
      if (!selectedCircuit) throw new Error("Seed sirkuit belum tersedia.");
      let raceDrivers = drivers;
      if (tier <= 3 && condition === "dry") {
        const pitLossSeconds = Number(pitLossOverride);
        if (!pitLossOverride.trim() || !Number.isFinite(pitLossSeconds) || pitLossSeconds <= 0) {
          throw new Error("Untuk menguji aturan dua compound kering Tier 1–3, isi Pit loss override QA dengan nilai positif yang sedang kamu uji. Nilai ini tidak disimpan sebagai aturan default game.");
        }
        raceDrivers = drivers.map((driver) => {
          const strategy = planMandatoryDryTwoCompoundStrategy({
            tier,
            totalLaps: laps,
            trackAbrasion: selectedCircuit.abrasion,
            trackTemperatureCelsius: temperature,
            driverAggression: driver.aggression,
            mechanicalGrip: driver.mechanicalGrip,
            driverTyreManagement: driver.tyreManagement,
            pitLossSeconds,
          });
          return {
            ...driver,
            compound: strategy.firstCompound,
            compoundByLap: strategy.compoundByLap,
            pitStopByLap: strategy.pitStopByLap,
            pitLossSecondsByLap: strategy.pitLossSecondsByLap,
          };
        });
      }
      const nextResult = simulateRaceWeekend({
        worldSeed: seed,
        season: 1,
        round: 1,
        tier,
        estimatedCircuitLapSeconds: selectedCircuit?.estimatedLapSeconds ?? 0,
        totalLaps: laps,
        trackAbrasion: selectedCircuit?.abrasion ?? 0,
        trackTemperatureCelsius: temperature,
        trackCondition: condition,
        referenceSetupScore: 50,
        hasSprint: sprintEligible && hasSprint,
        drivers: raceDrivers,
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
        <p>Jalankan simulasi deterministik dari race engine yang sudah ada menggunakan data sirkuit sumber proyek. Data driver di halaman ini adalah fixture QA, bukan roster karier.</p>
      </section>

      <section className="workbench-panel" aria-labelledby="config-title">
        <div className="panel-heading"><div><span className="section-index">01 / CONFIGURATION</span><h2 id="config-title">Race parameters</h2></div><span className="qa-label">TEST INPUTS</span></div>
        <div className="field-grid">
          <label>Tier
            <select value={tier} onChange={(event) => { setTier(Number(event.target.value) as TierId); setResult(null); }}>
              {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>Tier {value} · {TIER_CONFIG[value as TierId].name}</option>)}
            </select>
          </label>
          <label>Circuit · source seed
            <select value={selectedCircuit?.id ?? circuitId} onChange={(event) => { setCircuitId(event.target.value); setResult(null); }} disabled={loadingCircuits || circuits.length === 0}>
              {circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuit.name} · {circuit.country}</option>)}
            </select>
          </label>
          <label>Track condition
            <select value={condition} onChange={(event) => { setCondition(event.target.value as TrackCondition); setResult(null); }}>
              {CONDITIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Tyre compound
            <select value={compound} onChange={(event) => { setCompound(event.target.value as TyreCompound); setResult(null); }}>
              {availableCompounds.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Race laps (min. 8)
            <input type="number" min="8" max="100" step="1" value={laps} onChange={(event) => { setLaps(Number(event.target.value)); setResult(null); }} />
          </label>
          <label className="checkbox-field">Sprint session · QA override
            <input type="checkbox" checked={sprintEligible && hasSprint} disabled={!sprintEligible} onChange={(event) => { setHasSprint(event.target.checked); setResult(null); }} />
            <small>Only Tier 1–2 support sprint sessions. Calendar frequency is not simulated in this workbench.</small>
          </label>
          {tier <= 3 && condition === "dry" && <label>Pit loss override QA (seconds)
            <input type="number" min="0.1" max="180" step="0.1" value={pitLossOverride} placeholder="Required for two-compound test" onChange={(event) => { setPitLossOverride(event.target.value); setResult(null); }} />
            <small>Explicit test input only. This is not a production default or a sourced tier value.</small>
          </label>}
          <div className="read-only-field"><span>Estimated lap time</span><strong>{selectedCircuit ? selectedCircuit.estimatedLapSeconds.toFixed(1) + " s" : "Loading…"}</strong></div>
          <div className="read-only-field"><span>Track abrasion</span><strong>{selectedCircuit ? selectedCircuit.abrasion + " / 100" : "Loading…"}</strong></div>
          <label>Track temperature (°C)
            <input type="number" min="-20" max="80" step="1" value={temperature} onChange={(event) => { setTemperature(Number(event.target.value)); setResult(null); }} />
          </label>
          <label>Deterministic seed
            <input value={seed} maxLength={80} onChange={(event) => { setSeed(event.target.value); setResult(null); }} />
          </label>
        </div>
        <div className="workbench-actions">
          <button type="button" onClick={runSimulation} disabled={loadingCircuits || !selectedCircuit || !seed.trim() || !Number.isInteger(laps) || laps < 8 || laps > 100 || !Number.isFinite(temperature)}>Run simulation</button>
          <span>{loadingCircuits ? "Loading circuit seed…" : "Grid: " + TIER_CONFIG[tier].gridSize + " test drivers · season 1 / round 1 · Tier 5 pit is emergency-only; Tier 6 has no pit stops"}</span>
        </div>
        {seedLoadError && <p className="error-message" role="alert">{seedLoadError}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {selectedCircuit && <p className="determinism-note">Source circuit: {selectedCircuit.name} · {selectedCircuit.lengthKm.toFixed(2)} km · {selectedCircuit.standardLaps} reference laps. Race distance is recalculated from circuit length and tier; the lap count remains editable for QA. For dry Tier 1–3, the workbench runs the mandatory two-compound planner using the explicit QA pit-loss override.</p>}
      </section>

      {result ? <section className="workbench-panel results-panel" aria-labelledby="results-title">
        <div className="panel-heading"><div><span className="section-index">02 / CLASSIFICATION</span><h2 id="results-title">Race result</h2></div><span className="qa-label">RUN #{runCount}</span></div>
        <div className="result-summary">
          <div><span>Winner</span><strong>{result.race.classification[0]?.driverName ?? "—"}</strong></div>
          <div><span>Circuit</span><strong>{selectedCircuit?.name ?? "—"}</strong></div>
          <div><span>Distance</span><strong>{result.race.totalLaps} laps</strong></div>
          <div><span>Finish time</span><strong>{formatTime(result.race.classification[0]?.cumulativeTimeSeconds ?? 0)}</strong></div>
          <div><span>Seed</span><strong>{seed}</strong></div>
        </div>
        <div className="weekend-session-grid">
          <section className="session-card">
            <div className="panel-heading"><div><span className="section-index">QUALIFYING</span><h3>Starting grid</h3></div></div>
            <div className="table-scroll"><table className="classification-table"><thead><tr><th>Grid</th><th>Driver</th><th>Best lap</th></tr></thead>
              <tbody>{[...result.qualifying.classification].sort((a, b) => a.gridPosition - b.gridPosition).map((row) => <tr key={row.driverId}><td>{row.gridPosition}</td><td>{row.driverName}</td><td>{formatTime(row.bestLapSeconds)}</td></tr>)}</tbody></table></div>
          </section>
          {result.sprint && <section className="session-card">
            <div className="panel-heading"><div><span className="section-index">SPRINT · {result.sprintLaps} LAPS</span><h3>Sprint classification</h3></div></div>
            <div className="table-scroll"><table className="classification-table"><thead><tr><th>Pos</th><th>Driver</th><th>Time</th></tr></thead>
              <tbody>{[...result.sprint.classification].sort((a, b) => a.position - b.position).map((row) => <tr key={row.driverId}><td>{row.position}</td><td>{row.driverName}</td><td>{formatTime(row.cumulativeTimeSeconds)}</td></tr>)}</tbody></table></div>
          </section>}
        </div>
        <div className="lap-selector">
          <label htmlFor="lap-select">Inspect lap</label>
          <input id="lap-select" type="range" min="1" max={result.race.totalLaps} value={visibleLap} onChange={(event) => setSelectedLap(Number(event.target.value))} />
          <strong>Lap {visibleLap} / {result.race.totalLaps}</strong>
        </div>
        <div className="table-scroll"><table className="classification-table">
          <thead><tr><th>Pos</th><th>Driver</th><th>Lap time</th><th>Gap</th><th>Tyre wear</th><th>Pit</th><th>Condition</th></tr></thead>
          <tbody>{lapRows.map((row) => <tr key={row.driverId}><td>{row.position.toString().padStart(2, "0")}</td><td>{row.driverName}</td><td>{formatTime(row.lapTimeSeconds)}</td><td>{row.position === 1 ? "LEADER" : `+${row.gapToLeaderSeconds.toFixed(3)}s`}</td><td>{row.tyreWearPercent.toFixed(1)}%</td><td>{row.pitStop ? `PIT +${row.pitLossSeconds.toFixed(2)}s` : "—"}</td><td>{row.trackCondition}</td></tr>)}</tbody>
        </table></div>
        <p className="determinism-note">Ulangi weekend dengan seed dan input yang sama. Qualifying, optional sprint, grid, dan main race harus identik. Ubah seed untuk menguji variasi hasil yang tetap deterministik.</p>
      </section> : <section className="empty-state"><span className="section-index">02 / RESULTS</span><h2>Waiting for simulation</h2><p>Belum ada hasil. Jalankan simulasi untuk memeriksa classification, lap time, gap, dan tyre wear.</p></section>}

      <footer className="workbench-footer"><span>PADDOCK LIFE / INTERNAL TEST BUILD</span><span>Career Mode belum terhubung ke halaman ini.</span></footer>
    </main>
  );
}
