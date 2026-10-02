import { auth } from "../firebase";
const BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:8787";

async function call(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const workspaceId = localStorage.getItem("automedia:studioWorkspaceId");
  if (workspaceId) headers["X-Auto-Media-Workspace"] = workspaceId;
  if (auth?.currentUser) {
    try { headers.Authorization = "Bearer " + await auth.currentUser.getIdToken(); } catch {}
  }
  const res = await fetch(BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.error || "Studio API request failed.";
    const error = new Error(message);
    error.code = data?.error?.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

export function getStudioHealth() {
  return call("/api/studio/health");
}

export function listProfiles() {
  return call("/api/studio/profiles");
}

export function createStudioProfile(profile) {
  return call("/api/studio/profiles", { method: "POST", body: JSON.stringify(profile) });
}

export function updateStudioProfile(id, patch) {
  return call("/api/studio/profiles/" + encodeURIComponent(id), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteStudioProfile(id) {
  return call("/api/studio/profiles/" + encodeURIComponent(id), { method: "DELETE" });
}

export function listStudioAccounts() {
  return call("/api/studio/accounts");
}
export function saveStudioAccountCredential(id, payload, name) {
  return call("/api/studio/accounts/" + encodeURIComponent(id) + "/credential", { method: "POST", body: JSON.stringify({ payload, name }) });
}

export function createStudioAccount(account) {
  return call("/api/studio/accounts", { method: "POST", body: JSON.stringify(account) });
}
export function updateStudioAccount(id, patch) {
  return call("/api/studio/accounts/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
}
export function deleteStudioAccount(id) {
  return call("/api/studio/accounts/" + encodeURIComponent(id), { method: "DELETE" });
}

export function listContentTypes() {
  return call("/api/studio/content-types");
}

export function createStudioContentType(item) {
  return call("/api/studio/content-types", { method: "POST", body: JSON.stringify(item) });
}

export function runStudioAutomation(id) {
  return call("/api/studio/automations/" + encodeURIComponent(id) + "/run", { method: "POST", body: JSON.stringify({}) });
}

export function approveStudioContent(id) {
  return call("/api/studio/content/" + encodeURIComponent(id) + "/approve", { method: "POST", body: JSON.stringify({}) });
}
export function publishStudioContent(id) {
  return call("/api/studio/content/" + encodeURIComponent(id) + "/publish", { method: "POST", body: JSON.stringify({}) });
}
export function listStudioPublishingJobs() {
  return call("/api/studio/publishing-jobs");
}
export function runStudioPublishingJob(id) {
  return call("/api/studio/publishing-jobs/" + encodeURIComponent(id) + "/run", { method: "POST", body: JSON.stringify({}) });
}

export function listStudioContent(profileId) {
  const suffix = profileId ? "?profileId=" + encodeURIComponent(profileId) : "";
  return call("/api/studio/content" + suffix);
}

export function listAutomations() {
  return call("/api/studio/automations");
}

export function updateStudioContentType(id, patch) {
  return call("/api/studio/content-types/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteStudioContentType(id) {
  return call("/api/studio/content-types/" + encodeURIComponent(id), { method: "DELETE" });
}

export function updateStudioAutomation(id, patch) {
  return call("/api/studio/automations/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteStudioAutomation(id) {
  return call("/api/studio/automations/" + encodeURIComponent(id), { method: "DELETE" });
}

export function createStudioAutomation(item) {
  return call("/api/studio/automations", { method: "POST", body: JSON.stringify(item) });
}

export async function loadStudioState() {
  const [profiles, contentTypes, automations] = await Promise.all([
    listProfiles(),
    listContentTypes(),
    listAutomations(),
  ]);
  return {
    profiles: profiles.profiles || [],
    contentTypes: contentTypes.contentTypes || [],
    automations: automations.automations || [],
  };
}

export function getN8nStatus() { return call("/api/studio/n8n/status"); }
export function listN8nWorkflows() { return call("/api/studio/n8n/workflows"); }
export function getN8nWorkflow(id) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id)); }
export function importN8nWorkflow(workflow, meta = {}) { return call("/api/studio/n8n/workflows/import", { method: "POST", body: JSON.stringify({ workflow, ...meta }) }); }
export function duplicateN8nWorkflow(id, name) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/duplicate", { method: "POST", body: JSON.stringify({ name }) }); }
export function activateN8nWorkflow(id) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/activate", { method: "POST", body: JSON.stringify({}) }); }
export function deactivateN8nWorkflow(id) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/deactivate", { method: "POST", body: JSON.stringify({}) }); }
export function testN8nWorkflow(id, input = {}) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/test", { method: "POST", body: JSON.stringify({ input }) }); }
export function importLegacyConnectors(connectors) { return call("/api/studio/accounts/import-legacy", { method: "POST", body: JSON.stringify({ connectors }) }); }

export function listN8nExecutions() { return call("/api/studio/n8n/executions"); }

export function listStudioAuditLogs(limit = 200) { return call("/api/studio/audit-logs?limit=" + encodeURIComponent(limit)); }

export function getStudioCalendar(start, end) { return call("/api/studio/calendar?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end)); }

export function mapN8nWorkflowCredentials(id, mapping) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/credentials", { method: "PATCH", body: JSON.stringify({ mapping }) }); }

export function listStudioCredentials() { return call("/api/studio/credentials"); }

export function listStudioMembers() { return call("/api/studio/members"); }
export function updateStudioMemberRole(userId, role) { return call("/api/studio/members/" + encodeURIComponent(userId) + "/role", { method: "PATCH", body: JSON.stringify({ role }) }); }

export function listOAuthProviders() { return call("/api/studio/oauth/providers"); }
export function startOAuth(provider, options = {}) { return call("/api/studio/oauth/" + encodeURIComponent(provider) + "/start", { method: "POST", body: JSON.stringify(options) }); }

export function regenerateStudioContent(id) { return call("/api/studio/content/" + encodeURIComponent(id) + "/regenerate", { method: "POST", body: JSON.stringify({}) }); }

export function scheduleStudioContent(id, scheduledAt) { return call("/api/studio/content/" + encodeURIComponent(id) + "/schedule", { method: "POST", body: JSON.stringify({ scheduledAt }) }); }

export function getPublishingSchedulerStatus() { return call("/api/studio/publishing-scheduler/status"); }

export function cancelScheduledStudioContent(id) { return call("/api/studio/content/" + encodeURIComponent(id) + "/cancel-schedule", { method: "POST", body: JSON.stringify({}) }); }

export function listStudioWorkspaces() { return call("/api/studio/workspaces"); }
export function acceptStudioInvitation(token) { return call("/api/studio/invitations/" + encodeURIComponent(token) + "/accept", { method: "POST", body: JSON.stringify({}) }); }
export function inviteStudioMember(email, role) { return call("/api/studio/members/invite", { method: "POST", body: JSON.stringify({ email, role }) }); }

export function createStudioWorkspace(name) { return call("/api/studio/workspaces", { method: "POST", body: JSON.stringify({ name }) }); }

export function getStudioMetrics() { return call("/api/studio/metrics"); }

export function getStudioStorage() { return call("/api/studio/storage"); }

export function getN8nDeploymentStatus() { return call("/api/studio/n8n/deployment-status"); }
export function deployN8nWorkflow(id) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/deploy", { method: "POST", body: JSON.stringify({}) }); }
export function activateN8nWorkflowInInstance(id) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/activate-instance", { method: "POST", body: JSON.stringify({}) }); }
export function deactivateN8nWorkflowInInstance(id) { return call("/api/studio/n8n/workflows/" + encodeURIComponent(id) + "/deactivate-instance", { method: "POST", body: JSON.stringify({}) }); }

export function getStudioObservability() { return call("/api/studio/observability"); }

export function listStudioGenerationJobs() { return call("/api/studio/generation-jobs"); }

export function retryStudioGenerationJob(id) { return call("/api/studio/generation-jobs/" + encodeURIComponent(id) + "/retry", { method: "POST", body: JSON.stringify({}) }); }
export function cancelStudioGenerationJob(id) { return call("/api/studio/generation-jobs/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: JSON.stringify({}) }); }

export function testStudioAccount(id) { return call("/api/studio/accounts/" + encodeURIComponent(id) + "/test", { method: "POST", body: JSON.stringify({}) }); }

export function duplicateStudioAutomation(id, options = {}) { return call("/api/studio/automations/" + encodeURIComponent(id) + "/duplicate", { method: "POST", body: JSON.stringify(options || {}) }); }

export function listPlatformCapabilities() { return call("/api/studio/platform-capabilities"); }

export function listAiProviders() { return call("/api/studio/ai/providers"); }
export function createAiProvider(input) { return call("/api/studio/ai/providers", { method: "POST", body: JSON.stringify(input) }); }
export function updateAiProvider(id, patch) { return call("/api/studio/ai/providers/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) }); }
export function testAiProvider(id) { return call("/api/studio/ai/providers/" + encodeURIComponent(id) + "/test", { method: "POST", body: JSON.stringify({}) }); }
export function deleteAiProvider(id) { return call("/api/studio/ai/providers/" + encodeURIComponent(id), { method: "DELETE" }); }

export function listStudioTemplates() { return call("/api/studio/templates"); }
export function applyStudioTemplate(template, input) { return call("/api/studio/templates/" + encodeURIComponent(template) + "/apply", { method: "POST", body: JSON.stringify(input) }); }

export function listStudioMedia(profileId = "") {
  const suffix = profileId ? "?profileId=" + encodeURIComponent(profileId) : "";
  return call("/api/studio/media" + suffix);
}
export async function uploadStudioMedia(file, profileId = "") {
  const headers = {
    "Content-Type": file.type || "application/octet-stream",
    "X-Auto-Media-Filename": file.name || "upload"
  };
  const suffix = profileId ? "?profileId=" + encodeURIComponent(profileId) : "";
  const workspaceId = localStorage.getItem("automedia:studioWorkspaceId");
  if (workspaceId) headers["X-Auto-Media-Workspace"] = workspaceId;
  if (auth?.currentUser) headers.Authorization = "Bearer " + await auth.currentUser.getIdToken();
  const res = await fetch(BASE + "/api/studio/media/upload" + suffix, { method: "POST", headers, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.error || "Media upload failed.");
  return data;
}
export function deleteStudioMedia(id) { return call("/api/studio/media/" + encodeURIComponent(id), { method: "DELETE" }); }
