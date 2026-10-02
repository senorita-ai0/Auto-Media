import crypto from "node:crypto";
import { query, withAdvisoryLock } from "./db.mjs";
import { runNativeAutomation } from "./contentEngine.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";
import { classifyError } from "./jobs.mjs";
import { notifyAlert } from "./alerts.mjs";

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
  const automationState = await query(
    "SELECT a.enabled,a.max_items_per_run,ct.generation_mode FROM automations a JOIN content_types ct ON ct.id=a.content_type_id WHERE a.id=$1",
    [job.automation_id]
  );
  const automation = automationState.rows[0];
  if (!automation || !automation.enabled) {
    await query(
      "UPDATE generation_jobs SET status='cancelled',completed_at=now(),error_code='AUTOMATION_PAUSED',error_message='Automation was disabled before the generation job started.',updated_at=now() WHERE id=$1",
      [job.id]
    );
    return { cancelled: true, results: [] };
  }

  const batchLimit = automation.generation_mode === "external_workflow"
    ? 1
    : Math.min(10, Math.max(1, Number(automation.max_items_per_run || 1)));

  const run = await query(
    "INSERT INTO automation_runs (automation_id,mode,status) VALUES ($1,$2,'running') RETURNING id",
    [job.automation_id, job.mode || "native"]
  );
  const runId = run.rows[0].id;

  const results = [];
  const generationErrors = [];
  let publishResults = [];

  for (let index = 0; index < batchLimit; index++) {
    try {
      const result = await runNativeAutomation(job.automation_id, {
        generationJobId: job.id,
        batchIndex: index,
        batchLimit
      });
      results.push(result);

      if (result.status === "approved" && result.contentId) {
        const jobs = await createPublishingJobs(result.contentId);
        for (const publishJob of jobs) {
          try {
            publishResults.push(await publishPublishingJob(publishJob.id));
          } catch (error) {
            publishResults.push({ id: publishJob.id, status: "failed", error: error.message });
          }
        }
      }

      if (result.status === "external_pending") break;
    } catch (error) {
      generationErrors.push(error);
      break;
    }
  }

  if (generationErrors.length && results.length === 0) {
    const error = generationErrors[0];
    const policy = classifyError(error);
    const attempts = Number(job.attempts || 1);
    const retryable = Boolean(policy.retryable && attempts < 4);
    if (retryable) {
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
      await query("UPDATE automation_runs SET status='failed',completed_at=now(),error_message=$2 WHERE id=$1", [runId, error.message]);
      await query(
        "UPDATE generation_jobs SET status='retry_wait',completed_at=NULL,next_attempt_at=$2,error_code=$3,error_message=$4,automation_run_id=$5,updated_at=now() WHERE id=$1",
        [job.id, nextAttemptAt, policy.reason, error.message, runId]
      );
      return { error: error.message, retryable: true, nextAttemptAt, results: [] };
    }
    await query("UPDATE automation_runs SET status='failed',completed_at=now(),error_message=$2 WHERE id=$1", [runId, error.message]);
    await query(
      "UPDATE generation_jobs SET status='failed',completed_at=now(),next_attempt_at=NULL,error_code=$2,error_message=$3,automation_run_id=$4,updated_at=now() WHERE id=$1",
      [job.id, policy.reason, error.message, runId]
    );
    await notifyAlert("generation.failed", {
      jobId: job.id,
      automationId: job.automation_id,
      workspaceId: job.workspace_id,
      attempts,
      error: error.message
    });
    return { error: error.message, retryable: false, results: [] };
  }

  const first = results[0] || null;
  const partial = generationErrors.length > 0;
  const publishFailed = publishResults.some(item => item.status === "failed");
  const automationRunStatus = partial || publishFailed ? "partial" : first?.status === "external_pending" ? "waiting" : "completed";
  const generationStatus = first?.status === "external_pending" ? "waiting" : partial ? "partial" : "completed";
  const summary = {
    resultCount: results.length,
    results,
    generationErrors: generationErrors.map(error => ({ message: error.message })),
    publishResults
  };

  await query(
    "UPDATE automation_runs SET status=$2,completed_at=now(),content_id=$3 WHERE id=$1",
    [runId, automationRunStatus, first?.contentId || null]
  );
  await query(
    "UPDATE generation_jobs SET status=$2,completed_at=CASE WHEN $2='waiting' THEN NULL ELSE now() END,content_id=$3,automation_run_id=$4,next_attempt_at=NULL,error_code=$5,error_message=$6,updated_at=now(),payload_json=$7::jsonb WHERE id=$1",
    [
      job.id,
      generationStatus,
      first?.contentId || null,
      runId,
      partial ? "PARTIAL_GENERATION" : publishFailed ? "PARTIAL_PUBLISHING" : null,
      generationErrors[0]?.message || null,
      JSON.stringify(summary)
    ]
  );

  return {
    result: first,
    results,
    publishResults,
    generationErrors: generationErrors.map(error => error.message),
    partial
  };
}
export async function tickGenerationWorker() {
  if (processing) return;
  processing = true;
  lastTick = new Date().toISOString();
  try {
    const lock = await withAdvisoryLock("automedia:generation-worker", async () => {
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
      return { scanned: result.rows.length };
    });
    return lock.acquired ? lock.result : { skipped: true, reason: "Another generation worker is active." };
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
