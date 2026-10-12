import { auth } from "../firebase";

const BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:8787';

async function call(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth?.currentUser) {
    try { headers.Authorization = 'Bearer ' + await auth.currentUser.getIdToken(); } catch {}
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error ||
        `The local server didn't respond (is it running? "npm run server" starts it on port 8787).`
    );
  }
  return data;
}

export function previewSheet({ sheetUrl, tabName }) {
  return call('/api/sheet/preview', { method: 'POST', body: JSON.stringify({ sheetUrl, tabName }) });
}

export function testYoutubeConnection({ clientId, clientSecret, refreshToken }) {
  return call('/api/youtube/test', {
    method: 'POST',
    body: JSON.stringify({ clientId, clientSecret, refreshToken }),
  });
}

export function runPosting({ sheet, connectors, app, batchSize }) {
  return call('/api/run', {
    method: 'POST',
    body: JSON.stringify({ sheet, connectors, app, batchSize }),
  });
}

export function getResults(sheetUrl) {
  return call(`/api/results?sheetUrl=${encodeURIComponent(sheetUrl)}`);
}

export function getSchedulerStatus() {
  return call('/api/scheduler/status');
}

export function configureScheduler({ enabled, intervalMinutes, batchSize, userId, payload }) {
  return call('/api/scheduler/config', {
    method: 'PUT',
    body: JSON.stringify({ enabled, intervalMinutes, batchSize, userId, payload }),
  });
}

export function runSchedulerNow({ payload, batchSize }) {
  return call('/api/scheduler/run-now', {
    method: 'POST',
    body: JSON.stringify({ payload, batchSize }),
  });
}

export function clearSchedulerHistory() {
  return call('/api/scheduler/history', { method: 'DELETE' });
}

export function getJobs(limit = 100) {
  return call(`/api/jobs?limit=${encodeURIComponent(limit)}`);
}

export function clearJobs() {
  return call('/api/jobs', { method: 'DELETE' });
}

export function getDiagnostics() {
  return call('/api/diagnostics');
}
