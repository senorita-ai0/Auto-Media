import { useEffect, useState } from "react";
import { getStudioMetrics } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

export default function StudioOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setData(await getStudioMetrics()); }
    catch (error) { toast.error(error.message || "Could not load Studio metrics."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, []);

  const total = list => (list || []).reduce((sum, x) => sum + Number(x.count || 0), 0);
  return <div className="max-w-7xl">
    <header className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div><p className="label">Content Studio · overview</p><h1 className="font-display text-3xl font-semibold tracking-tight">{data?.workspace?.name || "Studio"}</h1><p className="text-muted text-sm mt-1">Workspace health and pipeline activity in one place.</p></div>
      <button className="btn-ghost text-xs" onClick={load}>Refresh</button>
    </header>
    {loading && !data ? <div className="card p-8 text-sm text-muted">Loading overview…</div> : data && <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ["Profiles", data.profiles?.count || 0, (data.profiles?.enabled || 0) + " active"],
          ["Automations", data.automations?.count || 0, (data.automations?.enabled || 0) + " active"],
          ["Content items", total(data.content), (data.content || []).find(x=>x.status==="needs_review")?.count || 0 + " need review"],
          ["Publishing jobs", total(data.publishingJobs), (data.publishingJobs || []).find(x=>x.status==="scheduled")?.count || 0 + " scheduled"]
        ].map(([label,value,sub])=><div key={label} className="card p-5"><p className="label">{label}</p><p className="font-display text-3xl font-semibold mt-2">{value}</p><p className="text-[10px] font-mono text-muted mt-2">{sub}</p></div>)}
      </div>
      <div className="grid lg:grid-cols-2 gap-5 mt-6">
        <section className="card p-5"><p className="label mb-4">Content status</p><div className="grid gap-2">{(data.content || []).map(x=><div key={x.status} className="flex justify-between text-xs border-b border-border/70 pb-2"><span>{x.status}</span><span className="font-mono">{x.count}</span></div>)}</div></section>
        <section className="card p-5"><p className="label mb-4">Publishing status</p><div className="grid gap-2">{(data.publishingJobs || []).map(x=><div key={x.status} className="flex justify-between text-xs border-b border-border/70 pb-2"><span>{x.status}</span><span className="font-mono">{x.count}</span></div>)}</div></section>
      </div>
      <section className="card p-5 mt-5"><div className="flex items-center justify-between mb-4"><p className="label">n8n activity</p><span className="text-[10px] font-mono text-muted">{data.serverTime ? new Date(data.serverTime).toLocaleString() : "—"}</span></div><div className="grid gap-2">{(data.n8nExecutions || []).length ? data.n8nExecutions.map(x=><div key={x.status} className="flex justify-between text-xs border-b border-border/70 pb-2"><span>{x.status}</span><span className="font-mono">{x.count}</span></div>) : <p className="text-sm text-muted">No n8n executions yet.</p>}</div></section>
    </>}
  </div>;
}
