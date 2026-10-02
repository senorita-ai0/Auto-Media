import { useEffect, useState } from "react";
import { createAccount, deleteAccount, updateAccount, watchStudioState } from "../lib/studioRepository";
import { importLegacyConnectors } from "../lib/studioApi";
import { useApp } from "../context/AppContext";
import { saveStudioAccountCredential, listOAuthProviders, startOAuth } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

const empty = { platform: "facebook", name: "", externalAccountId: "", credentialRef: "", status: "disconnected", credentialJson: "" };
const platforms = ["facebook","instagram","youtube","tiktok","x","threads","linkedin","pinterest","reddit","telegram","discord"];

export default function Accounts() {
  const [state, setState] = useState({ accounts: [] });
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [migrating, setMigrating] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState([]);
  const [oauthBusy, setOAuthBusy] = useState(null);
  const toast = useToast();

  useEffect(() => watchStudioState(setState), []);
  useEffect(() => {
    listOAuthProviders().then(x => setOAuthProviders(x.providers || [])).catch(() => setOAuthProviders([]));
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (params.get("oauth") === "complete") toast.success("OAuth account connection completed.");
    if (params.get("oauth") === "error") toast.error(params.get("message") || "OAuth connection failed.");
  }, []);


  async function connectOAuth(provider) {
    setOAuthBusy(provider);
    try {
      let options = {};
      if (provider === "mastodon") {
        const instance = window.prompt("Enter your Mastodon instance URL", "https://mastodon.social");
        if (!instance) { setOAuthBusy(null); return; }
        options = { instance };
      }
      const result = await startOAuth(provider, options);
      if (!result.authorizationUrl) throw new Error("OAuth provider did not return an authorization URL.");
      window.location.assign(result.authorizationUrl);
    } catch (error) { toast.error(error.message || "Could not start OAuth."); setOAuthBusy(null); }
  }

  async function migrateLegacy() {
    const connectors = Object.entries(activeUser?.connectors || {}).map(([platform, value]) => ({ platform, ...value, name: activeUser.name + " · " + platform }));
    if (!connectors.length) { toast.error("No legacy connectors found for the active user."); return; }
    if (!window.confirm("Import " + connectors.length + " legacy connector(s) into encrypted Studio credentials?")) return;
    setMigrating(true);
    try {
      const result = await importLegacyConnectors(connectors);
      toast.success((result.imported || []).length + " legacy account(s) migrated.");
    } catch (error) { toast.error(error.message || "Could not migrate legacy connectors."); }
    finally { setMigrating(false); }
  }

  async function save(e) {
    e.preventDefault();
    try {
      let account;
      if (editingId) account = await updateAccount(editingId, form);
      else account = await createAccount({ ...form, status: "disconnected" });
      if (form.credentialJson.trim()) {
        let payload;
        try { payload = JSON.parse(form.credentialJson); } catch { throw new Error("Credential JSON is not valid JSON."); }
        const ref = form.credentialRef.trim() || ("account-" + account.id);
        await saveStudioAccountCredential(account.id, payload, ref);
      }
      toast.success(form.credentialJson.trim() ? "Account and encrypted credential saved." : (editingId ? "Account updated." : "Account added."));
      setEditingId(null);
      setForm(empty);
    } catch (error) {
      toast.error(error.message || "Could not save account.");
    }
  }

  function edit(item) {
    setEditingId(item.id);
    setForm({ ...empty, ...item, credentialJson: "" });
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
        <p className="text-muted text-sm mt-1">Create destination records once, then attach them to any page automation. Secrets are encrypted server-side and never returned to the browser after saving.</p>
        {activeUser && Object.keys(activeUser.connectors || {}).length > 0 && <div className="mt-4 rounded-xl border border-amber/30 bg-amber/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><p className="text-sm font-medium">Legacy connectors detected</p><p className="text-xs text-muted mt-1">{Object.keys(activeUser.connectors || {}).length} connector(s) exist in the old Firebase/local setup for {activeUser.name}.</p></div><button className="btn-ghost text-xs" disabled={migrating} onClick={migrateLegacy}>{migrating ? "Migrating…" : "Import into Studio"}</button></div>}
      </header>

      <section className="card p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><p className="label">Connect with OAuth</p><p className="text-sm font-medium mt-1">Authorize supported social accounts without pasting access tokens into the browser.</p></div>
          <div className="flex flex-wrap gap-2">{oauthProviders.filter(x => x.configured).map(x => <button key={x.id} type="button" className="btn-primary text-xs" disabled={oauthBusy === x.id} onClick={() => connectOAuth(x.id)}>{oauthBusy === x.id ? "Opening…" : x.name}</button>)}</div>
        </div>
        {!oauthProviders.some(x => x.configured) && <p className="text-xs text-muted mt-2">No OAuth provider is configured on the server yet.</p>}
      </section>

      <form onSubmit={save} className="card p-6 md:p-8 mb-8">
        <div className="grid md:grid-cols-2 gap-4">
          <label><span className="label">Platform</span><select className="input" value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{platforms.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
          <label><span className="label">Account / page name</span><input className="input" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Future Tech Facebook" /></label>
          <label><span className="label">External account ID</span><input className="input" value={form.externalAccountId} onChange={e=>setForm({...form,externalAccountId:e.target.value})} placeholder="Page ID / channel ID / user ID" /></label>
          <label><span className="label">Credential reference</span><input className="input" value={form.credentialRef} onChange={e=>setForm({...form,credentialRef:e.target.value})} placeholder="facebook-main" /><p className="text-[10px] text-muted mt-1">Reference only; do not paste a token here.</p></label>
          <label><span className="label">Status</span><select className="input" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="disconnected">Disconnected</option><option value="connected">Connected</option><option value="error">Error</option><option value="needs_auth">Needs authentication</option></select></label>
          <label className="md:col-span-2"><span className="label">Credential JSON</span><textarea className="input min-h-28 font-mono text-xs resize-y" value={form.credentialJson} onChange={e=>setForm({...form,credentialJson:e.target.value})} placeholder='{"pageId":"...","pageAccessToken":"..."}' /><p className="text-[10px] text-muted mt-1">Used only for the save request; the server encrypts it and never returns the secret.</p></label>
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
