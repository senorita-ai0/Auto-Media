import { useEffect, useState } from "react";
import { listStudioWorkspaces, createStudioWorkspace } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

export default function WorkspaceSwitcher() {
  const [data, setData] = useState({ workspaces: [], currentWorkspace: null });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const toast = useToast();

  async function load() {
    try {
      const result = await listStudioWorkspaces();
      setData(result);
      if (!localStorage.getItem("automedia:studioWorkspaceId") && result.currentWorkspace?.id) {
        localStorage.setItem("automedia:studioWorkspaceId", result.currentWorkspace.id);
      }
    } catch {}
  }

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("automedia-workspace-changed", onChange);
    return () => window.removeEventListener("automedia-workspace-changed", onChange);
  }, []);

  function switchWorkspace(id) {
    if (!id) return;
    localStorage.setItem("automedia:studioWorkspaceId", id);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("automedia-workspace-changed"));
    window.location.reload();
  }

  async function saveWorkspace(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await createStudioWorkspace(name.trim());
      if (result.workspace?.id) localStorage.setItem("automedia:studioWorkspaceId", result.workspace.id);
      toast.success("Workspace created.");
      setCreating(false);
      setName("");
      window.location.reload();
    } catch (error) {
      toast.error(error.message || "Could not create workspace.");
    } finally {
      setBusy(false);
    }
  }

  const currentId = localStorage.getItem("automedia:studioWorkspaceId") || data.currentWorkspace?.id || "";
  const current = data.workspaces.find(x => x.id === currentId) || data.currentWorkspace;

  return <div className="px-3 pt-3">
    <div className="relative">
      <button type="button" onClick={()=>setOpen(!open)} className="w-full rounded-xl border border-border bg-raised/50 px-3 py-2.5 text-left hover:border-violet/30 transition-colors">
        <span className="label block">Workspace</span>
        <span className="flex items-center justify-between gap-2 mt-1"><span className="text-sm font-medium truncate">{current?.name || "Loading workspace…"}</span><span className="text-[10px] text-muted">{current?.role || ""} ▾</span></span>
      </button>
      {open && <div className="absolute z-50 left-0 right-0 mt-2 rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
        <div className="max-h-64 overflow-y-auto p-1">{data.workspaces.map(workspace=><button type="button" key={workspace.id} onClick={()=>switchWorkspace(workspace.id)} className={"w-full text-left rounded-lg px-3 py-2.5 " + (workspace.id===currentId ? "bg-violet/10" : "hover:bg-raised")}><span className="block text-sm">{workspace.name}</span><span className="block text-[10px] font-mono text-muted mt-0.5">{workspace.role}</span></button>)}</div>
        <div className="border-t border-border p-2">
          {!creating ? <button type="button" onClick={()=>setCreating(true)} className="btn-ghost w-full text-xs">+ New workspace</button> :
            <form onSubmit={saveWorkspace} className="space-y-2">
              <input autoFocus className="input w-full text-xs" value={name} onChange={e=>setName(e.target.value)} placeholder="Workspace name" />
              <div className="flex gap-2"><button type="submit" disabled={busy || !name.trim()} className="btn-primary flex-1 text-xs">{busy ? "Creating…" : "Create"}</button><button type="button" onClick={()=>{setCreating(false);setName("");}} className="btn-ghost text-xs">Cancel</button></div>
            </form>}
        </div>
      </div>}
    </div>
  </div>;
}
