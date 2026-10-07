import { useEffect, useState } from "react";
import {
  getN8nStatus,
  listN8nWorkflows,
  getN8nWorkflow,
  importN8nWorkflow,
  activateN8nWorkflow,
  deactivateN8nWorkflow,
  duplicateN8nWorkflow,
  testN8nWorkflow,
  listN8nExecutions,
  mapN8nWorkflowCredentials,
  listStudioCredentials,
  listProfiles,
  listContentTypes,
  getN8nDeploymentStatus,
  deployN8nWorkflow,
  activateN8nWorkflowInInstance,
  deactivateN8nWorkflowInInstance
} from "../lib/studioApi";
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
  const [workflows, setWorkflows] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [json, setJson] = useState("");
  const [selected, setSelected] = useState(null);
  const [testing, setTesting] = useState(false);
  const [deployment, setDeployment] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [credentialNames, setCredentialNames] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [promptProfile, setPromptProfile] = useState("");
  const [promptType, setPromptType] = useState("");
  const [studioCredentials, setStudioCredentials] = useState([]);
  const [credentialMap, setCredentialMap] = useState({});
  const toast = useToast();

  async function refresh() {
    try {
      const [s, w, e, credentials, deploymentStatus] = await Promise.all([getN8nStatus(), listN8nWorkflows(), listN8nExecutions(), listStudioCredentials(), getN8nDeploymentStatus()]);
      setStatus(s);
      setWorkflows(w.workflows || []);
      setExecutions(e.executions || []);
      setStudioCredentials(credentials.credentials || []);
      setProfiles(p.profiles || []);
      setContentTypes(ct.contentTypes || []);
      setDeployment(deploymentStatus);
    } catch (error) { toast.error(error.message || "Could not load n8n."); }
  }
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!selected?.credential_map_json) return;
    setCredentialMap(selected.credential_map_json || {});
  }, [selected?.id]);

  async function inspect(id) {
    try {
      const workflow = (await getN8nWorkflow(id)).workflow;
      setSelected(workflow);
      const required = workflow.validation?.credentialRequirements || [];
      setCredentialNames(Array.from(new Set(required.map(x => x.name || x.type).filter(Boolean))));
      setCredentialMap(workflow.credential_map_json || {});
    } catch (error) { toast.error(error.message || "Could not inspect workflow."); }
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
  async function deploy(item) {
    setDeploying(true);
    try { const result = await deployN8nWorkflow(item.id); toast.success("Workflow deployed to n8n."); setSelected(prev => prev ? { ...prev, ...result.workflow } : prev); await refresh(); }
    catch (error) { toast.error(error.message || "Could not deploy workflow to n8n."); }
    finally { setDeploying(false); }
  }

  async function activateInstance(item) {
    setDeploying(true);
    try { await activateN8nWorkflowInInstance(item.id); toast.success("Workflow activated in n8n."); await refresh(); }
    catch (error) { toast.error(error.message || "Could not activate workflow in n8n."); }
    finally { setDeploying(false); }
  }

  async function deactivateInstance(item) {
    setDeploying(true);
    try { await deactivateN8nWorkflowInInstance(item.id); toast.success("Workflow deactivated in n8n."); await refresh(); }
    catch (error) { toast.error(error.message || "Could not deactivate workflow in n8n."); }
    finally { setDeploying(false); }
  }

  function buildChatGptPrompt() {
    const profile = profiles.find(x => x.id === promptProfile);
    const type = contentTypes.find(x => x.id === promptType);
    const masterPrompt = profile?.master_prompt || profile?.masterPrompt || "";
    const schema = type?.schema || {};
    return [
      "Create an importable n8n workflow JSON for Auto-Media.",
      "",
      "Goal: generate content for one selected Auto-Media profile and return the normalized callback payload.",
      "Profile: " + (profile?.name || "selected profile"),
      "Language: " + (profile?.language || "English"),
      "Tone: " + (profile?.tone || ""),
      "Audience: " + (profile?.audience || ""),
      "",
      "MASTER PROMPT:",
      masterPrompt,
      "",
      "CONTENT TYPE: " + (type?.name || "selected content type"),
      "GENERATION MODE: " + (type?.generation_mode || type?.generationMode || ""),
      "CONTENT TYPE CONFIG:",
      JSON.stringify(type?.config || {}, null, 2),
      "",
      "OUTPUT SCHEMA:",
      JSON.stringify(schema, null, 2),
      "",
      "Required workflow contract:",
      "1. Start with an HTTP POST Webhook trigger.",
      "2. Read profile, contentType, source, config, jobId, callbackUrl and callbackToken from the request.",
      "3. Use only n8n credential references; never hard-code API keys, bearer tokens, page IDs, sheet IDs or passwords.",
      "4. Generate structured content matching the supplied schema.",
      "5. Return normalized JSON to callbackUrl with jobId, callbackToken, status, content, media and source.",
      "6. The workflow must be self-contained and importable into n8n.",
      "7. Do not use Google Sheets for deduplication; Auto-Media supplies usedUrls/usedTitles in source.",
      "",
      "Return ONLY the complete n8n workflow JSON, with no markdown fences and no commentary."
    ].join("\n");
  }

  function exportWorkflow(item) {
    const blob = new Blob([JSON.stringify(item.workflow_json || {}, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = (item.name || "automedia-n8n-workflow").replace(/[^a-z0-9._-]+/gi, "-") + "-v" + (item.version || 1) + ".json";
    link.click();
    URL.revokeObjectURL(url);
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
        <div className="mb-4 rounded-xl border border-violet/20 bg-violet/5 p-4">
          <p className="label">Generate a ChatGPT workflow request</p>
          <p className="text-xs text-muted mt-1">Choose a profile and recipe, then copy the exact request into ChatGPT.</p>
          <div className="grid md:grid-cols-2 gap-2 mt-3">
            <select className="input text-xs" value={promptProfile} onChange={e=>setPromptProfile(e.target.value)}><option value="">Select profile</option>{profiles.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select className="input text-xs" value={promptType} onChange={e=>setPromptType(e.target.value)}><option value="">Select content type</option>{contentTypes.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </div>
          <button className="btn-ghost text-xs mt-3" disabled={!promptProfile || !promptType} onClick={async()=>{try{await navigator.clipboard.writeText(buildChatGptPrompt());toast.success("ChatGPT workflow request copied.");}catch{toast.error("Could not copy the prompt.");}}}>Copy ChatGPT request</button>
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
          <p className="text-xs text-muted mt-3">{status?.message || "Checking n8n…"}</p><p className="text-[10px] font-mono text-muted mt-2">Public API: {deployment?.configured ? "configured" : "not configured"}</p>
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
          <button className="btn-ghost text-xs" onClick={()=>duplicate(selected)}>Duplicate</button><button className="btn-ghost text-xs" onClick={()=>exportWorkflow(selected)}>Export JSON</button>{deployment?.configured && <><button className="btn-primary text-xs" disabled={deploying} onClick={()=>deploy(selected)}>{deploying ? "Deploying…" : selected.n8n_workflow_id ? "Update n8n" : "Deploy to n8n"}</button>{selected.n8n_workflow_id && <><button className="btn-ghost text-xs" disabled={deploying} onClick={()=>activateInstance(selected)}>Activate in n8n</button><button className="btn-ghost text-xs" disabled={deploying} onClick={()=>deactivateInstance(selected)}>Deactivate in n8n</button></>}</>}
          <button className="btn-ghost text-xs" disabled={testing} onClick={()=>test(selected)}>{testing ? "Testing…" : "Test webhook"}</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 mt-6">
        {[["Nodes", selected.validation?.nodeCount || 0],["Triggers", selected.validation?.triggerNodes?.length || 0],["AI nodes", selected.validation?.aiNodes?.length || 0],["HTTP nodes", selected.validation?.httpNodes?.length || 0]].map(([label,value])=><div key={label} className="rounded-xl border border-border p-4"><p className="label">{label}</p><p className="font-display text-2xl font-semibold mt-1">{value}</p></div>)}
      </div>
      {selected.validationErrors?.length > 0 && <div className="mt-5 rounded-xl border border-rose/30 bg-rose/5 p-4"><p className="label text-rose">Validation errors</p><pre className="text-xs text-rose whitespace-pre-wrap mt-2">{selected.validationErrors.join(String.fromCharCode(10))}</pre></div>}
      {selected.validationWarnings?.length > 0 && <div className="mt-5 rounded-xl border border-amber/30 bg-amber/5 p-4"><p className="label">Warnings</p><pre className="text-xs text-muted whitespace-pre-wrap mt-2">{selected.validationWarnings.join(String.fromCharCode(10))}</pre></div>}
      <div className="mt-5 rounded-xl border border-border p-4">
        <p className="label">Auto-Media credential mappings</p>
        <p className="text-xs text-muted mt-1">Maps n8n credential labels to encrypted Auto-Media credential references. Secret values are never sent in this mapping.</p>
        {credentialNames.length === 0 ? <p className="text-xs text-muted mt-3">No credential requirements were detected in this workflow.</p> :
          <div className="grid md:grid-cols-2 gap-3 mt-4">{credentialNames.map(name => <label key={name}><span className="label">{name}</span><input list="studio-credentials" className="input font-mono text-xs" value={credentialMap[name] || ""} onChange={e=>setCredentialMap({...credentialMap,[name]:e.target.value})} placeholder="credential-name" /></label>)}<datalist id="studio-credentials">{studioCredentials.map(x=><option key={x.id} value={x.name}/>)}</datalist></div>}
        <button className="btn-ghost text-xs mt-4" disabled={!selected} onClick={async()=>{try{const r=await mapN8nWorkflowCredentials(selected.id,credentialMap);setSelected({...selected,...r.workflow});toast.success("Credential references saved.");}catch(error){toast.error(error.message||"Could not save credential mapping.");}}}>Save mappings</button>
      </div>
      <div className="grid md:grid-cols-2 gap-5 mt-5">
        <div><p className="label mb-2">Webhook paths</p><pre className="text-[11px] bg-black/20 border border-border rounded-xl p-3 overflow-auto">{JSON.stringify(selected.validation?.webhookPaths || [], null, 2)}</pre></div>
        <div><p className="label mb-2">Credential requirements</p><pre className="text-[11px] bg-black/20 border border-border rounded-xl p-3 overflow-auto">{JSON.stringify(selected.validation?.credentialRequirements || [], null, 2)}</pre></div>
      </div>
      {selected.lastTest && <div className="mt-5"><p className="label mb-2">Last test</p><pre className="text-[11px] bg-black/20 border border-border rounded-xl p-3 overflow-auto">{JSON.stringify(selected.lastTest,null,2)}</pre></div>}
    </section>}
  </div>;
}
