import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getHeaderRow } from './sheets.mjs';
import { getGoogleAccessToken } from './youtube.mjs';
import { runPosting } from './run.mjs';
import { getResultsForSheet } from './results.mjs';
import { listJobs, clearJobs } from './jobs.mjs';
import { databaseConfigured, closeDatabase } from './db.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);
const runtimeDir = path.resolve('.automedia');
const schedulerFile = path.join(runtimeDir, 'scheduler.json');
let schedulerTimer = null;
let schedulerRunning = false;

const defaultScheduler = {
  enabled: false,
  intervalMinutes: 30,
  batchSize: '1',
  userId: null,
  updatedAt: null,
  lastRunAt: null,
  nextRunAt: null,
  runCount: 0,
  successCount: 0,
  failureCount: 0,
  lastResult: null,
  history: []
};

async function readScheduler() {
  await fs.mkdir(runtimeDir, { recursive: true });
  try {
    const raw = await fs.readFile(schedulerFile, 'utf8');
    return { ...defaultScheduler, ...JSON.parse(raw) };
  } catch {
    return { ...defaultScheduler };
  }
}

async function writeScheduler(state) {
  await fs.mkdir(runtimeDir, { recursive: true });
  const trimmed = {
    ...defaultScheduler,
    ...state,
    history: Array.isArray(state.history) ? state.history.slice(-100) : []
  };
  await fs.writeFile(schedulerFile, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

function nextRunFrom(nowIso, intervalMinutes) {
  return new Date(new Date(nowIso).getTime() + Number(intervalMinutes) * 60_000).toISOString();
}

async function executeScheduledRun() {
  if (schedulerRunning) return { skipped: true, reason: 'A posting run is already in progress.' };
  const state = await readScheduler();
  if (!state.enabled || !state.payload) return { skipped: true, reason: 'Scheduler is disabled.' };

  schedulerRunning = true;
  const startedAt = new Date().toISOString();
  try {
    const result = await runPosting(state.payload);
    const finishedAt = new Date().toISOString();
    const successful = (result.results || []).filter((x) => x.ok).length;
    const failed = (result.results || []).length - successful;
    const historyEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt,
      finishedAt,
      processed: result.processed || 0,
      successful,
      failed,
      results: result.results || []
    };
    const updated = await writeScheduler({
      ...state,
      lastRunAt: finishedAt,
      nextRunAt: state.enabled ? nextRunFrom(finishedAt, state.intervalMinutes) : null,
      runCount: (state.runCount || 0) + 1,
      successCount: (state.successCount || 0) + successful,
      failureCount: (state.failureCount || 0) + failed,
      lastResult: result,
      history: [...(state.history || []), historyEntry]
    });
    return { ...result, historyEntry, scheduler: updated };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const historyEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt,
      finishedAt,
      processed: 0,
      successful: 0,
      failed: 1,
      error: error.message
    };
    await writeScheduler({
      ...state,
      lastRunAt: finishedAt,
      nextRunAt: state.enabled ? nextRunFrom(finishedAt, state.intervalMinutes) : null,
      runCount: (state.runCount || 0) + 1,
      failureCount: (state.failureCount || 0) + 1,
      lastResult: { processed: 0, results: [], error: error.message },
      history: [...(state.history || []), historyEntry]
    });
    throw error;
  } finally {
    schedulerRunning = false;
  }
}

async function restartSchedulerTimer() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  const state = await readScheduler();
  if (!state.enabled) return state;
  const interval = Math.max(1, Number(state.intervalMinutes) || 30);
  schedulerTimer = setInterval(() => {
    executeScheduledRun().catch((e) => console.error('[scheduler]', e.message));
  }, interval * 60_000);
  return state;
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// New configuration-driven Content Studio routes. They are database-backed
// when DATABASE_URL is configured; the legacy posting routes remain intact.
const { studioAuthMiddleware } = await import('./studioAuth.mjs');
app.use('/api/studio', studioAuthMiddleware);
const { registerStudioRoutes } = await import('./studioRoutes.mjs');
registerStudioRoutes(app);
const { startNativeScheduler, stopNativeScheduler, getNativeSchedulerStatus } = await import("./nativeScheduler.mjs");
const { startPublishingScheduler, stopPublishingScheduler, getPublishingSchedulerStatus } = await import("./publishingScheduler.mjs");
const { startEngagementScheduler, stopEngagementScheduler } = await import("./engagementScheduler.mjs");
const { startMaintenanceScheduler, stopMaintenanceScheduler, getMaintenanceStatus } = await import("./maintenanceScheduler.mjs");
const { startPostEngagementScheduler, stopPostEngagementScheduler } = await import("./postPerformanceScheduler.mjs");
const { startGenerationWorker, stopGenerationWorker, getGenerationWorkerStatus } = await import("./generationScheduler.mjs");

const { runtimeReadiness, runtimeLiveness } = await import("./runtimeConfig.mjs");
app.get("/api/live", (_req, res) => res.status(200).json(runtimeLiveness()));
app.get("/api/ready", async (_req, res) => {
  const result = await runtimeReadiness();
  res.status(result.ready ? 200 : 503).json(result);
});
app.get('/api/health', (_req, res) => res.status(200).json(runtimeLiveness()));

// Sheet column headers, for the mapping UI on the Sheet page.
app.post('/api/sheet/preview', async (req, res) => {
  try {
    const { sheetUrl, tabName } = req.body;
    if (!sheetUrl || !tabName) return res.status(400).json({ error: 'sheetUrl and tabName are required' });
    const headers = await getHeaderRow({ sheetUrl, tabName });
    if (!headers.length) return res.status(400).json({ error: 'No headers found in row 1.' });
    res.json({ headers });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// A real connectivity check for YouTube: actually tries to refresh the
// token, rather than just checking whether the fields are non-empty.
app.post('/api/youtube/test', async (req, res) => {
  try {
    const { clientId, clientSecret, refreshToken } = req.body;
    await getGoogleAccessToken({ clientId, clientSecret, refreshToken });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// The main posting run: find ready rows, post up to `batchSize` of them
// one at a time, write status back into the sheet after each.
app.post('/api/run', async (req, res) => {
  try {
    const { sheet, connectors, app: platformApps, batchSize } = req.body;
    const result = await runPosting({ sheet, connectors, app: platformApps, batchSize });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Persistent publishing jobs: survives browser refreshes and exposes
// per-video attempt/retry state for diagnostics and recovery.
app.get('/api/jobs', async (req, res) => {
  res.json({ jobs: await listJobs(req.query.limit || 100) });
});
app.delete('/api/jobs', async (req, res) => {
  res.json(await clearJobs());
});
app.get('/api/diagnostics', async (req, res) => {
  const scheduler = await readScheduler();
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    node: process.version,
    scheduler: { enabled: scheduler.enabled, running: schedulerRunning, nextRunAt: scheduler.nextRunAt },
    runtimeDir,
    checks: {
      schedulerState: true,
      jobStore: true,
      postingEngine: true,
      sheetEngine: true,
      youtubeEngine: true
    }
  });
});

// Persistent local scheduler. The browser config is sent once; the local
// server then owns the timer, so the dashboard does not need to remain open.
app.get('/api/scheduler/status', async (req, res) => {
  res.json({ ...(await readScheduler()), running: schedulerRunning });
});

app.put('/api/scheduler/config', async (req, res) => {
  try {
    const incoming = req.body || {};
    const intervalMinutes = Math.max(1, Number(incoming.intervalMinutes || 30));
    const batchSize = incoming.batchSize === 'all' ? 'all' : String(Math.max(1, Number(incoming.batchSize || 1)));
    const enabled = Boolean(incoming.enabled);
    if (enabled && (!incoming.payload?.sheet?.sheetUrl || !incoming.payload?.sheet?.tabName)) {
      return res.status(400).json({ error: 'Connect a Google Sheet before enabling the scheduler.' });
    }
    const current = await readScheduler();
    const updated = await writeScheduler({
      ...current,
      enabled,
      intervalMinutes,
      batchSize,
      userId: incoming.userId || null,
      payload: incoming.payload || current.payload || null,
      updatedAt: new Date().toISOString(),
      nextRunAt: enabled ? nextRunFrom(new Date().toISOString(), intervalMinutes) : null
    });
    await restartSchedulerTimer();
    res.json({ ...updated, running: schedulerRunning });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/scheduler/run-now', async (req, res) => {
  try {
    const current = await readScheduler();
    const payload = req.body?.payload || current.payload;
    if (!payload?.sheet?.sheetUrl || !payload?.sheet?.tabName) {
      return res.status(400).json({ error: 'Connect a Google Sheet before running the scheduler.' });
    }
    if (schedulerRunning) return res.status(409).json({ error: 'A posting run is already in progress.' });
    const temporary = { ...current, payload, batchSize: req.body?.batchSize || current.batchSize || '1' };
    await writeScheduler(temporary);
    const result = await executeScheduledRun();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/scheduler/history', async (req, res) => {
  const current = await readScheduler();
  res.json(await writeScheduler({ ...current, history: [] }));
});

// Per-platform result history for a sheet, kept separate from the
// sheet's own single status column.
app.get('/api/results', async (req, res) => {
  try {
    const { sheetUrl } = req.query;
    if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl is required' });
    res.json({ results: await getResultsForSheet(sheetUrl) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve the built frontend too, so `npm run build && npm run server` is
// the whole app on one port with nothing else to deploy.
app.use('/media', express.static(path.resolve(process.env.MEDIA_ROOT || 'media')));
const distDir = path.resolve('dist');
app.use(express.static(distDir));
app.get('/api/studio/scheduler/status', (req, res) => res.json(getNativeSchedulerStatus()));
app.get('/api/studio/maintenance/status', (req, res) => res.json(getMaintenanceStatus()));
app.post('/api/studio/maintenance/run', async (req, res) => {
  try {
    if (databaseConfigured() !== true) return res.status(503).json({ error: { code: "DATABASE_NOT_CONFIGURED", message: "PostgreSQL is required for maintenance." } });
    const { runMaintenance } = await import("./maintenanceScheduler.mjs");
    const result = await runMaintenance();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: { code: "MAINTENANCE_FAILED", message: error.message } });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

await restartSchedulerTimer();
if (databaseConfigured()) { startNativeScheduler(); startGenerationWorker(); startPublishingScheduler(); startMaintenanceScheduler(); }

const httpServer = app.listen(port, () => {
  console.log(`Auto Media server running at http://localhost:${port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[shutdown] received", signal);
  if (schedulerTimer) clearInterval(schedulerTimer);
  stopNativeScheduler();
  stopGenerationWorker();
  stopPublishingScheduler();
  stopEngagementScheduler();
  stopPostEngagementScheduler();
  stopMaintenanceScheduler();
  await new Promise(resolve => httpServer.close(() => resolve()));
  await closeDatabase().catch(error => console.error("[shutdown] db", error.message));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));