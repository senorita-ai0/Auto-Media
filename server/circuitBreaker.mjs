// Per-account circuit breaker. When an account keeps failing, stop hammering the provider (which can get the
// account rate-limited or flagged) and tell a human. The account moves to status "error"; re-testing or
// reconnecting it in Accounts closes the circuit again.
import { query } from "./db.mjs";
import { notifyAlert } from "./alerts.mjs";

export function breakerThreshold() {
  const n = Math.floor(Number(process.env.ACCOUNT_BREAKER_THRESHOLD ?? 5));
  return Number.isFinite(n) && n >= 1 ? n : 5;
}

/**
 * @param {Array<{status:string,error_code?:string|null}>} recent newest first
 * Counts consecutive final failures; a publish ends the streak, "already disconnected" failures are ignored.
 */
export function consecutiveFailures(recent) {
  let streak = 0;
  for (const job of recent) {
    if (job.status === "published") break;
    if (job.status !== "failed") continue;
    if (job.error_code === "ACCOUNT_DISCONNECTED") continue;
    streak += 1;
  }
  return streak;
}

export function shouldTrip(recent, threshold = breakerThreshold()) {
  return consecutiveFailures(recent) >= threshold;
}

/** Called after a job fails for good. Returns true if the circuit was opened by this call. */
export async function recordFailureAndMaybeTrip(accountId, { threshold = breakerThreshold() } = {}) {
  const rows = await query(
    "SELECT pj.status, pj.error_code FROM publishing_jobs pj WHERE pj.social_account_id=$1 AND pj.status IN ('published','failed') ORDER BY COALESCE(pj.completed_at, pj.started_at, pj.scheduled_at) DESC NULLS LAST LIMIT $2",
    [accountId, threshold + 5]
  );
  if (!shouldTrip(rows.rows, threshold)) return false;
  const updated = await query(
    "UPDATE social_accounts SET status='error', updated_at=now() WHERE id=$1 AND status='connected' RETURNING workspace_id, platform, name",
    [accountId]
  );
  if (!updated.rows[0]) return false;
  const account = updated.rows[0];
  await notifyAlert("account.circuit_open", {
    workspaceId: account.workspace_id,
    platform: account.platform,
    account: account.name,
    message: "Publishing to " + account.name + " paused after " + threshold + " consecutive failures. Re-test or reconnect the account to resume."
  }).catch(() => {});
  return true;
}
