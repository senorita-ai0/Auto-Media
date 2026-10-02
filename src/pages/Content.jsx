import { useEffect, useState } from "react";
import { listStudioContent, approveStudioContent, publishStudioContent, regenerateStudioContent, scheduleStudioContent, cancelScheduledStudioContent, updateStudioContent } from "../lib/studioApi";
import { watchStudioState } from "../lib/studioRepository";
import { useToast } from "../context/ToastContext";

const API_BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:8787";

export default function Content() {
  const [studio, setStudio] = useState({ profiles: [] });
  const [profileId, setProfileId] = useState("");
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [scheduleAt, setScheduleAt] = useState({});
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({title:"",caption:"",hashtags:""});

  useEffect(() => watchStudioState(setStudio), []);

  async function load() {
    setLoading(true);
    try {
      const result = await listStudioContent(profileId);
      setItems(result.content || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch(() => setItems([])); }, [profileId]);

  function mediaUrl(item) {
    if (item.media_url) return item.media_url;
    if (!item.storage_key) return null;
    return API_BASE + "/media/" + item.storage_key.split("/").map(encodeURIComponent).join("/");
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editing) return;
    setBusyId(editing.id);
    try {
      const hashtags = editForm.hashtags.split(",").map(x=>x.trim()).filter(Boolean);
      await updateStudioContent(editing.id, { title: editForm.title, caption: editForm.caption, hashtags });
      await load();
      toast.success("Content updated.");
      setEditing(null);
    } catch (error) { toast.error(error.message || "Could not update content."); }
    finally { setBusyId(null); }
  }

  function openEdit(item) {
    setEditing(item);
    const tags = Array.isArray(item.structured_data_json?.hashtags) ? item.structured_data_json.hashtags : (Array.isArray(item.hashtags) ? item.hashtags : []);
    setEditForm({ title: item.title || "", caption: item.caption || "", hashtags: tags.join(", ") });
  }

  async function approve(item) {
    setBusyId(item.id);
    try { await approveStudioContent(item.id); await load(); toast.success("Content approved and publishing jobs queued."); } catch (error) { toast.error(error.message || "Could not approve content."); } finally { setBusyId(null); }
  }

  async function cancelSchedule(item) {
    setBusyId(item.id);
    try { await cancelScheduledStudioContent(item.id); await load(); toast.success("Scheduled publish cancelled."); }
    catch (error) { toast.error(error.message || "Could not cancel schedule."); }
    finally { setBusyId(null); }
  }

  async function schedule(item) {
    const value = scheduleAt[item.id];
    if (!value) { toast.error("Choose a future publish time first."); return; }
    setBusyId(item.id);
    try { await scheduleStudioContent(item.id, new Date(value).toISOString()); await load(); toast.success("Content scheduled."); }
    catch (error) { toast.error(error.message || "Could not schedule content."); }
    finally { setBusyId(null); }
  }

  async function regenerate(item) {
    setBusyId(item.id);
    try {
      const result = await regenerateStudioContent(item.id);
      await load();
      toast.success(result.status === "published" ? "Content regenerated and published." : "Content regenerated.");
    } catch (error) { toast.error(error.message || "Could not regenerate content."); }
    finally { setBusyId(null); }
  }

  async function publish(item) {
    setBusyId(item.id);
    try { const result = await publishStudioContent(item.id); await load(); const failed = (result.jobs || []).filter(x => x.status === "failed").length; failed ? toast.error("Some destinations failed. Check Publishing Jobs.") : toast.success("Content published to the configured destinations."); } catch (error) { toast.error(error.message || "Could not publish content."); } finally { setBusyId(null); }
  }

  return (
    <div className="max-w-7xl">
      <header className="mb-8">
        <p className="label">Content system · 04</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Content library</h1>
        <p className="text-muted text-sm mt-1">Every generated item is stored separately from publishing, so you can review, reuse and publish it later.</p>
      </header>

      <div className="card p-4 mb-6 flex flex-wrap items-center gap-3">
        <span className="label mb-0 mr-1">Filter</span>
        <select className="input max-w-xs" value={profileId} onChange={e=>setProfileId(e.target.value)}>
          <option value="">All profiles</option>
          {studio.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn-ghost text-xs" onClick={()=>load().catch(()=>{})}>Refresh</button>
      </div>

      {loading ? (
        <div className="card p-8"><p className="text-sm text-muted">Loading content…</p></div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center"><p className="font-medium">No generated content yet.</p><p className="text-sm text-muted mt-1">Run a native automation from the Automations page to create your first item.</p></div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {items.map(item => {
            const image = mediaUrl(item);
            return (
              <article key={item.id} className="card overflow-hidden">
                {image && String(item.mime_type || "").startsWith("image/") && <img src={image} alt="" className="w-full aspect-[4/3] object-cover bg-black/20" />}{image && String(item.mime_type || "").startsWith("video/") && <video src={image} controls className="w-full aspect-[4/3] object-cover bg-black/20" />}
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono px-2 py-1 rounded-full border border-violet/30 text-violet bg-violet/5">{item.status}</span>
                    <span className="text-[10px] font-mono text-muted">{item.content_type_name || "Content"}</span>
                  </div>
                  <h2 className="font-semibold mt-3 line-clamp-2">{item.title || "Untitled"}</h2>
                  <p className="text-sm text-muted mt-3 whitespace-pre-wrap line-clamp-7">{item.caption || "No caption."}</p>
                  <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2 items-center flex-wrap">{["needs_review","generated","approved","scheduled"].includes(item.status) && <button className="btn-ghost text-xs" disabled={busyId===item.id} onClick={()=>openEdit(item)}>Edit</button>}{["needs_review","generated","approved"].includes(item.status) && <button className="btn-ghost text-xs" disabled={busyId===item.id} onClick={()=>item.status==="approved" ? publish(item) : approve(item)}>{busyId===item.id ? "Working…" : item.status==="approved" ? "Publish" : "Approve & queue"}</button>}{["needs_review","generated","approved"].includes(item.status) && <button className="btn-ghost text-xs" disabled={busyId===item.id} onClick={()=>regenerate(item)}>{busyId===item.id ? "Working…" : "Regenerate"}</button>}{["approved","scheduled"].includes(item.status) && <><input type="datetime-local" className="input text-[10px] w-48" value={scheduleAt[item.id] || ""} onChange={e=>setScheduleAt({...scheduleAt,[item.id]:e.target.value})} /><button className="btn-ghost text-xs" disabled={busyId===item.id} onClick={()=>schedule(item)}>{item.status==="scheduled" ? "Reschedule" : "Schedule"}</button></>}{item.status==="published" && <span className="text-[10px] font-mono text-teal">PUBLISHED</span>}{item.status==="scheduled" && item.scheduled_at && <><span className="text-[10px] font-mono text-teal">{new Date(item.scheduled_at).toLocaleString()}</span><button className="text-[10px] text-rose hover:underline" disabled={busyId===item.id} onClick={()=>cancelSchedule(item)}>Cancel</button></>}</div>
                    <span className="text-[10px] font-mono text-muted">{item.profile_name || "Profile"}</span>
                    {item.source_data_json?.url && <a href={item.source_data_json.url} target="_blank" rel="noreferrer" className="text-[10px] text-teal font-mono">source ↗</a>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
