import { useEffect, useMemo, useState } from "react";
import { listStudioPostEngagement, syncStudioPostEngagement, backfillStudioPostEngagement, getStudioPostEngagementHistory } from "../lib/studioApi";
import { listLatestStudioEngagement } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function val(metrics, key) {
  const n = metrics?.[key];
  return n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString();
}

export default function Engagement() {
  const [accounts, setAccounts] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillDays, setBackfillDays] = useState("30");
  const [history, setHistory] = useState({});
  const [historyBusy, setHistoryBusy] = useState(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [accountResult, postResult] = await Promise.all([listLatestStudioEngagement(), listStudioPostEngagement()]);
      setAccounts(accountResult.accounts || []);
      setPosts(postResult.posts || []);
    } catch (error) {
      toast.error(error.message || "Could not load engagement analytics.");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function toggleHistory(row) {
    if (history[row.publishing_job_id]) {
      setHistory(current => ({ ...current, [row.publishing_job_id]: null }));
      return;
    }
    setHistoryBusy(row.publishing_job_id);
    try {
      const result = await getStudioPostEngagementHistory(row.publishing_job_id, 90);
      setHistory(current => ({ ...current, [row.publishing_job_id]: result.history || [] }));
    } catch (error) { toast.error(error.message || "Could not load post history."); }
    finally { setHistoryBusy(null); }
  }

  async function backfill() {
    setBackfilling(true);
    try {
      const result = await backfillStudioPostEngagement(Number(backfillDays), 100);
      const rows = Number(result.rows || 0);
      toast.success("Backfilled " + rows + " historical metric row(s).");
      await load();
    } catch (error) { toast.error(error.message || "Historical analytics backfill failed."); }
    finally { setBackfilling(false); }
  }

  async function sync() {
    setSyncing(true);
    try {
      const result = await syncStudioPostEngagement(200);
      const good = (result.results || []).filter(x => x.ok).length;
      toast.success("Synced " + good + "/" + (result.results || []).length + " published post(s).");
      await load();
    } catch (error) { toast.error(error.message || "Engagement sync failed."); }
    finally { setSyncing(false); }
  }

  const topPosts = useMemo(() => [...posts].filter(x => x.metrics_json && Object.keys(x.metrics_json).length).sort((a,b) => {
    const am = a.metrics_json || {}, bm = b.metrics_json || {};
    const score = m => Number(m.engagement ?? m.views ?? m.impressions ?? m.likes ?? 0);
    return score(bm) - score(am);
  }).slice(0, 20), [posts]);

  return <div className="max-w-7xl">
    <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div><p className="label">Analytics · external engagement</p><h1 className="font-display text-3xl font-semibold tracking-tight">Post performance</h1><p className="text-muted text-sm mt-1">Performance pulled back from connected platforms and attached to the exact publishing job that created each post.</p></div>
      <div className="flex flex-wrap gap-2"><button className="btn-ghost text-xs" disabled={backfilling} onClick={backfill}>{backfilling ? "Backfilling…" : "Backfill history"}</button><select className="input text-xs w-24" value={backfillDays} onChange={e=>setBackfillDays(e.target.value)}><option value="7">7d</option><option value="30">30d</option><option value="90">90d</option><option value="365">365d</option></select><button className="btn-primary text-xs" disabled={syncing} onClick={sync}>{syncing ? "Syncing…" : "Sync published posts"}</button></div>
    </header>

    {loading ? <div className="card p-8 text-sm text-muted">Loading analytics…</div> : <>
      <section className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {accounts.map(account => <article key={account.account_id} className="card p-5">
          <div className="flex items-center justify-between"><div><p className="label">{account.platform}</p><p className="font-medium mt-1">{account.name}</p></div><span className={"text-[10px] font-mono rounded-full border px-2 py-1 " + (account.status === "connected" ? "text-teal border-teal/30" : "text-rose border-rose/30")}>{account.status}</span></div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div><p className="label">Followers</p><p className="font-display text-xl mt-1">{val(account.metrics_json,"followers")}</p></div>
            <div><p className="label">Views 7d</p><p className="font-display text-xl mt-1">{val(account.metrics_json,"views7d")}</p></div>
            <div><p className="label">Engagement 7d</p><p className="font-display text-xl mt-1">{val(account.metrics_json,"engagement7d")}</p></div>
          </div>
          {account.error_message && <p className="text-[10px] text-rose mt-4">{account.error_message}</p>}
        </article>)}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4"><div><p className="label">Published post metrics</p><p className="text-xs text-muted mt-1">{posts.length} publishing record(s) · daily snapshots</p></div></div>
        {topPosts.length === 0 ? <p className="text-sm text-muted">No per-post metrics are available yet. Publish a supported post, then sync analytics.</p> :
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-3">Platform</th><th className="py-2 pr-3">Post</th><th className="py-2 pr-3">Views / impressions</th><th className="py-2 pr-3">Reach</th><th className="py-2 pr-3">Likes</th><th className="py-2 pr-3">Comments</th><th className="py-2 pr-3">Shares</th><th className="py-2 pr-3">Saves / clicks</th><th className="py-2">Snapshot</th></tr></thead>
            <tbody>{topPosts.map(row=>{const m=row.metrics_json||{};return <tr key={row.publishing_job_id} className="border-b border-border/60 align-top"><td className="py-3 pr-3 font-mono">{row.platform}</td><td className="py-3 pr-3 max-w-sm">{row.external_url?<a href={row.external_url} target="_blank" rel="noreferrer" className="font-medium truncate block hover:underline">{row.title||"Untitled"} ↗</a>:<div className="font-medium truncate">{row.title||"Untitled"}</div>}<div className="text-[9px] font-mono text-muted mt-1">{row.external_post_id}</div><button className="text-[10px] text-violet mt-2 hover:underline" onClick={()=>toggleHistory(row)} disabled={historyBusy===row.publishing_job_id}>{historyBusy===row.publishing_job_id ? "Loading history…" : history[row.publishing_job_id] ? "Hide history" : "View 90-day history"}</button>{history[row.publishing_job_id] && <div className="mt-2 rounded-lg border border-border/60 p-2 space-y-1 max-h-40 overflow-y-auto">{history[row.publishing_job_id].length===0 ? <div className="text-[9px] text-muted">No daily snapshots yet.</div> : history[row.publishing_job_id].map(h=><div key={h.metric_date} className="flex items-center justify-between gap-2 text-[9px] font-mono"><span>{h.metric_date}</span><span>views {val(h.metrics_json,"views")!=="—"?val(h.metrics_json,"views"):val(h.metrics_json,"impressions")} · likes {val(h.metrics_json,"likes")} · comments {val(h.metrics_json,"comments")} · shares {val(h.metrics_json,"shares")}</span></div>)}</div>}</td><td className="py-3 pr-3">{val(m,"views") !== "—" ? val(m,"views") : val(m,"impressions")}</td><td className="py-3 pr-3">{val(m,"reach")}</td><td className="py-3 pr-3">{val(m,"likes")}</td><td className="py-3 pr-3">{val(m,"comments")}</td><td className="py-3 pr-3">{val(m,"shares")}</td><td className="py-3 pr-3"><span>{val(m,"saves")}</span><span className="text-muted"> / {val(m,"clicks")}</span></td><td className="py-3 whitespace-nowrap">{row.metric_date || "—"}{m.estimatedMinutesWatched!=null&&<div className="text-[9px] text-muted mt-1">{Number(m.estimatedMinutesWatched).toLocaleString()} min watched</div>}{m.engagement!=null&&<div className="text-[9px] text-muted">{Number(m.engagement).toLocaleString()} engagement</div>}{row.error_message && <div className="text-[9px] text-rose mt-1 max-w-xs">{row.error_message}</div>}</td></tr>})}</tbody>
          </table></div>}
      </section>
    </>}
  </div>;
}
