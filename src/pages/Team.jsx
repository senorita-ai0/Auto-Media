import { useEffect, useState } from "react";
import { listStudioMembers, updateStudioMemberRole, listStudioWorkspaces, inviteStudioMember, acceptStudioInvitation } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

export default function Team() {
  const [data, setData] = useState({ members: [], currentRole: "member", currentUserId: null });
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [members, workspaceData] = await Promise.all([listStudioMembers(), listStudioWorkspaces()]);
      setData(members);
      setWorkspaces(workspaceData.workspaces || []);
    } catch (error) { toast.error(error.message || "Could not load workspace."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const token = params.get("invite");
    if (token) {
      const selected = params.get("workspace");
      if (selected) localStorage.setItem("automedia:studioWorkspaceId", selected);
      acceptStudioInvitation(token).then(result => {
        toast.success("Workspace invitation accepted.");
        if (result.workspaceId) localStorage.setItem("automedia:studioWorkspaceId", result.workspaceId);
        window.history.replaceState({}, "", window.location.pathname + "#/team");
        load();
      }).catch(error => toast.error(error.message || "Could not accept invitation."));
    } else {
      load();
    }
  }, []);

  async function changeRole(member, role) {
    setBusy(member.id);
    try { await updateStudioMemberRole(member.id, role); toast.success("Member role updated."); await load(); }
    catch (error) { toast.error(error.message || "Could not update member role."); }
    finally { setBusy(null); }
  }

  async function createInvite(e) {
    e.preventDefault();
    setInviteBusy(true);
    try {
      const result = await inviteStudioMember(invite.email, invite.role);
      setInviteUrl(result.inviteUrl || "");
      setInviteResult(result.invitation || null);
      toast.success("Invitation link created.");
    } catch (error) { toast.error(error.message || "Could not create invitation."); }
    finally { setInviteBusy(false); }
  }

  function switchWorkspace(id) {
    localStorage.setItem("automedia:studioWorkspaceId", id);
    window.location.reload();
  }

  const editable = ["owner","admin"].includes(data.currentRole);

  return <div className="max-w-7xl">
    <header className="mb-8"><p className="label">Workspace · team</p><h1 className="font-display text-3xl font-semibold tracking-tight">Team &amp; workspaces</h1><p className="text-muted text-sm mt-1">Switch workspaces, invite collaborators, and control access without sharing platform secrets.</p></header>

    {loading ? <div className="card p-8 text-sm text-muted">Loading workspace…</div> : <>
      <section className="card p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><p className="label">Current workspace</p><p className="font-semibold mt-1">{workspaces.find(x => x.id === localStorage.getItem("automedia:studioWorkspaceId"))?.name || "Current workspace"}</p><p className="text-xs text-muted mt-1">Your role: {data.currentRole}</p></div><select className="input max-w-sm" value={localStorage.getItem("automedia:studioWorkspaceId") || workspaces[0]?.id || ""} onChange={e=>switchWorkspace(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name} · {w.role}</option>)}</select></div>
      </section>

      {editable && <section className="card p-5 mb-6">
        <p className="label">Invite collaborator</p>
        <form className="grid md:grid-cols-[1fr_160px_auto] gap-3 mt-3" onSubmit={createInvite}>
          <input className="input" type="email" required value={invite.email} onChange={e=>setInvite({...invite,email:e.target.value})} placeholder="person@example.com" />
          <select className="input" value={invite.role} onChange={e=>setInvite({...invite,role:e.target.value})}><option value="member">member</option><option value="editor">editor</option><option value="admin">admin</option></select>
          <button className="btn-primary text-xs" disabled={inviteBusy}>{inviteBusy ? "Creating…" : "Create invite"}</button>
        </form>
        {inviteUrl && <div className="mt-4 rounded-xl border border-teal/30 bg-teal/5 p-4"><p className="label">Share this invite link</p><input readOnly className="input font-mono text-[10px] mt-2" value={inviteUrl} onFocus={e=>e.target.select()} /><div className="flex gap-2 mt-3"><button className="btn-ghost text-xs" onClick={()=>navigator.clipboard?.writeText(inviteUrl).then(()=>toast.success("Invite link copied."))}>Copy link</button>{inviteResult?.expires_at&&<span className="text-[10px] font-mono text-muted">Expires {new Date(inviteResult.expires_at).toLocaleString()}</span>}</div></div>}
      </section>}

      <section>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4"><div><p className="label">Workspace members</p><p className="text-xs text-muted mt-1">{data.members.length} member(s)</p></div></div>
          <div className="grid gap-3">{data.members.map(member => <article key={member.id} className="rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div><p className="font-medium">{member.display_name || "Studio user"}</p><p className="text-xs text-muted mt-1">{member.email || "No email"}</p></div>
            <div className="flex items-center gap-3">{editable ? <select className="input text-xs w-28" disabled={busy===member.id || (member.role==="owner" && data.currentRole!=="owner")} value={member.role} onChange={e=>changeRole(member,e.target.value)}><option value="owner">owner</option><option value="admin">admin</option><option value="editor">editor</option><option value="member">member</option></select> : <span className="text-[10px] font-mono border border-border px-2 py-1 rounded-full">{member.role}</span>}</div>
          </article>)}</div>
        </div>
      </section>
      <div className="card p-5 mt-6 text-xs text-muted">Roles: owner/admin manage accounts, credentials, team and n8n. Editors manage profiles, content types, automations, review and publishing. Members are read-only.</div>
    </>}
  </div>;
}
