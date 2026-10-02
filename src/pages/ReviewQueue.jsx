import { useEffect, useState } from "react";
import { listStudioContent, approveStudioContent, publishStudioContent } from "../lib/studioApi";
import { watchStudioState } from "../lib/studioRepository";
import { useToast } from "../context/ToastContext";

export default function ReviewQueue() {
  const [studio, setStudio] = useState({ profiles: [] });
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState("needs_review");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  async function load() {
    try {
      const result = await listStudioContent(profileId);
      setItems((result.content || []).filter(x => status === "all" ? true : x.status === status));
    } catch (error) { toast.error(error.message || "Could not load review queue."); }
  }
  useEffect(() => watchStudioState(setStudio), []);
  useEffect(() => { load(); }, [profileId, status]);

  async function act(item) {
    setBusy(item.id);
    try {
      if (item.status === "needs_review" || item.status === "generated") await approveStudioContent(item.id);
      else await publishStudioContent(item.id);
      await load();
      toast.success(item.status === "approved" ? "Content published." : "Content approved and queued.");
    } catch (error) { toast.error(error.message || "Review action failed."); }
    finally { setBusy(null); }
  }

  return <div className="max-w-7xl">
    <header className="mb-8"><p className="label">Content operations · review</p><h1 className="font-display text-3xl font-semibold tracking-tight">Review queue</h1><p className="text-muted text-sm mt-1">Review generated content before it reaches connected publishing destinations.</p></header>
    <div className="card p-4 mb-6 flex flex-wrap gap-3 items-center">
      <select className="input max-w-xs" value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">All profiles</option>{studio.profiles.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>
      <select className="input max-w-xs" value={status} onChange={e=>setStatus(e.target.value)}><option value="needs_review">Needs review</option><option value="generated">Generated</option><option value="approved">Approved</option><option value="published">Published</option><option value="all">All statuses</option></select>
      <button className="btn-ghost text-xs" onClick={()=>load()}>Refresh</button>
      <span className="text-[10px] font-mono text-muted">{items.length} item(s)</span>
    </div>
    {items.length === 0 ? <div className="card p-10 text-center"><p className="font-medium">Queue is empty.</p><p className="text-sm text-muted mt-1">New generated content will appear here according to its approval mode.</p></div> :
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">{items.map(item=><article key={item.id} className="card p-5">
        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-mono px-2 py-1 rounded-full border border-violet/30 text-violet">{item.status}</span><span className="text-[10px] text-muted">{item.profile_name}</span></div>
        <h2 className="font-semibold mt-3">{item.title || "Untitled"}</h2>
        <p className="text-sm text-muted mt-3 whitespace-pre-wrap line-clamp-8">{item.caption || "No caption."}</p>
        <div className="flex items-center justify-between gap-2 mt-5 pt-4 border-t border-border"><span className="text-[10px] font-mono text-muted">{item.content_type_name || "Content"}</span>{["needs_review","generated","approved"].includes(item.status) && <button className="btn-primary text-xs" disabled={busy===item.id} onClick={()=>act(item)}>{busy===item.id ? "Working…" : item.status==="approved" ? "Publish" : "Approve"}</button>}</div>
      </article>)}</div>}
  </div>;
}
