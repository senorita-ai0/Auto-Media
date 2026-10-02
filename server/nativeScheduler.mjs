import { query } from "./db.mjs";
import { runNativeAutomation } from "./contentEngine.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";

let timer = null;
const active = new Set();
let lastTick = null;

function dueForInterval(automation, lastRun, now) {
  const minutes = Number(automation.schedule_config_json?.intervalMinutes || 360);
  if (!lastRun) return true;
  return now - new Date(lastRun).getTime() >= minutes * 60000;
}

function localClock(now, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short"
    }).formatToParts(now);
    return Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  } catch {
    return localClock(now, "UTC");
  }
}

function dueForDaily(automation, lastRun, now) {
  const config = automation.schedule_config_json || {};
  const atTime = String(config.atTime || "09:00");
  const clock = localClock(now, automation.timezone);
  const target = atTime.split(":");
  if (clock.hour !== target[0] || clock.minute !== target[1]) return false;
  if (!lastRun) return true;
  const last = localClock(new Date(lastRun), automation.timezone);
  return !(last.hour === target[0] && last.minute === target[1]);
}

function dueForWeekly(automation, lastRun, now) {
  const config = automation.schedule_config_json || {};
  const days = Array.isArray(config.days) ? config.days.map(Number) : [1];
  const atTime = String(config.atTime || "09:00");
  const clock = localClock(now, automation.timezone);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[clock.weekday];
  const [hh, mm] = atTime.split(":");
  if (!days.includes(day) || clock.hour !== hh || clock.minute !== mm) return false;
  if (!lastRun) return true;
  const lastClock = localClock(new Date(lastRun), automation.timezone);
  return !(lastClock.weekday === clock.weekday && lastClock.hour === hh && lastClock.minute === mm);
}

function isDue(automation, lastRunAt, now) {
  const type = automation.schedule_type || "interval";
  if (type === "manual") return false;
  if (type === "daily") return dueForDaily(automation, lastRunAt, now);
  if (type === "weekly") return dueForWeekly(automation, lastRunAt, now);
  return dueForInterval(automation, lastRunAt, now);
}

async function lastRun(automationId) {
  const result = await query(
    "SELECT started_at FROM automation_runs WHERE automation_id = $1 ORDER BY started_at DESC LIMIT 1",
    [automationId]
  );
  return result.rows[0]?.started_at || null;
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
    await query(
      "UPDATE automation_runs SET status = $2, completed_at = now(), content_id = $3 WHERE id = $1",
      [runId, publishResults.some(x => x.status === "failed") ? "partial" : result.status === "external_pending" ? "waiting" : "completed", result.contentId || null]
    );
    return { result, publishResults };
  } catch (error) {
    await query(
      "UPDATE automation_runs SET status = 'failed', completed_at = now(), error_message = $2 WHERE id = $1",
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
    "SELECT id,schedule_type,schedule_config_json,timezone,enabled FROM automations WHERE enabled = TRUE AND schedule_type <> 'manual' ORDER BY created_at"
  );
  const now = new Date();
  for (const automation of result.rows) {
    const recent = await lastRun(automation.id);
    if (isDue(automation, recent, now)) void runOne(automation);
  }
}

export function startNativeScheduler() {
  if (timer) return;
  timer = setInterval(() => tickNativeScheduler().catch(error => console.error("[native-scheduler]", error.message)), 30000);
  tickNativeScheduler().catch(error => console.error("[native-scheduler]", error.message));
}

export function stopNativeScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getNativeSchedulerStatus() {
  return { running: Boolean(timer), activeJobs: active.size, lastTick };
}
