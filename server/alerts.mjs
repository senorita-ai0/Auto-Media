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

export async function notifyAlert(event, details = {}) {
  if (!configured()) return { sent: false, configured: false };
  const webhook = String(process.env.ALERT_WEBHOOK_URL || "").trim();
  const slack = String(process.env.ALERT_SLACK_WEBHOOK_URL || "").trim();
  const email = String(process.env.ALERT_EMAIL_WEBHOOK_URL || "").trim();
  const url = webhook || slack || email;
  const message = details.error || details.message || ("Auto-Media emitted " + event + ".");
  const payload = slack
    ? { text: "[Auto-Media] " + event + " — " + message }
    : email
      ? { source: "Auto-Media", event, subject: "Auto-Media: " + event, message, details }
      : {
          source: "Auto-Media",
          event,
          timestamp: new Date().toISOString(),
          ...details
        };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Alert webhook returned HTTP " + response.status);
      return { sent: true, configured: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.warn("[alert]", event, error.message);
    return { sent: false, configured: true, error: error.message };
  }
}
