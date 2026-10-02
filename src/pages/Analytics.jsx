import { useEffect, useMemo, useState } from "react";
import { getStudioAnalytics, getStudioEngagement, syncStudioEngagement, getStudioEngagementHistory, getStudioPostPerformance, syncStudioPostPerformance } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function total(rows,key){ return (rows||[]).reduce((n,x)=>n+Number(x[key]||0),0); }

export default function Analytics(){
  const [data,setData]=useState(null);
  const [engagement,setEngagement]=useState([]);
  const [syncing,setSyncing]=useState(false);
  const [history,setHistory]=useState(null);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [posts,setPosts]=useState([]);
  const [syncingPosts,setSyncingPosts]=useState(false);
  const [loading,setLoading]=useState(true);
  const toast=useToast();

  async function load(){
    setLoading(true);
    try{const result=await getStudioAnalytics();setData(result); const e=await getStudioEngagement();setEngagement(e.accounts||[]); const p=await getStudioPostPerformance(100); setPosts(p.posts||[]);}
    catch(error){toast.error(error.message||"Could not load analytics.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{load();},[]);

  async function syncEngagement(){
    setSyncing(true);
    try{const result=await syncStudioEngagement(50); const e=await getStudioEngagement(); setEngagement(e.accounts||[]); const ok=(result.results||[]).filter(x=>x.ok).length; toast.success("Engagement sync complete: "+ok+" account(s) updated.");}
    catch(error){toast.error(error.message||"Could not sync engagement metrics.");}
    finally{setSyncing(false);}
  }

  async function syncPosts(){
    setSyncingPosts(true);
    try{const result=await syncStudioPostPerformance(25); const p=await getStudioPostPerformance(100); setPosts(p.posts||[]); const ok=(result.results||[]).filter(x=>x.ok).length; toast.success("Post metrics synced: "+ok+" post(s) updated.");}
    catch(error){toast.error(error.message||"Could not sync post metrics.");}
    finally{setSyncingPosts(false);}
  }

  async function showHistory(account) {
    setHistoryLoading(true);
    try { const result = await getStudioEngagementHistory(account.account_id, 30); setHistory({ ...result, accountId: account.account_id }); }
    catch(error){ toast.error(error.message || "Could not load account history."); }
    finally{ setHistoryLoading(false); }
  }

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
      <div className="flex gap-2"><button className="btn-ghost text-xs" onClick={load}>Refresh</button><button className="btn-primary text-xs" disabled={syncing} onClick={syncEngagement}>{syncing?"Syncing…":"Sync engagement"}</button></div>
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
        <div className="flex items-center justify-between mb-5"><div><p className="label">Platform engagement snapshots</p><p className="text-xs text-muted mt-1">Follower/account metrics from connected platform APIs. Missing scopes show as reconnect-required.</p></div></div>
        {engagement.length===0 ? <p className="text-sm text-muted">No connected account metrics yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-4">Account</th><th className="py-2 pr-4">Platform</th><th className="py-2 pr-4">Followers</th><th className="py-2 pr-4">7d views</th><th className="py-2 pr-4">7d likes</th><th className="py-2 pr-4">Status</th><th className="py-2"></th></tr></thead><tbody>{engagement.map(row=>{const m=row.metrics_json||{};return <tr key={row.account_id} className="border-b border-border/60"><td className="py-3 pr-4 font-medium">{row.name}</td><td className="py-3 pr-4 font-mono">{row.platform}</td><td className="py-3 pr-4 font-mono">{m.followers==null?"—":m.followers.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.views7d==null?"—":m.views7d.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.likes7d==null?"—":m.likes7d.toLocaleString()}</td><td className="py-3">{row.error_message?<span className="text-rose" title={row.error_message}>Needs reconnect / scope</span>:<span className="text-teal">Synced {row.fetched_at?new Date(row.fetched_at).toLocaleString():""}</span>}</td><td className="py-3 text-right"><button className="btn-ghost text-[10px]" disabled={historyLoading} onClick={()=>showHistory(row)}>History</button></td></tr>})}</tbody></table></div>}
      </section>

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
        <div className="flex items-center justify-between mb-5"><div><p className="label">Post performance</p><p className="text-xs text-muted mt-1">Latest metrics for published posts where the platform exposes a queryable post ID.</p></div><button className="btn-ghost text-xs" disabled={syncingPosts} onClick={syncPosts}>{syncingPosts?"Syncing…":"Sync post metrics"}</button></div>
        {posts.length===0?<p className="text-sm text-muted">No post-level metrics yet.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-4">Post</th><th className="py-2 pr-4">Platform</th><th className="py-2 pr-4">Views</th><th className="py-2 pr-4">Likes</th><th className="py-2 pr-4">Comments</th><th className="py-2 pr-4">Shares</th><th className="py-2">Status</th></tr></thead><tbody>{posts.map(row=>{const m=row.metrics_json||{};return <tr key={row.job_id} className="border-b border-border/60"><td className="py-3 pr-4"><p className="font-medium max-w-xs truncate" title={row.title||""}>{row.title||"Untitled"}</p><p className="text-[9px] text-muted mt-1">{row.profile_name}</p></td><td className="py-3 pr-4 font-mono">{row.platform}</td><td className="py-3 pr-4 font-mono">{m.views==null?"—":m.views.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.likes==null?"—":m.likes.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.comments==null?"—":m.comments.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.shares==null?"—":m.shares.toLocaleString()}</td><td className="py-3">{row.error_message?<span className="text-rose" title={row.error_message}>Needs sync/reconnect</span>:row.fetched_at?<span className="text-teal">Synced</span>:<span className="text-muted">Not synced</span>}</td></tr>})}</tbody></table></div>}
      </section>

      <section className="card p-5 mt-6">
        <p className="label">Profiles</p>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">{(data?.profiles||[]).map(row=><div key={row.id} className="rounded-xl border border-border p-4"><p className="font-medium text-sm">{row.name}</p><p className="text-[10px] text-muted mt-2">{row.content_count} content item(s)</p><p className="text-[10px] text-teal mt-1">{row.published_count} published</p></div>)}</div>
      </section>

      {history && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onMouseDown={e=>e.target===e.currentTarget&&setHistory(null)}>
        <section className="card w-full max-w-3xl p-6">
          <div className="flex items-center justify-between mb-5"><div><p className="label">30-day account history</p><h2 className="font-display text-xl font-semibold mt-1">{history.account?.name || "Account"}</h2><p className="text-xs text-muted mt-1">{history.account?.platform || ""}</p></div><button className="btn-ghost text-xs" onClick={()=>setHistory(null)}>Close</button></div>
          {(history.history||[]).length===0?<p className="text-sm text-muted">No snapshots yet. Run Sync engagement first.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Followers</th><th className="py-2 pr-4">Views</th><th className="py-2 pr-4">Likes</th><th className="py-2">Status</th></tr></thead><tbody>{history.history.map(row=>{const m=row.metrics_json||{};return <tr key={String(row.metric_date)} className="border-b border-border/60"><td className="py-3 pr-4 font-mono">{String(row.metric_date)}</td><td className="py-3 pr-4 font-mono">{m.followers==null?"—":m.followers.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.views7d==null?"—":m.views7d.toLocaleString()}</td><td className="py-3 pr-4 font-mono">{m.likes7d==null?"—":m.likes7d.toLocaleString()}</td><td className="py-3">{row.error_message?<span className="text-rose">{row.error_message}</span>:<span className="text-teal">OK</span>}</td></tr>})}</tbody></table></div>}
        </section>
      </div>}
    </>}
  </div>;
}
