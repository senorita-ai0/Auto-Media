import { useEffect, useState } from "react";
import { getStudioObservability } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function sum(rows) { return (rows || []).reduce((n, x) => n + Number(x.count || 0), 0); }

export default function Observability() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    try { setData(await getStudioObservability()); }
    catch (error) { toast.error(error.message || "Could not load observability."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const blocks = [
    ["Native runs", data?.automationRuns],
    ["Publishing jobs", data?.publishingJobs],
    ["n8n executions", data?.n8nExecutions]
  ];

  return <div className="max-w-7xl">
    <header className="mb-8"><p className="label">Operations · observability</p><h1 className="font-display text-3xl font-semibold tracking-tight">System health</h1><p className="text-muted text-sm mt-1">{data?.workspace?.name || "Workspace"} · live job and scheduler state.</p></header>
    {loading && !data ? <div className="card p-8 text-sm text-muted">Loading telemetry…</div> : <>
      <div className="grid md:grid-cols-3 gap-4 mb-6">{blocks.map(([label, rows]) => <div key={label} className="card p-5"><p className="label">{label}</p><p className="text-3xl font-display font-semibold mt-2">{sum(rows)}</p><div className="mt-4 flex flex-wrap gap-2">{(rows || []).map(x=><span key={x.status} className="text-[10px] font-mono rounded-full border border-border px-2 py-1">{x.status}: {x.count}</span>)}</div></div>)}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5"><p className="label">Native scheduler</p><div className="flex justify-between mt-3"><span className="text-sm">{data?.schedulers?.native?.running ? "RUNNING" : "STOPPED"}</span><span className="text-[10px] font-mono text-muted">active {data?.schedulers?.native?.activeJobs ?? 0}</span></div><p className="text-[10px] text-muted mt-3">Last tick: {data?.schedulers?.native?.lastTick ? new Date(data.schedulers.native.lastTick).toLocaleString() : "—"}</p></div>
        <div className="card p-5"><p className="label">Publishing worker</p><div className="flex justify-between mt-3"><span className="text-sm">{data?.schedulers?.publishing?.running ? "RUNNING" : "STOPPED"}</span><span className="text-[10px] font-mono text-muted">{data?.schedulers?.publishing?.processing ? "processing" : "idle"}</span></div><p className="text-[10px] text-muted mt-3">Last tick: {data?.schedulers?.publishing?.lastTick ? new Date(data.schedulers.publishing.lastTick).toLocaleString() : "—"}</p></div>
      </div>
    </>}
  </div>;
}
