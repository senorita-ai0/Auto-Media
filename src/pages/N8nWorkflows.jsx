import { useEffect, useState } from "react";
import {
  getN8nStatus,
  listN8nWorkflows,
  getN8nWorkflow,
  importN8nWorkflow,
  activateN8nWorkflow,
  deactivateN8nWorkflow,
  duplicateN8nWorkflow,
  testN8nWorkflow,\n  listN8nExecutions\n} from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

const example = {
  name: "Auto-Media example",
  nodes: [
    {
      parameters: { path: "automedia-example", httpMethod: "POST", responseMode: "onReceived" },
      id: "webhook",
      name: "Auto-Media Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "automedia-example"
    }
  ],
  connections: {}
};

export default function N8nWorkflows() {
  const [status, setStatus] = useState(null);
  const [workflows, setWorkflows] = useState([]);\n  const [executions, setExecutions] = useState([]);
  const [json, setJson] = useState("");
  const [selected, setSelected] = useState(null);
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  async function refresh() {
    try {
      const [s, w] = await Promise.all([getN8nStatus(), listN8nWorkflows()]);
      setStatus(s);
      setWorkflows(w.workflows || []);
    } catch (error) { toast.error(error.message || "Could not load n8n."); }
  }
  useEffect(() => { refresh(); }, []);

  async function inspect(id) {
    try { setSelected((await getN8nWorkflow(id)).workflow); }
    catch (error) { toast.error(error.message || "Could not inspect workflow."); }
  }

  async function importWorkflow() {
    try {
      const parsed = JSON.parse(json);
      const result = await importN8nWorkflow(parsed, { importedFrom: "chatgpt" });
      toast.success("n8n workflow imported as draft.");
      setSelected(result.workflow);
      setJson("");
      await refresh();
    } catch (error) {
      toast.error(error.message || "Workflow import failed.");
    }
  }

  async function activate(item) {
    try {
      await activateN8nWorkflow(item.id);
      toast.success("Workflow activated.");
      await refresh();
      await inspect(item.id);
    } catch (error) { toast.error(error.message || "Could not activate workflow."); }
  }
  async function deactivate(item) {
    try {
      await deactivateN8nWorkflow(item.id);
      toast.success("Workflow deactivated.");
      await refresh();
      await inspect(item.id);
    } catch (error) { toast.error(error.message || "Could not deactivate workflow."); }
  }
  async function duplicate(item) {
    try {
      const result = await duplicateN8nWorkflow(item.id);
      toast.success("Workflow duplicated as draft.");
      setSelected(result.workflow);
      await refresh();
    } catch (error) { toast.error(error.message || "Could not duplicate workflow."); }
  }
  async function test(item) {
    setTesting(true);
    try {
      const result = await testN8nWorkflow(item.id, { jobId: null, profileId: null, contentTypeId: null, automationId: null });
      toast.success("n8n test webhook was triggered.");
      setSelected((prev) => prev ? { ...prev, lastTest: result } : prev);
    } catch (error) { toast.error(error.message || "n8n test failed."); }
    finally { setTesting(false); }
  }

  return <div className="max-w-6xl">
    <header className="mb-8">
      <p className="label">Advanced automation · n8n</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Workflow bridge</h1>
      <p className="text-muted text-sm mt-1">Paste n8n JSON created by ChatGPT, validate it, review the requirements, then activate it for an automation.</p>
    </header>

    <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-6">
      <section className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <div><p className="label">Import workflow JSON</p><p className="text-xs text-muted mt-1">Secrets are rejected during import. Use n8n credential references.</p></div>
          <button className="btn-ghost text-xs" onClick={()=>setJson(JSON.stringify(example,null,2))}>Load example</button>
        </div>
        <textarea className="input min-h-[360px] font-mono text-[11px] resize-y" value={json} onChange={e=>setJson(e.target.value)} placeholder='Paste the exported n8n workflow JSON here…' />
        <div className="flex gap-2 mt-4">
          <button className="btn-primary" disabled={!json.trim()} onClick={importWorkflow}>Validate &amp; import</button>
          <button className="btn-ghost" onClick={()=>setJson("")}>Clear</button>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <p className="label">n8n connection</p>
            <span className={"text-[10px] font-mono px-2 py-1 rounded-full border " + (status?.reachable ? "border-teal/40 text-teal bg-teal/10" : "border-border text-muted")}>
              {status?.reachable ? "CONNECTED" : status?.configured ? "UNREACHABLE" : "NOT CONFIGURED"}
            </span>
          </div>
          <p className="text-xs text-muted mt-3">{status?.message || "Checking n8n…"}</p>
        </section>

        <section className="card p-5">
          <p className="label mb-3">Imported workflows</p>
          {workflows.length === 0 ? <p className="text-sm text-muted">No workflows stored yet.</p> : <div className="grid gap-2">
            {workflows.map(item => <button key={item.id} onClick={()=>inspect(item.id)} className={"text-left rounded-xl border p-3 transition-colors " + (selected?.id===item.id ? "border-violet/40 bg-violet/5" : "border-border hover:border-violet/30")}>
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-sm truncate">{item.name}</span><span className="text-[10px] font-mono text-muted">{item.status}</span></div>
              <p className="text-[10px] text-muted mt-1">v{item.version} · {item.n8n_workflow_id || "no n8n id"}</p>
            </button>)}
          </div>}
        </section>
      </aside>
    </div>

    <section className="card p-6 mt-6">
      <div className="flex items-center justify-between mb-4"><div><p className="label">Execution history</p><p className="text-xs text-muted mt-1">Auto-Media records the handoff and callback state for every n8n run.</p></div><button className="btn-ghost text-xs" onClick={refresh}>Refresh</button></div>
      {executions.length === 0 ? <p className="text-sm text-muted">No n8n executions yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted border-b border-border"><th className="py-2 pr-3">Started</th><th className="py-2 pr-3">Workflow</th><th className="py-2 pr-3">Status</th><th className="py-2">Execution</th></tr></thead><tbody>{executions.map(x=><tr key={x.id} className="border-b border-border/60"><td className="py-2 pr-3 whitespace-nowrap">{x.started_at ? new Date(x.started_at).toLocaleString() : "—"}</td><td className="py-2 pr-3">{x.workflow_name || "Unknown"}</td><td className="py-2 pr-3 font-mono">{x.status}</td><td className="py-2 font-mono text-[10px] text-muted">{x.external_execution_id || x.id}</td></tr>)}</tbody></table></div>}
    </section>

    {selected && <section className="card p-6 mt-6">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
        <div>
          <p className="label">Workflow inspection</p>
          <h2 className="font-display text-xl font-semibold mt-2">{selected.name}</h2>
          <p className="text-xs text-muted mt-1">Stored version {selected.version} · {selected.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.status === "active" ? <button className="btn-ghost text-xs" onClick={()=>deactivate(selected)}>Deactivate</button> : <button className="btn-primary text-xs" onClick={()=>activate(selected)}>Activate</button>}
          <button className="btn-ghost text-xs" onClick={()=>duplicate(selected)}>Duplicate</button>
          <button className="btn-ghost text-xs" disabled={testing} onClick={()=>test(selected)}>{testing ? "Testing…" : "Test webhook"}</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 mt-6">
        {[["Nodes", selected.validation?.nodeCount || 0],["Triggers", selected.validation?.triggerNodes?.length || 0],["AI nodes", selected.validation?.aiNodes?.length || 0],["HTTP nodes", selected.validation?.httpNodes?.length || 0]].map(([label,value])=><div key={label} className="rounded-xl border border-border p-4"><p className="label">{label}</p><p className="font-display text-2xl font-semibold mt-1">{value}</p></div>)}
      </div>
      {selected.validationErrors?.length > 0 && <div className="mt-5 rounded-xl border border-rose/30 bg-rose/5 p-4"><p className="label text-rose">Validation errors</p><pre className="text-xs text-rose whitespace-pre-wrap mt-2">{selected.validationErrors.join("\n")}</pre></div>}
      {selected.validationWarnings?.length > 0 && <div className="mt-5 rounded-xl border border-amber/30 bg-amber/5 p-4"><p className="label">Warnings</p><pre className="text-xs text-muted whitespace-pre-wrap mt-2">{selected.validationWarnings.join("\n")}</pre></div>}
      <div className="grid md:grid-cols-2 gap-5 mt-5">
        <div><p className="label mb-2">Webhook paths</p><pre className="text-[11px] bg-black/20 border border-border rounded-xl p-3 overflow-auto">{JSON.stringify(selected.validation?.webhookPaths || [], null, 2)}</pre></div>
        <div><p className="label mb-2">Credential requirements</p><pre className="text-[11px] bg-black/20 border border-border rounded-xl p-3 overflow-auto">{JSON.stringify(selected.validation?.credentialRequirements || [], null, 2)}</pre></div>
      </div>
      {selected.lastTest && <div className="mt-5"><p className="label mb-2">Last test</p><pre className="text-[11px] bg-black/20 border border-border rounded-xl p-3 overflow-auto">{JSON.stringify(selected.lastTest,null,2)}</pre></div>}
    </section>}
  </div>;
}
