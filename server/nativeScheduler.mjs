import { query } from "./db.mjs";
import { nextAutomationRun } from "./calendar.mjs";

let timer = null;
let lastTick = null;

async function claimDueAutomation(automation, now) {
  const next = automation.next_run_at ? new Date(automation.next_run_at) : null;
  if (next && next > now) return null;

  const dueAt = next || now;
  const scheduledNext = nextAutomationRun(automation, now);
  const claim = await query(
    "UPDATE automations SET next_run_at=$2,updated_at=now() WHERE id=$1 AND enabled=TRUE AND schedule_type <> 'manual' AND (next_run_at IS NULL OR next_run_at <= $3) RETURNING id,profile_id",
    [automation.id, scheduledNext ? scheduledNext.toISOString() : null, now.toISOString()]
  );
  if (!claim.rows[0]) return null;
  return dueAt;
}

async function enqueueGenerationJob(automation, scheduledAt) {
  const idempotencyKey = "automation:" + automation.id + ":" + new Date(scheduledAt).toISOString();
  const result = await query(
    "INSERT INTO generation_jobs (workspace_id,automation_id,status,mode,scheduled_at,idempotency_key,payload_json) SELECT p.workspace_id,$1,'queued','native',$2,$3,$4::jsonb FROM profiles p WHERE p.id=$5 ON CONFLICT (idempotency_key) DO NOTHING RETURNING id,status,scheduled_at",
    [
      automation.id,
      new Date(scheduledAt).toISOString(),
      idempotencyKey,
      JSON.stringify({ scheduledAt: new Date(scheduledAt).toISOString() }),
      automation.profile_id
    ]
  );
  return result.rows[0] || null;
}

export async function tickNativeScheduler() {
  if (lastTick && Date.now() - lastTick < 15000) return;
  lastTick = Date.now();

  const result = await query(
    "SELECT id,profile_id,schedule_type,schedule_config_json,timezone,enabled,next_run_at FROM automations WHERE enabled=TRUE AND schedule_type <> 'manual' ORDER BY created_at"
  );
  const now = new Date();

  for (const automation of result.rows) {
    try {
      const dueAt = await claimDueAutomation(automation, now);
      if (dueAt) await enqueueGenerationJob(automation, dueAt);
    } catch (error) {
      console.error("[native-scheduler:enqueue]", automation.id, error.message);
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
  return { running: Boolean(timer), lastTick };
}

export { enqueueGenerationJob };
