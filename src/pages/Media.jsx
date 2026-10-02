import { useEffect, useMemo, useRef, useState } from "react";
import { deleteStudioMedia, listStudioMedia, uploadStudioMedia, assignStudioBrandAsset, listStudioBrandAssets, removeStudioBrandAsset } from "../lib/studioApi";
import { watchStudioState } from "../lib/studioRepository";
import { useToast } from "../context/ToastContext";

const API_BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:8787";

function sizeLabel(value) {
  const n = Number(value || 0);
  if (!n) return "";
  const units = ["B","KB","MB","GB"];
  let i = 0, x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return x.toFixed(i ? 1 : 0) + " " + units[i];
}

export default function Media() {
  const [studio, setStudio] = useState({ profiles: [] });
  const [profileId, setProfileId] = useState("");
  const [media, setMedia] = useState([]);
  const [brandAssets, setBrandAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const result = await listStudioMedia(profileId);
      setMedia(result.media || []);
      if (profileId) setBrandAssets((await listStudioBrandAssets(profileId)).assets || []); else setBrandAssets([]);
    } catch (error) { toast.error(error.message || "Could not load media."); }
    finally { setLoading(false); }
  }

  useEffect(() => watchStudioState(setStudio), []);
  useEffect(() => { load(); }, [profileId]);

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    let count = 0;
    try {
      for (const file of files) {
        if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) continue;
        if (file.size > 250 * 1024 * 1024) { toast.error(file.name + " is larger than 250 MB."); continue; }
        await uploadStudioMedia(file, profileId);
        count++;
      }
      if (count) toast.success(count + " media file(s) uploaded.");
      await load();
    } catch (error) { toast.error(error.message || "Media upload failed."); }
    finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function assignRole(item, role) {
    if (!profileId) { toast.error("Select a profile before assigning a brand role."); return; }
    try { await assignStudioBrandAsset(profileId, item.id, role); toast.success("Assigned as " + role + "."); await load(); }
    catch (error) { toast.error(error.message || "Could not assign brand role."); }
  }

  async function unassign(item) {
    if (!profileId) return;
    try { await removeStudioBrandAsset(profileId, item.id); toast.success("Brand role removed."); await load(); }
    catch (error) { toast.error(error.message || "Could not remove brand role."); }
  }

  async function remove(item) {
    if (!window.confirm("Delete " + item.storage_key + "?")) return;
    try { await deleteStudioMedia(item.id); toast.success("Media deleted."); await load(); }
    catch (error) { toast.error(error.message || "Could not delete media."); }
  }

  const stats = useMemo(() => ({
    images: media.filter(x => x.type === "image").length,
    videos: media.filter(x => x.type === "video").length,
    bytes: media.reduce((n,x)=>n+Number(x.file_size||0),0)
  }), [media]);

  return <div className="max-w-7xl">
    <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-5">
      <div><p className="label">Content system · media</p><h1 className="font-display text-3xl font-semibold tracking-tight">Media Library</h1><p className="text-muted text-sm mt-1">Upload reusable images and videos into the workspace storage used by your automations and publishing jobs.</p></div>
      <div className="flex gap-2">
        <select className="input text-xs" value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">Workspace media</option>{studio.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button className="btn-primary text-xs" disabled={uploading} onClick={()=>inputRef.current?.click()}>{uploading ? "Uploading…" : "Upload media"}</button>
        <input ref={inputRef} type="file" className="hidden" multiple accept="image/*,video/*" onChange={upload} />
      </div>
    </header>

    <div className="grid sm:grid-cols-3 gap-3 mb-6">
      <div className="card p-4"><p className="label">Images</p><p className="text-2xl font-display font-semibold mt-1">{stats.images}</p></div>
      <div className="card p-4"><p className="label">Videos</p><p className="text-2xl font-display font-semibold mt-1">{stats.videos}</p></div>
      <div className="card p-4"><p className="label">Stored size</p><p className="text-2xl font-display font-semibold mt-1">{sizeLabel(stats.bytes) || "0 B"}</p></div>
    </div>

    {loading ? <div className="card p-8 text-sm text-muted">Loading media…</div> :
      media.length === 0 ? <div className="card p-10 text-center"><p className="font-medium">No media yet.</p><p className="text-sm text-muted mt-1">Upload a video or image to make it available to your content pipeline.</p></div> :
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{media.map(item=>{
        const url=item.media_url?.startsWith("http") ? item.media_url : item.media_url ? API_BASE+item.media_url : null;
        return <article key={item.id} className="card overflow-hidden">
          {url && item.type==="image" ? <img src={url} alt="" className="w-full aspect-square object-cover bg-black/20"/> :
           url && item.type==="video" ? <video src={url} controls className="w-full aspect-square object-cover bg-black/20"/> :
           <div className="w-full aspect-square flex items-center justify-center bg-black/10 text-muted text-xs">No preview</div>}
          <div className="p-4"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-mono border border-violet/30 text-violet rounded-full px-2 py-1">{item.type}</span><span className="text-[10px] font-mono text-muted">{sizeLabel(item.file_size)}</span></div>{profileId && <div className="mt-3 flex flex-wrap gap-1.5">{["logo","watermark","cover","background","reference"].map(role=>{const assigned=brandAssets.some(x=>x.media_asset_id===item.id && x.role===role); return <button key={role} type="button" className={assigned ? "text-[9px] font-mono px-2 py-1 rounded-full border border-teal/30 text-teal bg-teal/5" : "text-[9px] font-mono px-2 py-1 rounded-full border border-border text-muted hover:border-violet/30"} onClick={()=>assigned ? unassign(item) : assignRole(item,role)}>{assigned ? "✓ " : ""}{role}</button>})}</div>}<p className="text-xs font-medium truncate mt-3" title={item.storage_key}>{item.storage_key}</p><p className="text-[10px] text-muted mt-1">{item.profile_name || "Unassigned"} · {item.source || "media"}</p><button className="text-[10px] text-rose hover:underline mt-4" onClick={()=>remove(item)}>Delete</button></div>
        </article>
      })}</div>}
  </div>;
}
