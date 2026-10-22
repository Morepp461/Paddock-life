import { useEffect, useState } from "react";
type WorkerStatus = "checking" | "ready" | "failed";
export default function App() {
  const [status, setStatus] = useState<WorkerStatus>("checking");
  useEffect(() => {
    const worker = new Worker(new URL("../core/simulation.worker.ts", import.meta.url), { type: "module" });
    const requestId = "phase-0.5-ping";
    const timeout = window.setTimeout(() => setStatus("failed"), 3000);
    worker.addEventListener("message", (event: MessageEvent<{ type: string; requestId: string }>) => {
      if (event.data?.type !== "PONG" || event.data.requestId !== requestId) return;
      window.clearTimeout(timeout); setStatus("ready"); worker.terminate();
    });
    worker.addEventListener("error", () => { window.clearTimeout(timeout); setStatus("failed"); worker.terminate(); });
    worker.postMessage({ type: "PING", requestId });
    return () => { window.clearTimeout(timeout); worker.terminate(); };
  }, []);
  return <main className="shell"><header><span>PADDOCK LIFE / MOTORSPORT MANAGEMENT</span><span className="accent">FOUNDATION 0.5</span></header><section className="hero"><div className="monogram">PL</div><p className="eyebrow">YOUR TEAM. YOUR LEGACY.</p><h1>PADDOCK <b>LIFE</b></h1><p className="intro">Fondasi game sedang disiapkan. Belum ada progres permainan yang disimpan pada tahap ini.</p><div className="status" role="status" aria-live="polite"><i className={status}/><div><strong>Simulation worker</strong><p>{status === "checking" ? "Memeriksa komunikasi worker…" : status === "ready" ? "Worker aktif dan merespons." : "Worker belum merespons; perlu pemeriksaan runtime."}</p></div></div><div className="milestones"><article><small>01 / NEXT</small><strong>Core simulation</strong></article><article><small>02 / PLANNED</small><strong>Local save</strong></article><article><small>03 / PLANNED</small><strong>Career mode</strong></article></div></section><footer><span>PADDOCK LIFE</span><span>BUILT FOR THE LONG RUN</span></footer></main>;
}
