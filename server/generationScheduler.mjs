import { query } from "./db.mjs";
import { runNativeAutomation } from "./contentEngine.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";
import { classifyError } from "./jobs.mjs";

let timer = null;
let processing = false;
let lastTick = null;

function retryDelayMs(attempts) {
  return Math.min(30 * 60 * 1000, Math.pow(2, Math.max(0, attempts - 1)) * 30 * 1000);
}

async function claimJob(job) {
  const update = await query(
    "UPDATE generation_jobs SET status='running',started_at=now(),attempts=attempts+1,updated_at=now() WHERE id=$1 AND status IN ('queued','retry_wait') AND (scheduled_at IS NULL OR scheduled_at<=now()) AND (next_attempt_at IS NULL OR next_attempt_at<=now()) RETURNING id",
    [job.id]
  );
  return Boolean(update.rows[0]);
}

async function runJob(job) {
  const automationState = await query("SELECT enabled FROM automations WHERE id=$1", [job.automation_id]);
  if (!automationState.rows[0] || !automationState.rows[0].enabled) {
    await query("UPDATE generation_jobs SET status='cancelled',completed_at=now(),error_code='AUTOMATION_PAUSED',error_message='Automation was disabled before the generation job started.',updated_at=now() WHERE id=$1", [job.id]);
    return { cancelled: true };
  }

  const run = await query(
    "INSERT INTO automation_runs (automation_id,mode,status) VALUES ($1,$2,'running') RETURNING id",
    [job.automation_id, job.mode || "native"]
  );
  const runId = run.rows[0].id;

  try {
    const result = await runNativeAutomation(job.automation_id, { generationJobId: job.id });
    let publishResults = [];
    if (result.status === "approved") {
      const jobs = await createPublishingJobs(result.contentId);
      for (const item of jobs) publishResults.push(await publishPublishingJob(item.id));
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
    const generationStatus = result.status === "external_pending" ? "waiting" : "completed";
    await query(
      "UPDATE generation_jobs SET status=$2,completed_at=CASE WHEN $2='waiting' THEN NULL ELSE now() END,content_id=$3,automation_run_id=$4,next_attempt_at=NULL,error_code=NULL,error_message=NULL,updated_at=now(),payload_json=$5::jsonb WHERE id=$1",
      [job.id, generationStatus, result.contentId || null, runId, JSON.stringify({ result, publishResults })]
    );
    return { result, publishResults };
  } catch (error) {
    const policy = classifyError(error);
    const attempts = Number(job.attempts || 1);
    const retryable = Boolean(policy.retryable && attempts < 4);
    if (retryable) {
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
      await query(
        "UPDATE automation_runs SET status='failed',completed_at=now(),error_message=$2 WHERE id=$1",
        [runId, error.message]
      );
      await query(
        "UPDATE generation_jobs SET status='retry_wait',completed_at=NULL,next_attempt_at=$2,error_code=$3,error_message=$4,automation_run_id=$5,updated_at=now() WHERE id=$1",
        [job.id, nextAttemptAt, policy.reason, error.message, runId]
      );
      return { error: error.message, retryable: true, nextAttemptAt };
    }

    await query(
      "UPDATE automation_runs SET status='failed',completed_at=now(),error_message=$2 WHERE id=$1",
      [runId, error.message]
    );
    await query(
      "UPDATE generation_jobs SET status='failed',completed_at=now(),next_attempt_at=NULL,error_code=$2,error_message=$3,automation_run_id=$4,updated_at=now() WHERE id=$1",
      [job.id, policy.reason, error.message, runId]
    );
    return { error: error.message, retryable: false };
  }
}

export async function tickGenerationWorker() {
  if (processing) return;
  processing = true;
  lastTick = new Date().toISOString();
  try {
    const result = await query(
      "SELECT id,workspace_id,automation_id,status,mode,scheduled_at,attempts FROM generation_jobs WHERE status IN ('queued','retry_wait') AND (scheduled_at IS NULL OR scheduled_at<=now()) AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY scheduled_at NULLS FIRST,created_at LIMIT 10"
    );
    for (const job of result.rows) {
      try {
        if (await claimJob(job)) await runJob(job);
      } catch (error) {
        console.error("[generation-worker]", job.id, error.message);
      }
    }
  } finally {
    processing = false;
  }
}

export function startGenerationWorker() {
  if (timer) return;
  timer = setInterval(
    () => tickGenerationWorker().catch(error => console.error("[generation-worker]", error.message)),
    30000
  );
  tickGenerationWorker().catch(error => console.error("[generation-worker]", error.message));
}

export function stopGenerationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getGenerationWorkerStatus() {
  return { running: Boolean(timer), processing, lastTick };
}

export { runJob };
