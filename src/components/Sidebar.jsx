import { NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { initials, avatarColor } from "../lib/avatar";

const studio = [
  { n: "01", to: "/setup", label: "Quick Setup", desc: "Start a new brand" },
  { n: "02", to: "/profiles", label: "Profiles", desc: "Pages & prompts" },
  { n: "03", to: "/content-types", label: "Content Types", desc: "Reusable recipes" },
  { n: "04", to: "/automations", label: "Automations", desc: "Schedules & targets" },
  { n: "05", to: "/content", label: "Content", desc: "Generated library" },
  { n: "06", to: "/media", label: "Media Library", desc: "Upload & reuse assets" },
  { n: "07", to: "/analytics", label: "Analytics", desc: "Publishing performance" },
  { n: "08", to: "/accounts", label: "Accounts", desc: "Publishing targets" },
  { n: "09", to: "/n8n", label: "n8n Workflows", desc: "Import & run" },
  { n: "10", to: "/review", label: "Review Queue", desc: "Approve & publish" },
  { n: "11", to: "/logs", label: "Audit Log", desc: "Activity & changes" },
  { n: "12", to: "/calendar", label: "Calendar", desc: "Scheduled runs" },
  { n: "13", to: "/team", label: "Team", desc: "Roles & access" },
  { n: "14", to: "/observability", label: "System Health", desc: "Live telemetry" },
  { n: "15", to: "/ai", label: "Shared AI", desc: "Provider & models" },
];

const legacy = [
  { n: "16", to: "/sheet", label: "Sheet", desc: "Connect & map" },
  { n: "17", to: "/connectors", label: "Connectors", desc: "Platform keys" },
  { n: "18", to: "/queue", label: "Queue", desc: "Validate & publish" },
  { n: "19", to: "/dashboard", label: "Dashboard", desc: "Current runner" },
  { n: "20", to: "/operations", label: "Operations", desc: "Scheduler & backup" },
  { n: "21", to: "/jobs", label: "Jobs", desc: "Retries & diagnostics" },
];

function Navigation({ items }) {
  return items.map((s) => (
    <NavLink key={s.to} to={s.to} end={s.to === "/"} className={({ isActive }) =>
      "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors " +
      (isActive ? "bg-raised border border-border" : "hover:bg-raised/60")
    }>
      {({ isActive }) => (
        <>
          <span className={"font-mono text-[11px] w-7 h-7 rounded-md flex items-center justify-center border " +
            (isActive ? "border-violet text-violet bg-violet/10" : "border-border text-muted")}>
            {s.n}
          </span>
          <span>
            <span className={"block text-sm font-medium " + (isActive ? "text-ivory" : "text-muted group-hover:text-ivory")}>{s.label}</span>
            <span className="block text-[11px] text-muted">{s.desc}</span>
          </span>
        </>
      )}
    </NavLink>
  ));
}

export default function Sidebar() {
  const { users, activeUserId, setActiveUserId, activeUser } = useApp();

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface/60 flex flex-col h-full sticky top-0">
      <div className="px-5 py-6 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-teal flex items-center justify-center">
            <span className="font-display font-bold text-ink text-sm">A</span>
          </div>
          <span className="font-display font-semibold text-lg tracking-tight">Auto-Media</span>
        </div>
        <p className="text-muted text-xs mt-1.5 font-mono">profiles → content → publish</p>
      </div>

      <nav aria-label="Primary" className="flex-1 px-3 py-5 flex flex-col gap-1 overflow-y-auto">
        <p className="label px-3 pt-1 mb-1">Content Studio</p>
        <Navigation items={studio} />
        <div className="mt-4 pt-4 border-t border-border">
          <p className="label px-3 mb-1">Existing tools</p>
          <Navigation items={legacy} />
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <NavLink to="/guides" className={({ isActive }) =>
            "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors " +
            (isActive ? "bg-raised border border-border" : "hover:bg-raised/60")
          }>
            {({ isActive }) => (
              <>
                <span className={"w-7 h-7 rounded-md flex items-center justify-center border text-sm " +
                  (isActive ? "border-violet text-violet bg-violet/10" : "border-border text-muted")}>?</span>
                <span>
                  <span className={"block text-sm font-medium " + (isActive ? "text-ivory" : "text-muted")}>Setup guides</span>
                  <span className="block text-[11px] text-muted">Per-platform how-to</span>
                </span>
              </>
            )}
          </NavLink>
        </div>
      </nav>

      <div className="px-4 py-4 border-t border-border">
        <span className="label">Active user · legacy</span>
        {users.length === 0 ? (
          <p className="text-xs text-muted">No users yet</p>
        ) : (
          <div className="flex items-center gap-2">
            {activeUser && <div className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center font-display font-semibold text-[10px]"
              style={{ background: avatarColor(activeUser.name).bg, color: avatarColor(activeUser.name).fg }}>{initials(activeUser.name)}</div>}
            <select aria-label="Select active user" className="input text-sm" value={activeUserId || ""} onChange={(e) => setActiveUserId(e.target.value)}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        {activeUser && <p className="text-[11px] text-muted mt-2 truncate pl-9">{activeUser.email}</p>}
      </div>
    </aside>
  );
}
