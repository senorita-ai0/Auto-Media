import { useEffect, useMemo, useState } from "react";
import { getStudioCalendar, scheduleStudioContent } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function monthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function calendarStart(date) {
  const first = monthStart(date);
  const day = first.getDay();
  return new Date(first.getFullYear(), first.getMonth(), 1 - day);
}
function calendarEnd(date) {
  const start = calendarStart(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42, 23, 59, 59);
}
function key(date) {
  return date.toISOString().slice(0, 10);
}
function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB",{timeZone:timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(date);
  return Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
}

function offsetMinutes(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US",{timeZone:timezone||"UTC",timeZoneName:"shortOffset",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(date);
  const raw = parts.find(p=>p.type==="timeZoneName")?.value || "GMT";
  const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if(!match) return 0;
  return (match[1]==="-"?-1:1)*(Number(match[2])*60+Number(match[3]||0));
}

function movedDate(event,targetDay) {
  const clock=localClock(new Date(event.start),event.timezone||"UTC");
  const offset=offsetMinutes(new Date(event.start),event.timezone||"UTC");
  return new Date(Date.UTC(targetDay.getFullYear(),targetDay.getMonth(),targetDay.getDate(),Number(clock.hour),Number(clock.minute))-offset*60000);
}

const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function Calendar() {
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(null);
  const toast = useToast();

  async function load() {
    const start = calendarStart(cursor);
    const end = calendarEnd(cursor);
    setLoading(true);
    try {
      const result = await getStudioCalendar(start.toISOString(), end.toISOString());
      setEvents(result.events || []);
    } catch (error) {
      toast.error(error.message || "Could not load calendar.");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [cursor]);

  const days = useMemo(() => {
    const start = calendarStart(cursor);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);

  const grouped = useMemo(() => {
    const map = {};
    for (const event of events) {
      (map[event.calendarDate] ||= []).push(event);
    }
    return map;
  }, [events]);

  function shift(delta) { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1)); }

  async function dropPublish(event,targetDay) {
    if(event?.kind !== "publish") return;
    try {
      const next=movedDate(event,targetDay);
      if(next<=new Date()) throw new Error("A scheduled post must remain in the future.");
      await scheduleStudioContent(event.contentId,next.toISOString());
      toast.success("Scheduled post moved to " + next.toLocaleString() + ".");
      await load();
    } catch(error) { toast.error(error.message || "Could not move scheduled post."); }
    finally { setDragging(null); }
  }

  return <div className="max-w-7xl">
    <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div><p className="label">Content operations · calendar</p><h1 className="font-display text-3xl font-semibold tracking-tight">{monthNames[cursor.getMonth()]} {cursor.getFullYear()}</h1><p className="text-muted text-sm mt-1">Automation runs and scheduled publishing jobs. Drag a publishing event to another day to reschedule it while keeping its local clock time.</p></div>
      <div className="flex gap-2"><button className="btn-ghost text-xs" onClick={()=>setCursor(new Date())}>Today</button><button className="btn-ghost text-xs" onClick={()=>shift(-1)}>←</button><button className="btn-ghost text-xs" onClick={()=>shift(1)}>→</button><button className="btn-ghost text-xs" onClick={()=>load()}>Refresh</button></div>
    </header>
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} className="px-3 py-2 text-[10px] font-mono text-muted">{d}</div>)}</div>
      {loading ? <div className="p-8 text-sm text-muted">Loading calendar…</div> :
        <div className="grid grid-cols-7">
          {days.map(day=>{
            const dayKey=key(day);
            const items=grouped[dayKey] || [];
            const outside=day.getMonth()!==cursor.getMonth();
            return <div key={dayKey} onDragOver={e=>dragging&&e.preventDefault()} onDrop={()=>dragging&&dropPublish(dragging,day)} className={"min-h-32 p-2 border-b border-r border-border/70 " + (outside ? "bg-black/10" : "") + (dragging ? " ring-1 ring-teal/20" : "")}>
              <div className={"text-[11px] font-mono mb-2 " + (outside ? "text-muted/50" : "text-muted")}>{day.getDate()}</div>
              <div className="space-y-1.5">{items.slice(0,5).map(item=><div key={item.id} draggable={item.kind==="publish"} onDragStart={()=>item.kind==="publish"&&setDragging(item)} onDragEnd={()=>setDragging(null)} className={item.kind==="publish" ? "rounded-lg border border-teal/20 bg-teal/5 p-2 cursor-grab" : "rounded-lg border border-violet/20 bg-violet/5 p-2"} title={item.timezone + " · " + new Date(item.start).toLocaleString()}>
                <p className="text-[10px] font-medium truncate">{item.kind==="publish" ? "↗ " : ""}{item.title}</p><p className="text-[9px] text-muted truncate">{item.kind==="publish" ? item.platform+" · "+item.status : "Automation"}</p>
                <p className="text-[9px] font-mono text-muted mt-0.5">{new Date(item.start).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})} · {item.profileName || "Profile"}</p>
              </div>)}</div>
              {items.length>5 && <p className="text-[9px] text-muted mt-1">+{items.length-5} more</p>}
            </div>;
          })}
        </div>}
    </div>
    <div className="grid md:grid-cols-3 gap-3 mt-4">{events.slice(0,3).map(item=><div key={item.id} className="card p-4"><p className="label">Next occurrence</p><p className="font-medium text-sm mt-2">{item.title}</p><p className="text-xs text-muted mt-1">{new Date(item.start).toLocaleString()}</p><p className="text-[10px] font-mono text-muted mt-1">{item.timezone}</p></div>)}</div>
  </div>;
}
