import { query, withAdvisoryLock } from "./db.mjs";
import { publishPublishingJob } from "./studioPublishing.mjs";
import { notifyAlert } from "./alerts.mjs";

let timer = null;
let running = false;
let lastTick = null;

export async function tickPublishingScheduler() {
  if (running) return;
  running = true;
  lastTick = new Date().toISOString();
  try {
    const lock = await withAdvisoryLock("automedia:publishing-worker", async () => {
      const result = await query(
        "SELECT id FROM publishing_jobs WHERE status IN ('queued','scheduled','retry_wait') AND (scheduled_at IS NULL OR scheduled_at<=now()) AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY scheduled_at NULLS FIRST, id LIMIT 20"
      );
      for (const row of result.rows) {
        try {
          const result = await publishPublishingJob(row.id);
          if (result?.status === "published" || result?.status === "failed") {
            const parent = await query("SELECT content_item_id FROM publishing_jobs WHERE id=$1", [row.id]);
            const contentId = parent.rows[0]?.content_item_id;
            if (contentId) {
              const summary = await query("SELECT COUNT(*) FILTER (WHERE status='published')::int AS published, COUNT(*) FILTER (WHERE status='failed')::int AS failed, COUNT(*)::int AS total FROM publishing_jobs WHERE content_item_id=$1", [contentId]);
              const stats = summary.rows[0] || {};
              const nextStatus = Number(stats.failed || 0) === Number(stats.total || 0) ? "failed" : Number(stats.failed || 0) > 0 ? "partially_published" : Number(stats.published || 0) === Number(stats.total || 0) ? "published" : "scheduled";
              await query("UPDATE content_items SET status=$2,updated_at=now() WHERE id=$1", [contentId, nextStatus]);
            }
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
