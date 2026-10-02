import { useEffect, useState } from "react";
import { listStudioMembers, updateStudioMemberRole } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

export default function Team() {
  const [data, setData] = useState({ members: [], currentRole: "member", currentUserId: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setData(await listStudioMembers()); }
    catch (error) { toast.error(error.message || "Could not load workspace members."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function changeRole(member, role) {
    setBusy(member.id);
    try {
      await updateStudioMemberRole(member.id, role);
      toast.success("Member role updated.");
      await load();
    } catch (error) { toast.error(error.message || "Could not update member role."); }
    finally { setBusy(null); }
  }

  const editable = ["owner","admin"].includes(data.currentRole);

  return <div className="max-w-6xl">
    <header className="mb-8"><p className="label">Workspace · team</p><h1 className="font-display text-3xl font-semibold tracking-tight">Team access</h1><p className="text-muted text-sm mt-1">Control who can manage content, credentials, publishing targets and n8n workflows in this workspace.</p></header>
    <div className="card p-5 mb-6 flex items-center justify-between gap-4"><div><p className="label">Your role</p><p className="font-semibold mt-1">{data.currentRole}</p></div><span className="text-[10px] font-mono text-muted">{data.members.length} member(s)</span></div>
    {loading ? <div className="card p-8 text-sm text-muted">Loading team…</div> : <div className="grid gap-3">{data.members.map(member => <article key={member.id} className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div><p className="font-medium">{member.display_name || "Studio user"}</p><p className="text-xs text-muted mt-1">{member.email || "No email"}</p></div>
      <div className="flex items-center gap-3"><span className="text-[10px] font-mono text-muted">joined {member.created_at ? new Date(member.created_at).toLocaleDateString() : "—"}</span>{editable ? <select className="input text-xs w-28" disabled={busy===member.id} value={member.role} onChange={e=>changeRole(member,e.target.value)}><option value="owner">owner</option><option value="admin">admin</option><option value="editor">editor</option><option value="member">member</option></select> : <span className="text-[10px] font-mono border border-border px-2 py-1 rounded-full">{member.role}</span>}</div>
    </article>)}</div>}
    <div className="card p-5 mt-6 text-xs text-muted">Roles: owner/admin can manage accounts, credentials, team and n8n. Editors can manage profiles, content types, automations and publishing. Members are read-only.</div>
  </div>;
}
