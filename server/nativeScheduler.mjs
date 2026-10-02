import { query, withAdvisoryLock } from "./db.mjs";
import { nextAutomationRun } from "./calendar.mjs";

let timer = null;
let lastTick = null;

async function claimAndEnqueueAutomation(automation, now) {
  const next = automation.next_run_at ? new Date(automation.next_run_at) : null;
  if (next && next > now) return null;

  const dueAt = next || now;
  const scheduledNext = nextAutomationRun(automation, now);
  const dueIso = dueAt.toISOString();
  const nextIso = scheduledNext ? scheduledNext.toISOString() : null;
  const idempotencyKey = "automation:" + automation.id + ":" + dueIso;

  const result = await query(
    "WITH claimed AS (UPDATE automations SET next_run_at=$2,updated_at=now() WHERE id=$1 AND enabled=TRUE AND schedule_type <> 'manual' AND (next_run_at IS NULL OR next_run_at <= $3) RETURNING id,profile_id) " +
    "INSERT INTO generation_jobs (workspace_id,automation_id,status,mode,scheduled_at,idempotency_key,payload_json) " +
    "SELECT p.workspace_id,claimed.id,'queued','native',$4,$5,$6::jsonb FROM claimed JOIN profiles p ON p.id=claimed.profile_id " +
    "ON CONFLICT (idempotency_key) DO NOTHING RETURNING id,status,scheduled_at",
    [
      automation.id,
      nextIso,
      now.toISOString(),
      dueIso,
      idempotencyKey,
      JSON.stringify({ scheduledAt: dueIso })
    ]
  );
  return result.rows[0] || null;
}

export async function tickNativeScheduler() {
  if (lastTick && Date.now() - lastTick < 15000) return;
  lastTick = Date.now();

  const lock = await withAdvisoryLock("automedia:native-scheduler", async () => {
    const result = await query(
      "SELECT id,profile_id,schedule_type,schedule_config_json,timezone,enabled,next_run_at FROM automations WHERE enabled=TRUE AND schedule_type <> 'manual' ORDER BY created_at"
    );
    const now = new Date();

    for (const automation of result.rows) {
      try {
        const job = await claimAndEnqueueAutomation(automation, now);
        if (job) console.log("[native-scheduler] enqueued", job.id, "for", automation.id);
      } catch (error) {
        console.error("[native-scheduler:enqueue]", automation.id, error.message);
      }
    }
    return { scanned: result.rows.length };
  });
  return lock.acquired ? lock.result : { skipped: true, reason: "Another native scheduler is active." };
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
  return { running: Boolean(timer), lastTick };
}

export { claimAndEnqueueAutomation };
