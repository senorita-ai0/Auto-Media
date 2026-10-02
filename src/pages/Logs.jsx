import { useEffect, useState } from "react";
import { listStudioAuditLogs } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setLogs((await listStudioAuditLogs(300)).logs || []); }
    catch (error) { toast.error(error.message || "Could not load audit logs."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return <div className="max-w-7xl">
    <header className="mb-8"><p className="label">Operations · logs</p><h1 className="font-display text-3xl font-semibold tracking-tight">Audit log</h1><p className="text-muted text-sm mt-1">Configuration and workflow actions recorded by the Studio backend.</p></header>
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4"><p className="label">Recent activity</p><button className="btn-ghost text-xs" onClick={load}>Refresh</button></div>
      {loading ? <p className="text-sm text-muted">Loading…</p> : logs.length === 0 ? <p className="text-sm text-muted">No audit entries yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">Action</th><th className="py-2 pr-3">Entity</th><th className="py-2">Details</th></tr></thead><tbody>{logs.map(x=><tr key={x.id} className="border-b border-border/60 align-top"><td className="py-3 pr-3 whitespace-nowrap">{x.created_at ? new Date(x.created_at).toLocaleString() : "—"}</td><td className="py-3 pr-3 font-mono">{x.action}</td><td className="py-3 pr-3">{x.entity_type || "—"}{x.entity_id ? <div className="text-[9px] text-muted font-mono mt-1">{x.entity_id}</div> : null}</td><td className="py-3 text-muted max-w-xl"><pre className="whitespace-pre-wrap">{JSON.stringify(x.after_json || {}, null, 2)}</pre></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}
