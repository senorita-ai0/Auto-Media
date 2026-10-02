import { useEffect, useState } from "react";
import { getStudioObservability, getStudioMaintenanceStatus, runStudioMaintenance } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function sum(rows) { return (rows || []).reduce((n, x) => n + Number(x.count || 0), 0); }

export default function Observability() {
  const [data, setData] = useState(null);
  const [maintenance, setMaintenance] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    try { const [overview, cleanup] = await Promise.all([getStudioObservability(), getStudioMaintenanceStatus()]); setData(overview); setMaintenance(cleanup); }
    catch (error) { toast.error(error.message || "Could not load observability."); }
    finally { setLoading(false); }
  }
  async function cleanupNow() {
    setCleaning(true);
    try {
      const result = await runStudioMaintenance();
      setMaintenance(current => ({ ...(current || {}), lastResult: result, lastRunAt: result.startedAt }));
      toast.success("Cleanup completed.");
      await load();
    } catch (error) { toast.error(error.message || "Cleanup failed."); }
    finally { setCleaning(false); }
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const blocks = [
    ["Native runs", data?.automationRuns],
    ["Generation jobs", data?.generationJobs],
    ["Publishing jobs", data?.publishingJobs],
    ["n8n executions", data?.n8nExecutions]
  ];

  return <div className="max-w-7xl">
    <header className="mb-8"><p className="label">Operations · observability</p><h1 className="font-display text-3xl font-semibold tracking-tight">System health</h1><p className="text-muted text-sm mt-1">{data?.workspace?.name || "Workspace"} · live job and scheduler state.</p></header>
    {loading && !data ? <div className="card p-8 text-sm text-muted">Loading telemetry…</div> : <>
      <div className="grid md:grid-cols-3 gap-4 mb-6">{blocks.map(([label, rows]) => <div key={label} className="card p-5"><p className="label">{label}</p><p className="text-3xl font-display font-semibold mt-2">{sum(rows)}</p><div className="mt-4 flex flex-wrap gap-2">{(rows || []).map(x=><span key={x.status} className="text-[10px] font-mono rounded-full border border-border px-2 py-1">{x.status}: {x.count}</span>)}</div></div>)}</div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="card p-5"><p className="label">Native scheduler</p><div className="flex justify-between mt-3"><span className="text-sm">{data?.schedulers?.native?.running ? "RUNNING" : "STOPPED"}</span><span className="text-[10px] font-mono text-muted">active {data?.schedulers?.native?.activeJobs ?? 0}</span></div><p className="text-[10px] text-muted mt-3">Last tick: {data?.schedulers?.native?.lastTick ? new Date(data.schedulers.native.lastTick).toLocaleString() : "—"}</p></div>
        <div className="card p-5"><p className="label">Publishing worker</p><div className="flex justify-between mt-3"><span className="text-sm">{data?.schedulers?.publishing?.running ? "RUNNING" : "STOPPED"}</span><span className="text-[10px] font-mono text-muted">{data?.schedulers?.publishing?.processing ? "processing" : "idle"}</span></div><p className="text-[10px] text-muted mt-3">Last tick: {data?.schedulers?.publishing?.lastTick ? new Date(data.schedulers.publishing.lastTick).toLocaleString() : "—"}</p></div>
      <div className="card p-5"><p className="label">Generation worker</p><div className="flex justify-between mt-3"><span className="text-sm">{data?.schedulers?.generation?.running ? "RUNNING" : "STOPPED"}</span><span className="text-[10px] font-mono text-muted">{data?.schedulers?.generation?.processing ? "processing" : "idle"}</span></div><p className="text-[10px] text-muted mt-3">Last tick: {data?.schedulers?.generation?.lastTick ? new Date(data.schedulers.generation.lastTick).toLocaleString() : "—"}</p></div></div>
      <div className="card p-5 mt-4">
        <div className="flex items-center justify-between"><div><p className="label">DEPLOYMENT READINESS</p><p className="text-xs text-muted mt-1">Configuration and infrastructure checks for this container.</p></div><span className={"text-[10px] font-mono " + (data?.readiness?.ready ? "text-teal" : "text-rose")}>{data?.readiness?.ready ? "READY" : "NOT READY"}</span></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-4">{Object.entries(data?.readiness?.checks || {}).map(([name, ok]) => <div key={name} className="rounded-lg border border-border p-3 text-[10px] font-mono"><span className={ok ? "text-teal" : "text-rose"}>{ok ? "✓" : "✗"}</span> {name}</div>)}</div>
        <div className="mt-4 pt-4 border-t border-border"><p className="label">ALERTING</p><p className="text-sm mt-1">{data?.alerts?.configured ? "External failure webhook configured." : "No external failure webhook configured."}</p></div>
      </div>
    </>}
}
