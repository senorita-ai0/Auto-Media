import { query } from "./db.mjs";
import { syncPostMetrics } from "./postPerformance.mjs";

let timer = null;
let running = false;
let lastTick = null;

export async function tickPostPerformanceScheduler() {
  if (running) return;
  running = true;
  lastTick = new Date().toISOString();
  try {
    const result = await query(
      "SELECT pj.id,pj.external_post_id,pj.completed_at,sa.platform,sa.name AS account_name,sa.workspace_id,sa.credential_ref,sa.external_account_id,c.title,c.profile_id,p.name AS profile_name FROM publishing_jobs pj JOIN social_accounts sa ON sa.id=pj.social_account_id JOIN content_items c ON c.id=pj.content_item_id JOIN profiles p ON p.id=c.profile_id LEFT JOIN LATERAL (SELECT fetched_at FROM post_metric_snapshots s WHERE s.publishing_job_id=pj.id ORDER BY metric_date DESC LIMIT 1) latest ON TRUE WHERE pj.status='published' AND pj.external_post_id IS NOT NULL AND (latest.fetched_at IS NULL OR latest.fetched_at < now()-interval '6 hours') ORDER BY latest.fetched_at NULLS FIRST,pj.completed_at DESC NULLS LAST LIMIT 20"
    );
    for (const job of result.rows) {
      try { await syncPostMetrics(job); }
      catch (error) { console.error("[post-performance-scheduler]", job.id, error.message); }
    }
  } finally {
    running = false;
  }
}

export function startPostPerformanceScheduler() {
  if (timer) return;
  timer = setInterval(() => tickPostPerformanceScheduler().catch(error => console.error("[post-performance-scheduler]", error.message)), 6 * 60 * 60 * 1000);
  tickPostPerformanceScheduler().catch(error => console.error("[post-performance-scheduler]", error.message));
}

export function stopPostPerformanceScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getPostPerformanceSchedulerStatus() {
  return { running: Boolean(timer), processing: running, lastTick };
}
