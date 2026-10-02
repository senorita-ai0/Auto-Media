import { useEffect, useState } from "react";
import { createAiProvider, deleteAiProvider, listAiProviders, testAiProvider, updateAiProvider } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

const empty = {
  name: "",
  baseUrl: "https://api.openai.com/v1",
  textModel: "",
  imageModel: "",
  imageBaseUrl: "",
  temperature: 0.7,
  jsonMode: true,
  apiKey: ""
};

export default function AiProviders() {
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [testing, setTesting] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setProviders((await listAiProviders()).providers || []); }
    catch (error) { toast.error(error.message || "Could not load AI providers."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function edit(item) {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      baseUrl: item.base_url || "",
      textModel: item.text_model || "",
      imageModel: item.image_model || "",
      imageBaseUrl: item.image_base_url || "",
      temperature: Number(item.temperature ?? 0.7),
      jsonMode: Boolean(item.json_mode),
      apiKey: ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(empty);
  }

  async function save(e) {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        temperature: Number(form.temperature)
      };
      if (editingId) await updateAiProvider(editingId, payload);
      else await createAiProvider(payload);
      toast.success(editingId ? "AI provider updated." : "AI provider created.");
      reset();
      await load();
    } catch (error) { toast.error(error.message || "Could not save AI provider."); }
  }

  async function test(item) {
    setTesting(item.id);
    try {
      const result = await testAiProvider(item.id);
      if (!result.ok) throw new Error("Provider responded, but the JSON connection test did not pass.");
      toast.success(item.name + " connection is working.");
    } catch (error) { toast.error(error.message || "AI provider test failed."); }
    finally { setTesting(null); }
  }

  async function remove(item) {
    if (!window.confirm("Delete " + item.name + "? Automations using it will fall back to the workspace's first enabled provider.")) return;
    try { await deleteAiProvider(item.id); toast.success("AI provider deleted."); await load(); if (editingId === item.id) reset(); }
    catch (error) { toast.error(error.message || "Could not delete AI provider."); }
  }

  return <div className="max-w-7xl">
    <header className="mb-8">
      <p className="label">Workspace · AI providers</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Shared AI</h1>
      <p className="text-muted text-sm mt-1">Configure an AI provider once and reuse it across every page, content type and automation in this workspace.</p>
    </header>

    <form onSubmit={save} className="card p-6 md:p-8 mb-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div><p className="label">{editingId ? "Edit provider" : "New provider"}</p><p className="font-medium mt-1">{editingId ? "Update shared AI settings" : "Add an OpenAI-compatible provider"}</p></div>
        {editingId && <button type="button" className="btn-ghost text-xs" onClick={reset}>Cancel</button>}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <label><span className="label">Provider name</span><input className="input" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="OpenAI Production" /></label>
        <label><span className="label">Text model</span><input className="input" required value={form.textModel} onChange={e=>setForm({...form,textModel:e.target.value})} placeholder="gpt-4.1-mini" /></label>
        <label className="md:col-span-2"><span className="label">Base URL</span><input className="input" required value={form.baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})} placeholder="https://api.openai.com/v1" /><p className="text-[10px] text-muted mt-1">Must expose a compatible <code>/chat/completions</code> endpoint.</p></label>
        <label><span className="label">Image model</span><input className="input" value={form.imageModel} onChange={e=>setForm({...form,imageModel:e.target.value})} placeholder="Optional" /></label>
        <label><span className="label">Image base URL</span><input className="input" value={form.imageBaseUrl} onChange={e=>setForm({...form,imageBaseUrl:e.target.value})} placeholder="Leave blank to use Base URL" /></label>
        <label><span className="label">Temperature</span><input className="input" type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={e=>setForm({...form,temperature:e.target.value})} /></label>
        <label className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 cursor-pointer"><input type="checkbox" checked={form.jsonMode} onChange={e=>setForm({...form,jsonMode:e.target.checked})} /><span><span className="block text-sm font-medium">JSON response mode</span><span className="block text-[10px] text-muted mt-1">Ask compatible chat APIs for structured JSON.</span></span></label>
        <label className="md:col-span-2"><span className="label">{editingId ? "Replace API key" : "API key"}</span><input className="input" type="password" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} placeholder={editingId ? "Leave blank to keep current key" : "sk-…"} required={!editingId} autoComplete="new-password" /><p className="text-[10px] text-muted mt-1">Encrypted in the Studio credential vault. Never returned to the browser.</p></label>
      </div>
      <div className="mt-6"><button className="btn-primary">{editingId ? "Save provider" : "Create provider"}</button></div>
    </form>

    {loading ? <div className="card p-8 text-sm text-muted">Loading providers…</div> : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
      {providers.length === 0 ? <div className="card p-8 md:col-span-2 xl:col-span-3"><p className="font-medium">No workspace AI providers yet.</p><p className="text-sm text-muted mt-1">Add one here, then select it from any automation.</p></div> :
      providers.map(item => <article key={item.id} className="card p-5">
        <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-mono px-2 py-1 rounded-full border border-teal/30 text-teal bg-teal/5">SHARED</span><h2 className="font-display text-lg font-semibold mt-3">{item.name}</h2></div><span className="text-[10px] font-mono text-muted">{item.enabled ? "ENABLED" : "DISABLED"}</span></div>
        <p className="text-xs text-muted mt-3 break-all">{item.base_url}</p>
        <p className="text-xs text-muted mt-1">Text: <span className="text-ivory">{item.text_model}</span>{item.image_model ? " · Image: " + item.image_model : ""}</p>
        <p className="text-[10px] font-mono text-muted mt-2">Credential: {item.credential_ref}</p>
        <div className="flex gap-2 mt-5"><button className="btn-ghost text-xs" disabled={testing===item.id} onClick={()=>test(item)}>{testing===item.id ? "Testing…" : "Test"}</button><button className="btn-ghost text-xs" onClick={()=>edit(item)}>Edit</button><button className="text-xs text-rose hover:underline px-2" onClick={()=>remove(item)}>Delete</button></div>
      </article>)}
    </div>}
  </div>;
}
