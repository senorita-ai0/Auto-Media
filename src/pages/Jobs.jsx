import { useEffect, useState } from "react";
import { useToast } from "../context/ToastContext";
import { getJobs, clearJobs, getDiagnostics } from "../lib/serverApi";
import { listStudioPublishingJobs, runStudioPublishingJob, getPublishingSchedulerStatus } from "../lib/studioApi";

export default function Jobs(){
 const toast=useToast(); const [jobs,setJobs]=useState([]),[studioJobs,setStudioJobs]=useState([]),[busy,setBusy]=useState(false),[diag,setDiag]=useState(null),[publisher,setPublisher]=useState(null);
 async function load(){try{setJobs((await getJobs(200)).jobs||[])}catch(e){toast.error(e.message)} try{setStudioJobs((await listStudioPublishingJobs()).jobs||[]);setPublisher(await getPublishingSchedulerStatus())}catch{} }
 async function diagnostics(){try{setDiag(await getDiagnostics())}catch(e){toast.error(e.message)}}
 useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t)},[]);
 async function clear(){if(!confirm("Clear all local publishing job history?"))return;setBusy(true);try{await clearJobs();setJobs([]);toast.success("Job history cleared.")}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const badge=s=>s==="completed"?"text-teal":s==="failed"?"text-rose":s==="retry_wait"?"text-amber":"text-muted";
 return <div className="max-w-6xl">
  <header className="mb-6"><p className="label">OPERATIONS · PHASE 2</p><h1 className="font-display text-3xl font-semibold">Publishing jobs</h1><p className="text-muted text-sm mt-2">Persistent job state, attempts and retry decisions. The server owns this history.</p></header>
  <div className="card p-5 mb-4"><div className="flex justify-between items-center"><div><p className="label">SYSTEM DIAGNOSTICS</p><p className="text-xs text-muted mt-1">Verify scheduler, job store and posting engines.</p></div><button className="btn-ghost text-xs" onClick={diagnostics}>Run diagnostics</button></div>{diag&&<div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4 text-xs">{Object.entries(diag.checks||{}).map(([k,v])=><div key={k} className="rounded-lg border border-border p-2"><span className={v?"text-teal":"text-rose"}>{v?"✓":"✗"}</span> {k}</div>)}</div>}</div>
  <div className="card p-5 mb-4">
   <div className="flex items-center justify-between mb-4"><div><p className="label">STUDIO PUBLISHING QUEUE</p><p className="text-xs text-muted mt-1">Destination-specific jobs from Profiles → Automations.</p></div><button className="btn-ghost text-xs" onClick={load}>Refresh</button></div>
   <div className="grid gap-2">{studioJobs.map(j=><div key={j.id} className="rounded-xl border border-border p-4">
    <div className="flex flex-wrap justify-between gap-3"><div><b>{j.title||"Untitled"}</b><p className="text-muted text-xs mt-1">{j.platform} · {j.account_name} · {j.id}</p></div><span className={badge(j.status)+" text-xs font-semibold"}>{j.status}</span></div>
    <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px]"><span>Attempts: <b>{j.attempts||0}</b></span>{j.scheduled_at&&<span className="text-teal">Scheduled: {new Date(j.scheduled_at).toLocaleString()}</span>}{j.external_url&&<a className="text-teal" href={j.external_url} target="_blank" rel="noreferrer">view ↗</a>}{j.next_attempt_at&&<span className="text-amber">Next retry: {new Date(j.next_attempt_at).toLocaleString()}</span>}{j.error_message&&<span className="text-rose">{j.error_message}</span>}{j.status==="failed"&&<button className="btn-ghost text-xs" onClick={async()=>{try{await runStudioPublishingJob(j.id);await load();toast.success("Publishing job retried.")}catch(e){toast.error(e.message)}}}>Retry</button>}</div>
   </div>)}{!studioJobs.length&&<p className="text-sm text-muted">No Studio publishing jobs yet.</p>}</div>
  </div><div className="card p-5">
   <div className="flex justify-between items-center mb-4"><span className="label">{jobs.length} RECENT JOBS</span><button className="btn-ghost text-xs" disabled={busy} onClick={clear}>Clear history</button></div>
   <div className="grid gap-2">{jobs.map(j=><div key={j.id} className="rounded-xl border border-border p-4">
    <div className="flex flex-wrap justify-between gap-3"><div><b>{j.title||"Untitled"}</b><p className="text-muted text-xs mt-1">Sheet row {j.sheetRow} · {j.currentPlatform||"all platforms"}</p></div><span className={`text-xs font-semibold ${badge(j.status)}`}>{j.status}</span></div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs"><div>Attempts<br/><b>{j.attempt||0}/{j.maxAttempts||3}</b></div><div>Created<br/><b>{j.createdAt?new Date(j.createdAt).toLocaleString():"—"}</b></div><div>Finished<br/><b>{j.finishedAt?new Date(j.finishedAt).toLocaleString():"—"}</b></div><div>Error<br/><span className="text-rose">{j.error||"—"}</span></div></div>
   </div>)}{!jobs.length&&<p className="text-sm text-muted">No publishing jobs yet. Use Run Now or enable the scheduler.</p>}</div>
  </div>
 </div>
}
