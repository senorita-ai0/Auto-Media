import { useEffect, useState } from "react";
import { applyStudioTemplate, listAiProviders, listStudioTemplates } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

const initial={
  "future-tech":{name:"Future Tech",language:"English",timezone:"Asia/Karachi",intervalMinutes:360,rssUrls:"",masterPrompt:"",disclaimer:"",aiProviderId:""},
  "viral-videos":{name:"Viral Videos",language:"English",timezone:"Asia/Karachi",intervalMinutes:480,localFolder:"videos/viral",masterPrompt:"",aiProviderId:""}
};

export default function Setup() {
  const [templates,setTemplates]=useState([]);
  const [providers,setProviders]=useState([]);
  const [forms,setForms]=useState(initial);
  const [busy,setBusy]=useState(null);
  const toast=useToast();

  useEffect(()=>{
    Promise.all([listStudioTemplates(),listAiProviders()])
      .then(([t,p])=>{setTemplates(t.templates||[]);setProviders(p.providers||[]);})
      .catch(error=>toast.error(error.message||"Could not load setup templates."));
  },[]);

  async function apply(id){
    const form=forms[id]||{};
    setBusy(id);
    try{
      const result=await applyStudioTemplate(id,form);
      toast.success((result.profile?.name||id)+" setup created.");
    }catch(error){toast.error(error.message||"Could not apply setup template.");}
    finally{setBusy(null);}
  }

  function field(id,key,value){setForms(prev=>({...prev,[id]:{...prev[id],[key]:value}}));}

  return <div className="max-w-7xl">
    <header className="mb-8"><p className="label">Studio · bootstrap</p><h1 className="font-display text-3xl font-semibold tracking-tight">Start with a template</h1><p className="text-muted text-sm mt-1">Create a complete page profile and automation in one step. Edit everything afterward.</p></header>
    <div className="grid xl:grid-cols-2 gap-6">
      {templates.map(template=>{const f=forms[template.id]||{};return <section key={template.id} className="card p-6">
        <div className="flex items-start justify-between gap-4"><div><span className="text-[10px] font-mono px-2 py-1 rounded-full border border-violet/30 text-violet bg-violet/5">TEMPLATE</span><h2 className="font-display text-2xl font-semibold mt-3">{template.name}</h2><p className="text-sm text-muted mt-1">{template.description}</p></div><span className="text-[10px] font-mono text-muted">{template.scheduleType==="interval" ? "every "+template.intervalMinutes+"m" : template.scheduleType}</span></div>
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <label><span className="label">Profile name</span><input className="input" value={f.name||""} onChange={e=>field(template.id,"name",e.target.value)}/></label>
          <label><span className="label">Timezone</span><input className="input" value={f.timezone||"Asia/Karachi"} onChange={e=>field(template.id,"timezone",e.target.value)}/></label>
          <label className="md:col-span-2"><span className="label">Shared AI provider</span><select className="input" value={f.aiProviderId||""} onChange={e=>field(template.id,"aiProviderId",e.target.value)}><option value="">Workspace default</option>{providers.filter(p=>p.enabled).map(p=><option key={p.id} value={p.id}>{p.name} · {p.text_model}</option>)}</select></label>
          <label><span className="label">Interval minutes</span><input className="input" type="number" min="1" value={f.intervalMinutes||template.intervalMinutes||360} onChange={e=>field(template.id,"intervalMinutes",e.target.value)}/></label>
          {template.id==="future-tech" ? <label><span className="label">RSS feeds</span><input className="input" value={f.rssUrls||""} onChange={e=>field(template.id,"rssUrls",e.target.value)} placeholder="https://example.com/rss.xml"/></label> :
          <label><span className="label">Local video folder</span><input className="input" value={f.localFolder||""} onChange={e=>field(template.id,"localFolder",e.target.value)} placeholder="videos/viral"/></label>}
          <label className="md:col-span-2"><span className="label">Master prompt</span><textarea className="input min-h-28 resize-y" value={f.masterPrompt||""} onChange={e=>field(template.id,"masterPrompt",e.target.value)} placeholder="Optional: describe exactly how this brand should create content."/></label>
          {template.id==="future-tech" && <label className="md:col-span-2"><span className="label">Disclaimer</span><input className="input" value={f.disclaimer||""} onChange={e=>field(template.id,"disclaimer",e.target.value)} placeholder="Optional disclaimer added to every post."/></label>}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3"><p className="text-[10px] text-muted">Creates profile + built-in content type automation atomically.</p><button className="btn-primary text-xs" disabled={busy===template.id} onClick={()=>apply(template.id)}>{busy===template.id?"Creating…":"Create setup"}</button></div>
      </section>})}
    </div>
    {templates.length===0 && <div className="card p-8 text-sm text-muted">No setup templates are available.</div>}
  </div>;
}
