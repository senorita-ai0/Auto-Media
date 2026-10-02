import { databaseConfigured, databaseHealth } from "./db.mjs";
import { storageMode } from "./storage.mjs";

function has(value) {
  return Boolean(String(value || "").trim());
}

export async function runtimeReadiness() {
  const db = await databaseHealth();
  const n8nEnabled = String(process.env.N8N_ENABLED || "false").toLowerCase() === "true";
  const storage = storageMode();

  const checks = {
    database: db.configured && db.connected,
    credentialsKey: has(process.env.CREDENTIALS_MASTER_KEY),
    storage: storage === "local" || (
      has(process.env.S3_BUCKET) &&
      has(process.env.S3_REGION) &&
      has(process.env.S3_ACCESS_KEY_ID) &&
      has(process.env.S3_SECRET_ACCESS_KEY)
    ),
    n8n: !n8nEnabled || (has(process.env.N8N_BASE_URL) && has(process.env.N8N_SHARED_SECRET)),
    publicBase: !String(process.env.PUBLIC_BASE_URL || "").includes("localhost") || String(process.env.STUDIO_AUTH_REQUIRED || "false").toLowerCase() !== "true"
  };

  const ready = Object.values(checks).every(Boolean) && (databaseConfigured() ? db.connected : false);
  return {
    ready,
    checks,
    storageMode: storage,
    database: db,
    version: process.env.npm_package_version || "unknown",
    node: process.version,
    uptimeSeconds: Math.floor(process.uptime())
  };
}

export function runtimeLiveness() {
  return {
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    node: process.version
  };
}
