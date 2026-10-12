import { query, withAdvisoryLock } from "./db.mjs";
import { publishPublishingJob, syncContentPublishingStatus } from "./studioPublishing.mjs";
import { notifyAlert } from "./alerts.mjs";

let timer = null;
let running = false;
let lastTick = null;

async function recoverStalePublishingJobs() {
  const recovered = await query(
    "UPDATE publishing_jobs SET status='failed',completed_at=now(),next_attempt_at=NULL,error_code='WORKER_INTERRUPTED',error_message='The publishing worker stopped while this post was in progress. Verify the destination before retrying to avoid a duplicate post.',updated_at=now() WHERE status='publishing' AND started_at < now()-interval '45 minutes' RETURNING id,content_item_id,workspace_id",
  );
  for (const job of recovered.rows) {
    await syncContentPublishingStatus(job.content_item_id).catch(error => console.error("[publishing-recovery:content]", job.id, error.message));
    await notifyAlert("publishing.worker_interrupted", {
      jobId: job.id,
      contentId: job.content_item_id,
      workspaceId: job.workspace_id,
      error: "Publishing was interrupted; destination verification is required before retry."
    });
  }
  return recovered.rowCount || 0;
}

export async function tickPublishingScheduler() {
  if (running) return;
  running = true;
  lastTick = new Date().toISOString();
  try {
    const lock = await withAdvisoryLock("automedia:publishing-worker", async () => {
      const recovered = await recoverStalePublishingJobs();
      if (recovered) console.warn("[publishing-scheduler] marked", recovered, "interrupted job(s) for review");
      const result = await query(
        "SELECT id FROM publishing_jobs WHERE status IN ('queued','scheduled','retry_wait') AND (scheduled_at IS NULL OR scheduled_at<=now()) AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY scheduled_at NULLS FIRST, id LIMIT 20"
      );
      for (const row of result.rows) {
        try {
          const result = await publishPublishingJob(row.id);
          if (result?.status === "published" || result?.status === "failed") {
            const parent = await query("SELECT content_item_id FROM publishing_jobs WHERE id=$1", [row.id]);
            if (parent.rows[0]?.content_item_id) await syncContentPublishingStatus(parent.rows[0].content_item_id);
          }
        } catch (error) {
          await notifyAlert("publishing.worker_failed", { jobId: row.id, error: error.message });
          console.error("[publishing-scheduler]", row.id, error.message);
        }
      }
      return { scanned: result.rows.length };
    });
    return lock.acquired ? lock.result : { skipped: true, reason: "Another publishing worker is active." };
  } finally {
    running = false;
  }
}

export function startPublishingScheduler() {
  if (timer) return;
  timer = setInterval(() => tickPublishingScheduler().catch(error => console.error("[publishing-scheduler]", error.message)), 30000);
  tickPublishingScheduler().catch(error => console.error("[publishing-scheduler]", error.message));
}

export function stopPublishingScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getPublishingSchedulerStatus() {
  return { running: Boolean(timer), processing: running, lastTick };
}
