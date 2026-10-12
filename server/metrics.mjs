// Prometheus text-format metrics for queues and content. Enabled only when METRICS_TOKEN is set.
import { query } from "./db.mjs";

function lines(name, help, rows, labelKey) {
  const out = ["# HELP " + name + " " + help, "# TYPE " + name + " gauge"];
  for (const row of rows) out.push(name + "{" + labelKey + '="' + String(row.status).replace(/"/g, "") + '"} ' + Number(row.count));
  if (!rows.length) out.push(name + " 0");
  return out;
}

export async function renderMetrics() {
  const [generation, publishing, content, oldest] = await Promise.all([
    query("SELECT status, count(*)::int AS count FROM generation_jobs GROUP BY status"),
    query("SELECT status, count(*)::int AS count FROM publishing_jobs GROUP BY status"),
    query("SELECT status, count(*)::int AS count FROM content_items GROUP BY status"),
    query("SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(scheduled_at))),0)::int AS age FROM publishing_jobs WHERE status IN ('queued','scheduled','retry_wait') AND scheduled_at IS NOT NULL AND scheduled_at <= now()")
  ]);
  const out = [
    ...lines("automedia_generation_jobs", "Generation jobs by status.", generation.rows, "status"),
    ...lines("automedia_publishing_jobs", "Publishing jobs by status.", publishing.rows, "status"),
    ...lines("automedia_content_items", "Content items by status.", content.rows, "status"),
    "# HELP automedia_publish_overdue_seconds How long the most overdue due publishing job has been waiting (0 when the queue is keeping up).",
    "# TYPE automedia_publish_overdue_seconds gauge",
    "automedia_publish_overdue_seconds " + Number(oldest.rows[0]?.age || 0),
    "# HELP automedia_process_uptime_seconds Process uptime.",
    "# TYPE automedia_process_uptime_seconds gauge",
    "automedia_process_uptime_seconds " + Math.floor(process.uptime())
  ];
  return out.join("\n") + "\n";
}

export function metricsMiddleware() {
  return async (req, res) => {
    const token = String(process.env.METRICS_TOKEN || "");
    if (!token) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Metrics are disabled." } });
    const header = String(req.headers.authorization || "");
    if (header !== "Bearer " + token) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid metrics token." } });
    try {
      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(await renderMetrics());
    } catch (error) {
      res.status(500).json({ error: { code: "METRICS_FAILED", message: error.message } });
    }
  };
}
