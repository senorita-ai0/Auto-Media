function configured() {
  return Boolean(
    String(process.env.ALERT_WEBHOOK_URL || "").trim() ||
    String(process.env.ALERT_SLACK_WEBHOOK_URL || "").trim() ||
    String(process.env.ALERT_EMAIL_WEBHOOK_URL || "").trim()
  );
}

export function alertsConfigured() {
  return configured();
}

export function alertConfiguration() {
  return {
    webhook: Boolean(String(process.env.ALERT_WEBHOOK_URL || "").trim()),
    slack: Boolean(String(process.env.ALERT_SLACK_WEBHOOK_URL || "").trim()),
    email: Boolean(String(process.env.ALERT_EMAIL_WEBHOOK_URL || "").trim()),
    minimumLevel: String(process.env.ALERT_MIN_LEVEL || "error").toLowerCase()
  };
}

const ALERT_LEVELS = { info: 10, warning: 20, error: 30, critical: 40 };

function eventLevel(event) {
  const value = String(event || "").toLowerCase();
  if (value.includes("critical")) return "critical";
  if (value.includes("failed") || value.includes("error")) return "error";
  if (value.includes("warning") || value.includes("retry")) return "warning";
  return "info";
}

export async function notifyAlert(event, details = {}, options = {}) {
  if (!configured()) return { sent: false, configured: false };
  const level = String(options.level || eventLevel(event)).toLowerCase();
  const minimum = String(process.env.ALERT_MIN_LEVEL || "error").toLowerCase();
  if ((ALERT_LEVELS[level] || 30) < (ALERT_LEVELS[minimum] || 30)) {
    return { sent: false, configured: true, filtered: true, level };
  }
  const targets = [
    ["webhook", String(process.env.ALERT_WEBHOOK_URL || "").trim()],
    ["slack", String(process.env.ALERT_SLACK_WEBHOOK_URL || "").trim()],
    ["email", String(process.env.ALERT_EMAIL_WEBHOOK_URL || "").trim()]
  ].filter(([, url]) => url);
  const timestamp = new Date().toISOString();
  const message = details.error || details.message || ("Auto-Media emitted " + event + ".");
  const results = [];

  for (const [kind, url] of targets) {
    try {
      const payload = kind === "slack"
        ? { text: "[Auto-Media] " + level.toUpperCase() + " · " + event + " — " + message }
        : kind === "email"
          ? { source: "Auto-Media", event, level, timestamp, subject: "Auto-Media " + level + ": " + event, message, details }
          : { source: "Auto-Media", event, level, timestamp, ...details };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Alert endpoint returned HTTP " + response.status);
        results.push({ kind, sent: true });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      console.warn("[alert]", kind, event, error.message);
      results.push({ kind, sent: false, error: error.message });
    }
  }
  return { sent: results.some(item => item.sent), configured: true, level, results };
}
