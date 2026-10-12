// Boots the real server process and verifies it actually comes up healthy.
// `node --check` only validates syntax, so it cannot catch missing imports (the exact class of bug
// that once made the server crash on startup). This test executes the entrypoint.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });
}

const port = await freePort();
const env = {
  ...process.env,
  PORT: String(port),
  CREDENTIALS_MASTER_KEY: process.env.CREDENTIALS_MASTER_KEY || "boot-smoke-test-key",
  METRICS_TOKEN: "smoke-token",
  STUDIO_AUTH_REQUIRED: "false"
};
const child = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", d => { output += d; });
child.stderr.on("data", d => { output += d; });
let exited = null;
child.on("exit", code => { exited = code; });

async function get(path, headers = {}) {
  const response = await fetch("http://127.0.0.1:" + port + path, { headers });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function waitForLive() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error("Server exited early with code " + exited + ":\n" + output);
    try { if ((await get("/api/live")).status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("Server did not become live in time:\n" + output);
}

let failed = null;
try {
  await waitForLive();
  const live = await get("/api/live");
  assert.equal(JSON.parse(live.text).ok, true);
  assert.equal(live.headers.get("x-content-type-options"), "nosniff");
  assert.equal(live.headers.get("x-powered-by"), null);

  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    const ready = await get("/api/ready");
    assert.equal(ready.status, 200, "readiness should pass with a database: " + ready.text);
    const studio = await get("/api/studio/scheduler/status");
    assert.equal(studio.status, 200);
    assert.ok(studio.headers.get("x-ratelimit-limit"), "studio routes are rate limited");

    assert.equal((await get("/api/metrics")).status, 401, "metrics require the bearer token");
    const metrics = await get("/api/metrics", { Authorization: "Bearer smoke-token" });
    assert.equal(metrics.status, 200);
    assert.match(metrics.text, /automedia_process_uptime_seconds \d+/);
  }
  console.log("Auto-Media boot smoke test passed.");
} catch (error) {
  failed = error;
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => { const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000); child.on("exit", () => { clearTimeout(t); resolve(); }); });
}
if (failed) { console.error(failed.stack || failed.message); process.exit(1); }
