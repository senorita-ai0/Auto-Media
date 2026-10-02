import { useEffect, useState } from "react";
import { createProfile, deleteProfile, updateProfile, watchStudioState } from "../lib/studioRepository";
import { useToast } from "../context/ToastContext";

const empty = { name: "", niche: "", language: "English", timezone: "Asia/Karachi", tone: "", audience: "", description: "", masterPrompt: "", disclaimer: "" };

export default function Profiles() {
  const [state, setState] = useState({ profiles: [], automations: [] });
  const [form, setForm] = useState(empty); const [editingId, setEditingId] = useState(null); const toast = useToast();
  useEffect(() => watchStudioState(setState), []);
  function reset() { setEditingId(null); setForm(empty); }
  function edit(item) { setEditingId(item.id); setForm({ ...empty, ...item }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function save(e) { e.preventDefault(); try { if (editingId) await updateProfile(editingId, form); else await createProfile(form); toast.success(editingId ? "Profile updated." : "Profile created."); reset(); } catch (error) { toast.error(error.message || "Could not save profile."); } }
  function remove(item) { if (!window.confirm("Delete " + item.name + "? Its automations will also be removed.")) return; deleteProfile(item.id); if (editingId === item.id) reset(); toast.success("Profile deleted."); }
  return <div className="max-w-6xl">
    <header className="mb-8"><p className="label">Content system · 01</p><h1 className="font-display text-3xl font-semibold tracking-tight">Pages & profiles</h1><p className="text-muted text-sm mt-1">Give every brand its own identity and master prompt while sharing the same content engine.</p></header>
    <form onSubmit={save} className="card p-6 md:p-8 mb-8"><div className="flex items-center justify-between mb-6"><div><p className="label mb-1">{editingId ? "Edit profile" : "New profile"}</p><h2 className="text-lg font-semibold">{editingId ? "Update page strategy" : "Create a page profile"}</h2></div>{editingId && <button type="button" className="btn-ghost text-xs" onClick={reset}>Cancel</button>}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <label><span className="label">Page / brand name</span><input className="input" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Future Tech" /></label>
        <label><span className="label">Niche</span><input className="input" value={form.niche} onChange={e=>setForm({...form,niche:e.target.value})} placeholder="Technology news" /></label>
        <label><span className="label">Language</span><input className="input" value={form.language} onChange={e=>setForm({...form,language:e.target.value})} /></label>
        <label><span className="label">Timezone</span><input className="input" value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value})} placeholder="Asia/Karachi" /></label>
        <label><span className="label">Tone</span><input className="input" value={form.tone} onChange={e=>setForm({...form,tone:e.target.value})} placeholder="Modern, simple, factual" /></label>
        <label><span className="label">Audience</span><input className="input" value={form.audience} onChange={e=>setForm({...form,audience:e.target.value})} placeholder="Tech enthusiasts" /></label>
        <label className="md:col-span-2"><span className="label">Description</span><input className="input" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="What this page publishes" /></label>
        <label className="md:col-span-2"><span className="label">Initial / master prompt</span><textarea className="input min-h-48 resize-y" value={form.masterPrompt} onChange={e=>setForm({...form,masterPrompt:e.target.value})} placeholder="Tell the AI what this page should create, how it should sound, what it should avoid, and what the audience should get from it." /><p className="text-[11px] text-muted mt-2">This prompt is attached to every automation that uses this profile.</p></label>
        <label className="md:col-span-2"><span className="label">Disclaimer</span><input className="input" value={form.disclaimer} onChange={e=>setForm({...form,disclaimer:e.target.value})} placeholder="Optional disclaimer added by the content formatter" /></label>
      </div><div className="mt-6"><button className="btn-primary">{editingId ? "Save profile" : "Create profile"}</button></div>
    </form>
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{state.profiles.length === 0 ? <div className="card p-8 md:col-span-2 xl:col-span-3"><p className="font-medium">No profiles yet.</p><p className="text-sm text-muted mt-1">Create Future Tech and give it the prompt that defines its content.</p></div> : state.profiles.map(profile => <article key={profile.id} className="card p-5"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-mono px-2 py-1 rounded-full border border-teal/30 text-teal bg-teal/5">PROFILE</span><h2 className="font-display text-xl font-semibold mt-3">{profile.name}</h2><p className="text-muted text-xs mt-1">{profile.niche || "No niche configured"}</p></div><span className="text-[10px] font-mono text-muted">{state.automations.filter(x=>x.profileId===profile.id).length} automations</span></div><p className="text-sm text-muted mt-4 line-clamp-4">{profile.masterPrompt || "No master prompt configured yet."}</p><div className="flex gap-2 mt-5"><button className="btn-ghost text-xs" onClick={()=>edit(profile)}>Edit</button><button className="text-xs text-rose hover:underline px-2" onClick={()=>remove(profile)}>Delete</button></div></article>)}</div>
  </div>;
}