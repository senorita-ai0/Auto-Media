// Provider failover with bounded retries, exponential backoff and jitter. Pure orchestration: the caller
// supplies the candidates and the function that talks to one of them, so this is testable without a network.

const sleepMs = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Errors worth retrying on the same provider (transient). Everything else fails over immediately. */
export function isTransientAiError(error) {
  const message = String(error?.message || error || "");
  if (error?.name === "AbortError") return true;
  const status = message.match(/\((\d{3})\)/)?.[1];
  if (status) return status === "408" || status === "429" || Number(status) >= 500;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|aborted/i.test(message);
}

export function backoffDelay(attempt, baseMs = 500, maxMs = 8000, random = Math.random) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2)); // "equal jitter"
}

/**
 * Try each candidate in order. A transient error is retried on the same candidate up to `retries` times;
 * any other error (or exhausted retries) moves to the next candidate.
 * @returns {Promise<{value:any, candidate:any, attempts:Array<{candidate:string, error:string}>}>}
 */
export async function runWithFailover(candidates, run, { retries = 1, baseMs = 500, maxMs = 8000, sleep = sleepMs, random = Math.random, label = c => String(c?.name || c?.id || "provider") } = {}) {
  if (!candidates.length) throw new Error("No AI provider is available.");
  const attempts = [];
  let lastError = null;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const value = await run(candidate);
        return { value, candidate, attempts };
      } catch (error) {
        lastError = error;
        attempts.push({ candidate: label(candidate), error: String(error?.message || error).slice(0, 300) });
        if (attempt < retries && isTransientAiError(error)) { await sleep(backoffDelay(attempt, baseMs, maxMs, random)); continue; }
        break;
      }
    }
  }
  const error = new Error("All AI providers failed. Last error: " + String(lastError?.message || lastError) + " (" + attempts.length + " attempt" + (attempts.length === 1 ? "" : "s") + ")");
  error.attempts = attempts;
  throw error;
}
