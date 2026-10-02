import { useEffect, useMemo, useState } from "react";
import { getStudioCalendar } from "../lib/studioApi";
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
const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function Calendar() {
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
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

  return <div className="max-w-7xl">
    <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div><p className="label">Content operations · calendar</p><h1 className="font-display text-3xl font-semibold tracking-tight">{monthNames[cursor.getMonth()]} {cursor.getFullYear()}</h1><p className="text-muted text-sm mt-1">Scheduled automation runs, expanded from each automation's configured timezone and schedule.</p></div>
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
            return <div key={dayKey} className={"min-h-32 p-2 border-b border-r border-border/70 " + (outside ? "bg-black/10" : "")}>
              <div className={"text-[11px] font-mono mb-2 " + (outside ? "text-muted/50" : "text-muted")}>{day.getDate()}</div>
              <div className="space-y-1.5">{items.slice(0,5).map(item=><div key={item.id} className="rounded-lg border border-violet/20 bg-violet/5 p-2" title={item.timezone + " · " + new Date(item.start).toLocaleString()}>
                <p className="text-[10px] font-medium truncate">{item.title}</p>
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
