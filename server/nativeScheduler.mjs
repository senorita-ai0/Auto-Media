import { query } from "./db.mjs";
import { runNativeAutomation } from "./contentEngine.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";
import { nextAutomationRun } from "./calendar.mjs";

let timer = null;
const active = new Set();
let lastTick = null;

async function scheduleNext(automation, from = new Date()) {
  const next = nextAutomationRun(automation, from);
  await query(
    "UPDATE automations SET next_run_at=$2, updated_at=now() WHERE id=$1",
    [automation.id, next ? next.toISOString() : null]
  );
  return next;
}

async function claimDueAutomation(automation, now) {
  const next = automation.next_run_at ? new Date(automation.next_run_at) : null;
  if (next && next > now) return false;

  const scheduledNext = nextAutomationRun(automation, now);
  const update = await query(
    "UPDATE automations SET next_run_at=$2, updated_at=now() WHERE id=$1 AND enabled=TRUE AND schedule_type <> 'manual' AND (next_run_at IS NULL OR next_run_at <= $3) RETURNING id",
    [automation.id, scheduledNext ? scheduledNext.toISOString() : null, now.toISOString()]
  );
  return Boolean(update.rows[0]);
}

async function runOne(automation) {
  if (active.has(automation.id)) return;
  active.add(automation.id);
  const run = await query(
    "INSERT INTO automation_runs (automation_id, mode, status) VALUES ($1,'native','running') RETURNING id",
    [automation.id]
  );
  const runId = run.rows[0].id;

  try {
    const result = await runNativeAutomation(automation.id);
    let publishResults = [];
    if (result.status === "approved") {
      const jobs = await createPublishingJobs(result.contentId);
      for (const job of jobs) publishResults.push(await publishPublishingJob(job.id));
    }
    const runStatus = publishResults.some(x => x.status === "failed")
      ? "partial"
      : result.status === "external_pending"
        ? "waiting"
        : "completed";
    await query(
      "UPDATE automation_runs SET status=$2,completed_at=now(),content_id=$3 WHERE id=$1",
      [runId, runStatus, result.contentId || null]
    );
    return { result, publishResults };
  } catch (error) {
    await query(
      "UPDATE automation_runs SET status='failed',completed_at=now(),error_message=$2 WHERE id=$1",
      [runId, error.message]
    );
    console.error("[native-scheduler]", automation.id, error.message);
    return { error: error.message };
  } finally {
    active.delete(automation.id);
  }
}

export async function tickNativeScheduler() {
  if (lastTick && Date.now() - lastTick < 15000) return;
  lastTick = Date.now();

  const result = await query(
    "SELECT id,schedule_type,schedule_config_json,timezone,enabled,next_run_at FROM automations WHERE enabled=TRUE AND schedule_type <> 'manual' ORDER BY created_at"
  );
  const now = new Date();

  for (const automation of result.rows) {
    try {
      if (await claimDueAutomation(automation, now)) void runOne(automation);
    } catch (error) {
      console.error("[native-scheduler:claim]", automation.id, error.message);
    }
  }
}

export function startNativeScheduler() {
  if (timer) return;
  timer = setInterval(
    () => tickNativeScheduler().catch(error => console.error("[native-scheduler]", error.message)),
    30000
  );
  tickNativeScheduler().catch(error => console.error("[native-scheduler]", error.message));
}

export function stopNativeScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getNativeSchedulerStatus() {
  return { running: Boolean(timer), activeJobs: active.size, lastTick };
}

export { scheduleNext };
