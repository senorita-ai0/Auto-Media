const BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:8787";

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
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
