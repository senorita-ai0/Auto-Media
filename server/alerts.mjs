function configured() {
  return Boolean(String(process.env.ALERT_WEBHOOK_URL || "").trim());
}

export function alertsConfigured() {
  return configured();
}

export async function notifyAlert(event, details = {}) {
  if (!configured()) return { sent: false, configured: false };
  const url = String(process.env.ALERT_WEBHOOK_URL).trim();
  const payload = {
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
