import { query, withAdvisoryLock } from "./db.mjs";
import { syncPublishedJobMetrics } from "./postEngagement.mjs";

let timer = null;
let running = false;
let lastTick = null;

export async function tickPostEngagementScheduler() {
  if (running) return;
  running = true;
  lastTick = new Date().toISOString();
  try {
    const lock = await withAdvisoryLock("automedia:post-engagement-scheduler", async () => {
      const result = await query(
        "SELECT pj.id,pj.content_item_id,pj.social_account_id,pj.status,pj.external_post_id,pj.external_url,pj.credential_ref,sa.platform,sa.status AS account_status,c.workspace_id,c.title FROM publishing_jobs pj JOIN social_accounts sa ON sa.id=pj.social_account_id JOIN content_items c ON c.id=pj.content_item_id JOIN profiles p ON p.id=c.profile_id LEFT JOIN LATERAL (SELECT fetched_at FROM publishing_metric_snapshots pms WHERE pms.publishing_job_id=pj.id ORDER BY metric_date DESC LIMIT 1) latest ON TRUE WHERE pj.status='published' AND pj.external_post_id IS NOT NULL AND (latest.fetched_at IS NULL OR latest.fetched_at < now()-interval '6 hours') ORDER BY latest.fetched_at NULLS FIRST,pj.completed_at DESC NULLS LAST LIMIT 20",
      );
      for (const job of result.rows) {
        try { await syncPublishedJobMetrics(job); }
        catch (error) { console.error("[post-engagement-scheduler]", job.id, error.message); }
      }
      return { scanned: result.rows.length };
    });
    return lock.acquired ? lock.result : { skipped: true, reason: "Another post-engagement scheduler is active." };
  } finally {
    running = false;
  }
}

export function startPostEngagementScheduler() {
  if (timer) return;
  timer = setInterval(() => tickPostEngagementScheduler().catch(error => console.error("[post-engagement-scheduler]", error.message)), 6 * 60 * 60 * 1000);
  tickPostEngagementScheduler().catch(error => console.error("[post-engagement-scheduler]", error.message));
}

export function stopPostEngagementScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getPostEngagementSchedulerStatus() {
  return { running: Boolean(timer), processing: running, lastTick };
}
