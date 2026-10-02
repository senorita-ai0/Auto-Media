import { useEffect, useMemo, useState } from "react";
import { getStudioAnalytics } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function total(rows,key){ return (rows||[]).reduce((n,x)=>n+Number(x[key]||0),0); }

export default function Analytics(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const toast=useToast();

  async function load(){
    setLoading(true);
    try{setData(await getStudioAnalytics());}
    catch(error){toast.error(error.message||"Could not load analytics.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{load();},[]);

  const dailyMap=useMemo(()=>{
    const map={};
    for(const row of data?.daily||[]){
      const key=String(row.day);
      (map[key] ||= []).push(row);
    }
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).slice(-14);
  },[data]);

  const maxDay=Math.max(1,...dailyMap.map(([,rows])=>rows.reduce((n,r)=>n+Number(r.published||0),0)));

  return <div className="max-w-7xl">
    <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div><p className="label">Operations · analytics</p><h1 className="font-display text-3xl font-semibold tracking-tight">Publishing analytics</h1><p className="text-muted text-sm mt-1">{data?.workspace?.name||"Workspace"} · counts from Auto-Media publishing history.</p></div>
      <button className="btn-ghost text-xs" onClick={load}>Refresh</button>
    </header>
    {loading && !data ? <div className="card p-8 text-sm text-muted">Loading analytics…</div> : <>
      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        {[
          ["Total jobs",total(data?.platforms,"total")],
          ["Published",total(data?.platforms,"published")],
          ["Pending",total(data?.platforms,"pending")],
          ["Failed",total(data?.platforms,"failed")]
        ].map(([label,value])=><div className="card p-5" key={label}><p className="label">{label}</p><p className="text-3xl font-display font-semibold mt-1">{value}</p></div>)}
      </div>

      <section className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-5"><div><p className="label">By platform</p><p className="text-xs text-muted mt-1">Operational publishing results; this is not platform engagement data.</p></div></div>
        {(data?.platforms||[]).length===0 ? <p className="text-sm text-muted">No publishing jobs yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-4">Platform</th><th className="py-2 pr-4">Total</th><th className="py-2 pr-4">Published</th><th className="py-2 pr-4">Pending</th><th className="py-2">Failed</th></tr></thead><tbody>{data.platforms.map(row=><tr key={row.platform} className="border-b border-border/60"><td className="py-3 pr-4 font-medium">{row.platform}</td><td className="py-3 pr-4 font-mono">{row.total}</td><td className="py-3 pr-4 font-mono text-teal">{row.published}</td><td className="py-3 pr-4 font-mono">{row.pending}</td><td className="py-3 font-mono text-rose">{row.failed}</td></tr>)}</tbody></table></div>}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card p-5">
          <p className="label">Published · last 14 days</p>
          <div className="mt-5 space-y-3">{dailyMap.length===0?<p className="text-sm text-muted">No activity yet.</p>:dailyMap.map(([day,rows])=>{const count=rows.reduce((n,r)=>n+Number(r.published||0),0);return <div key={day} className="flex items-center gap-3"><span className="text-[10px] font-mono text-muted w-24">{day}</span><div className="flex-1 h-2 rounded-full bg-black/15 overflow-hidden"><div className="h-full rounded-full bg-teal/70" style={{width:Math.max(2,Math.round(count/maxDay*100))+"%"}}/></div><span className="text-[10px] font-mono w-8 text-right">{count}</span></div>})}</div>
        </section>

        <section className="card p-5">
          <p className="label">Content types</p>
          <div className="mt-4 space-y-3">{(data?.contentTypes||[]).map(row=><div key={row.name} className="rounded-xl border border-border p-3"><div className="flex justify-between gap-3"><span className="text-sm font-medium">{row.name}</span><span className="text-[10px] font-mono text-muted">{row.total} total</span></div><div className="text-[10px] text-muted mt-2">Published {row.published} · active {row.active} · failed {row.failed}</div></div>)}</div>
        </section>
      </div>

      <section className="card p-5 mt-6">
        <p className="label">Profiles</p>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">{(data?.profiles||[]).map(row=><div key={row.id} className="rounded-xl border border-border p-4"><p className="font-medium text-sm">{row.name}</p><p className="text-[10px] text-muted mt-2">{row.content_count} content item(s)</p><p className="text-[10px] text-teal mt-1">{row.published_count} published</p></div>)}</div>
      </section>
    </>}
  </div>;
}
