import { useEffect,useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { watchSheetConfig } from '../lib/firestore';
import { listStudioWorkspaces } from '../lib/studioApi';
import { initials,avatarColor } from '../lib/avatar';

export default function TopBar(){
  const {activeUser,authUser,loginWithGoogle,logout,syncNow,syncing}=useApp();
  const toast=useToast();
  const [sheet,setSheet]=useState(false);
  const [workspaces,setWorkspaces]=useState([]);
  const [workspaceId,setWorkspaceId]=useState(()=>localStorage.getItem('automedia:studioWorkspaceId')||'');

  useEffect(()=>{
    if(!activeUser)return;
    return watchSheetConfig(activeUser.id,c=>setSheet(!!c));
  },[activeUser]);

  useEffect(()=>{
    let alive=true;
    listStudioWorkspaces().then(result=>{
      if(!alive)return;
      const rows=result.workspaces||[];
      setWorkspaces(rows);
      const current=result.currentWorkspace?.id||'';
      const stored=localStorage.getItem('automedia:studioWorkspaceId')||'';
      const valid=stored && rows.some(x=>x.id===stored);
      const next=valid?stored:(current||rows[0]?.id||'');
      if(next && next!==stored){
        localStorage.setItem('automedia:studioWorkspaceId',next);
        setWorkspaceId(next);
      }
      if(next) setWorkspaceId(next);
    }).catch(()=>{});
    return()=>{alive=false};
  },[authUser]);

  function switchWorkspace(id){
    if(!id || id===workspaceId)return;
    localStorage.setItem('automedia:studioWorkspaceId',id);
    setWorkspaceId(id);
    window.location.reload();
  }

  async function handleLogin(){
    try{await loginWithGoogle();toast.success('Signed in and synced with the cloud.')}
    catch(err){toast.error(err.message||'Could not sign in with Google.')}
  }
  async function handleSyncNow(){
    try{await syncNow();toast.success('Synced to the cloud.')}
    catch(err){toast.error(err.message||'Sync failed.')}
  }

  if(!activeUser) return <div className="topbar"><span className="text-muted text-sm">Create a workspace profile to begin.</span>{authUser?<button className="btn-ghost" onClick={logout}>Sign out</button>:<button className="btn-google" onClick={handleLogin}>G <span>Continue with Google</span></button>}</div>;
  const color=avatarColor(activeUser.name);
  const currentWorkspace=workspaces.find(x=>x.id===workspaceId);
  return <div className="topbar">
    <div className="hidden md:flex items-center gap-2">
      {workspaces.length>0 && <select aria-label="Active workspace" className="input text-xs max-w-[240px]" value={workspaceId||workspaces[0]?.id||''} onChange={e=>switchWorkspace(e.target.value)}>
        {workspaces.map(w=><option key={w.id} value={w.id}>{w.name} · {w.role}</option>)}
      </select>}
      <span className="status-pill">{currentWorkspace?.role||'workspace'}</span>
      <span className={`status-pill ${sheet?'ok':''}`}>{sheet?'● Sheet linked':'○ Sheet not linked'}</span>
      <span className="status-pill">{(activeUser.enabledPlatforms||[]).length} platforms</span>
    </div>
    <div className="ml-auto flex items-center gap-2">
      {authUser?<><button className="btn-ghost text-xs" disabled={syncing} onClick={handleSyncNow}>{syncing?'Syncing…':'☁ Sync now'}</button><button className="user-chip" onClick={logout} title="Sign out of Google"><img src={authUser.photoURL||''}/><span className="hidden sm:inline">{authUser.displayName||authUser.email}</span></button></>:<button className="btn-google" onClick={handleLogin}><b>G</b><span className="hidden sm:inline">Sign in & sync</span></button>}
      <div className="avatar" style={{background:color.bg,color:color.fg}}>{initials(activeUser.name)}</div>
    </div>
  </div>
}
