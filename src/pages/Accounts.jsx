import { useEffect, useState } from "react";
import { createAccount, deleteAccount, updateAccount, watchStudioState } from "../lib/studioRepository";
import { useToast } from "../context/ToastContext";

const empty = { platform: "facebook", name: "", externalAccountId: "", credentialRef: "", status: "disconnected" };
const platforms = ["facebook","instagram","youtube","tiktok","x","threads","linkedin","pinterest","reddit","telegram","discord"];

export default function Accounts() {
  const [state, setState] = useState({ accounts: [] });
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const toast = useToast();

  useEffect(() => watchStudioState(setState), []);

  async function save(e) {
    e.preventDefault();
    try {
      if (editingId) await updateAccount(editingId, form);
      else await createAccount(form);
      toast.success(editingId ? "Account updated." : "Account added.");
      setEditingId(null);
      setForm(empty);
    } catch (error) {
      toast.error(error.message || "Could not save account.");
    }
  }

  function edit(item) {
    setEditingId(item.id);
    setForm({ ...empty, ...item });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(item) {
    if (!window.confirm("Remove " + item.name + "?")) return;
    try {
      await deleteAccount(item.id);
      toast.success("Account removed.");
    } catch (error) {
      toast.error(error.message || "Could not remove account.");
    }
  }

  return (
    <div className="max-w-6xl">
      <header className="mb-8">
        <p className="label">Content system · accounts</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Social accounts</h1>
        <p className="text-muted text-sm mt-1">Create destination records once, then attach them to any page automation. Actual access tokens stay outside this new Studio database layer until the secure credential migration.</p>
      </header>

      <form onSubmit={save} className="card p-6 md:p-8 mb-8">
        <div className="grid md:grid-cols-2 gap-4">
          <label><span className="label">Platform</span><select className="input" value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{platforms.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
          <label><span className="label">Account / page name</span><input className="input" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Future Tech Facebook" /></label>
          <label><span className="label">External account ID</span><input className="input" value={form.externalAccountId} onChange={e=>setForm({...form,externalAccountId:e.target.value})} placeholder="Page ID / channel ID / user ID" /></label>
          <label><span className="label">Credential reference</span><input className="input" value={form.credentialRef} onChange={e=>setForm({...form,credentialRef:e.target.value})} placeholder="facebook-main" /><p className="text-[10px] text-muted mt-1">Reference only; do not paste a token here.</p></label>
          <label><span className="label">Status</span><select className="input" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="error">Error</option><option value="needs_auth">Needs authentication</option></select></label>
        </div>
        <div className="mt-6 flex gap-2"><button className="btn-primary">{editingId ? "Save account" : "Add account"}</button>{editingId && <button type="button" className="btn-ghost text-xs" onClick={()=>{setEditingId(null);setForm(empty)}}>Cancel</button>}</div>
      </form>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {state.accounts?.length ? state.accounts.map(item => (
          <article key={item.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div><span className="text-[10px] font-mono px-2 py-1 rounded-full border border-violet/30 text-violet bg-violet/5">{item.platform}</span><h2 className="font-display text-lg font-semibold mt-3">{item.name}</h2></div>
              <span className="text-[10px] font-mono text-muted">{item.status}</span>
            </div>
            <p className="text-xs text-muted mt-3">ID: {item.externalAccountId || "not set"}</p>
            <p className="text-xs text-muted mt-1">Credential ref: {item.credentialRef || "not set"}</p>
            <div className="flex gap-2 mt-5"><button className="btn-ghost text-xs" onClick={()=>edit(item)}>Edit</button><button className="text-xs text-rose hover:underline px-2" onClick={()=>remove(item)}>Delete</button></div>
          </article>
        )) : <div className="card p-8 md:col-span-2 xl:col-span-3"><p className="font-medium">No social accounts yet.</p><p className="text-sm text-muted mt-1">Add a destination such as a Facebook Page or Instagram account.</p></div>}
      </div>
    </div>
  );
}
