import { query, withAdvisoryLock } from './db.mjs';

let timer = null;
let processing = false;
let lastRunAt = null;
let lastResult = null;

function retentionDays(envName, fallback, minimum) {
  const value = Number(process.env[envName] || fallback);
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

export function getRetentionConfig() {
  return {
    metricDays: retentionDays('RETENTION_METRICS_DAYS', 180, 7),
    executionDays: retentionDays('RETENTION_EXECUTIONS_DAYS', 180, 7),
    jobDays: retentionDays('RETENTION_JOBS_DAYS', 365, 7),
    auditDays: retentionDays('RETENTION_AUDIT_DAYS', 730, 30),
    invitationDays: retentionDays('RETENTION_INVITATION_DAYS', 30, 1)
  };
}

async function deleteCount(sql, params) {
  const result = params ? await query(sql, params) : await query(sql);
  return result.rowCount || 0;
}

export async function runMaintenance() {
  if (processing) return { skipped: true, reason: 'Maintenance is already running.' };
  processing = true;
  const started = new Date().toISOString();
  const config = getRetentionConfig();
  try {
    const lock = await withAdvisoryLock("automedia:maintenance-worker", async () => {
      const deleted = {
      accountMetricSnapshots: await deleteCount('DELETE FROM account_metric_snapshots WHERE metric_date < CURRENT_DATE - $1::int', [config.metricDays]),
      publishingMetricSnapshots: await deleteCount('DELETE FROM publishing_metric_snapshots WHERE metric_date < CURRENT_DATE - $1::int', [config.metricDays]),
      n8nExecutions: await deleteCount('DELETE FROM n8n_executions WHERE completed_at IS NOT NULL AND completed_at < now() - make_interval(days => $1::int)', [config.executionDays]),
      generationJobs: await deleteCount("DELETE FROM generation_jobs WHERE completed_at IS NOT NULL AND completed_at < now() - make_interval(days => $1::int) AND status IN ('completed','failed','cancelled','waiting')", [config.jobDays]),
      publishingJobs: await deleteCount("DELETE FROM publishing_jobs WHERE completed_at IS NOT NULL AND completed_at < now() - make_interval(days => $1::int) AND status IN ('published','failed','cancelled')", [config.jobDays]),
      auditLogs: await deleteCount('DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => $1::int)', [config.auditDays]),
      oauthStates: await deleteCount('DELETE FROM oauth_states WHERE expires_at < now()'),
      workspaceInvitations: await deleteCount("DELETE FROM workspace_invitations WHERE (expires_at < now() - make_interval(days => $1::int)) OR (accepted_at IS NOT NULL AND accepted_at < now() - make_interval(days => 30))", [config.invitationDays])
    };
    lastRunAt = started;
    lastResult = { startedAt: started, finishedAt: new Date().toISOString(), deleted, retention: config };
      return lastResult;
    });
    if (!lock.acquired) return { skipped: true, reason: "Another maintenance worker is active." };
    return lock.result;
  } finally {
    processing = false;
  }
}

export function startMaintenanceScheduler() {
  if (timer) return;
  timer = setInterval(() => runMaintenance().catch(error => console.error('[maintenance]', error.message)), 24 * 60 * 60 * 1000);
  runMaintenance().catch(error => console.error('[maintenance]', error.message));
}

export function stopMaintenanceScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getMaintenanceStatus() {
  return { running: Boolean(timer), processing, lastRunAt, lastResult, retention: getRetentionConfig() };
}
