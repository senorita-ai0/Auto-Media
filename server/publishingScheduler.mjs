import { query } from "./db.mjs";
import { publishPublishingJob } from "./studioPublishing.mjs";

let timer = null;
let running = false;
let lastTick = null;

export async function tickPublishingScheduler() {
  if (running) return;
  running = true;
  lastTick = new Date().toISOString();
  try {
    const result = await query(
      "SELECT id FROM publishing_jobs WHERE status IN ('queued','scheduled') AND (scheduled_at IS NULL OR scheduled_at<=now()) ORDER BY scheduled_at NULLS FIRST, id LIMIT 20"
    );
    for (const row of result.rows) {
      try { await publishPublishingJob(row.id); }
      catch (error) { console.error("[publishing-scheduler]", row.id, error.message); }
    }
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
