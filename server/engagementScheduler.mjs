import { query } from "./db.mjs";
import { syncAccountMetrics } from "./engagement.mjs";

let timer = null;
let running = false;
let lastTick = null;

export async function tickEngagementScheduler() {
  if (running) return;
  running = true;
  lastTick = new Date().toISOString();
  try {
    const result = await query(
      "SELECT sa.id,sa.name,sa.platform,sa.external_account_id,sa.status,sa.workspace_id,sa.credential_ref FROM social_accounts sa LEFT JOIN LATERAL (SELECT fetched_at FROM account_metric_snapshots ams WHERE ams.social_account_id=sa.id ORDER BY metric_date DESC LIMIT 1) s ON TRUE WHERE sa.status IN ('connected','error') AND (s.fetched_at IS NULL OR s.fetched_at < now()-interval '6 hours') ORDER BY s.fetched_at NULLS FIRST, sa.updated_at LIMIT 20"
    );
    for (const account of result.rows) {
      try { await syncAccountMetrics(account); }
      catch (error) { console.error("[engagement-scheduler]", account.id, error.message); }
    }
  } finally {
    running = false;
  }
}

export function startEngagementScheduler() {
  if (timer) return;
  timer = setInterval(() => tickEngagementScheduler().catch(error => console.error("[engagement-scheduler]", error.message)), 6 * 60 * 60 * 1000);
  tickEngagementScheduler().catch(error => console.error("[engagement-scheduler]", error.message));
}

export function stopEngagementScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getEngagementSchedulerStatus() {
  return { running: Boolean(timer), processing: running, lastTick };
}
