import { useEffect, useState } from "react";
import { getStudioObservability } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

function total(rows) {
  return (rows || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
}

function WorkerCard({ title, state, active }) {
  const running = Boolean(state?.running);
  return (
    <div className="card p-5">
      <p className="label">{title}</p>
      <div className="flex items-center justify-between mt-3">
        <span className="text-sm">{running ? "RUNNING" : "STOPPED"}</span>
        {active != null ? <span className="text-[10px] font-mono text-muted">active {active}</span> : null}
      </div>
      <p className="text-[10px] text-muted mt-3">
        Last tick: {state?.lastTick ? new Date(state.lastTick).toLocaleString() : "—"}
      </p>
    </div>
  );
}

export default function Observability() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    try {
      const result = await getStudioObservability();
      setData(result);
    } catch (error) {
      toast.error(error.message || "Could not load system health.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !data) {
    return <div className="max-w-7xl"><div className="card p-8 text-sm text-muted">Loading telemetry…</div></div>;
  }

  const blocks = [
    ["Native runs", data?.automationRuns],
    ["Generation jobs", data?.generationJobs],
    ["Publishing jobs", data?.publishingJobs],
    ["n8n executions", data?.n8nExecutions]
  ];

  const checks = Object.entries(data?.readiness?.checks || {});

  return (
    <div className="max-w-7xl">
      <header className="mb-8">
        <p className="label">Operations · observability</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">System health</h1>
        <p className="text-muted text-sm mt-1">
          {data?.workspace?.name || "Workspace"} · live job and deployment state.
        </p>
      </header>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {blocks.map(([label, rows]) => (
          <div className="card p-5" key={label}>
            <p className="label">{label}</p>
            <p className="text-3xl font-display font-semibold mt-2">{total(rows)}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(rows || []).map((row) => (
                <span key={row.status} className="text-[10px] font-mono rounded-full border border-border px-2 py-1">
                  {row.status}: {row.count}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <WorkerCard title="Native scheduler" state={data?.schedulers?.native} active={data?.schedulers?.native?.activeJobs} />
        <WorkerCard title="Generation worker" state={data?.schedulers?.generation} />
        <WorkerCard title="Publishing worker" state={data?.schedulers?.publishing} />
      </div>

      <div className="card p-5 mt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="label">DEPLOYMENT READINESS</p>
            <p className="text-xs text-muted mt-1">Configuration and infrastructure checks for this container.</p>
          </div>
          <span className={"text-[10px] font-mono " + (data?.readiness?.ready ? "text-teal" : "text-rose")}>
            {data?.readiness?.ready ? "READY" : "NOT READY"}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
          {checks.map(([name, ok]) => (
            <div className="rounded-lg border border-border p-3 text-[10px] font-mono" key={name}>
              <span className={ok ? "text-teal" : "text-rose"}>{ok ? "✓" : "✗"}</span> {name}
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <p className="label">ALERTING</p>
          <p className="text-sm mt-1">
            {data?.alerts?.configured ? "External failure webhook configured." : "No external failure webhook configured."}
          </p>
        </div>
      </div>
    </div>
  );
}
