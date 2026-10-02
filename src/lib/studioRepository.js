import { getStudioHealth, listProfiles, createStudioProfile, updateStudioProfile, deleteStudioProfile, listContentTypes, createStudioContentType, updateStudioContentType, deleteStudioContentType, listAutomations, createStudioAutomation, updateStudioAutomation, deleteStudioAutomation, listStudioAccounts, createStudioAccount, updateStudioAccount, deleteStudioAccount, listN8nWorkflows } from "./studioApi";
import { createProfile as createLocalProfile, updateProfile as updateLocalProfile, deleteProfile as deleteLocalProfile, createContentType as createLocalContentType, updateContentType as updateLocalContentType, deleteContentType as deleteLocalContentType, createAutomation as createLocalAutomation, updateAutomation as updateLocalAutomation, deleteAutomation as deleteLocalAutomation, watchAutomationState, getAutomationState } from "./automationStore";

const EVENT = "automedia:studio-repository-changed";
let remoteMode = null;
const emit = () => window.dispatchEvent(new Event(EVENT));

function profileFromApi(row) {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description || "", niche: row.niche || "", language: row.language || "English", timezone: row.timezone || "UTC", tone: row.tone || "", audience: row.audience || "", masterPrompt: row.master_prompt || "", disclaimer: row.disclaimer || "", enabled: row.enabled !== false, createdAt: row.created_at, updatedAt: row.updated_at };
}
function contentTypeFromApi(row) {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description || "", category: row.category || "custom", generationMode: row.generation_mode || "ai_text", config: row.config_json || {}, schema: row.schema_json || {}, prompt: row.config_json?.prompt || "", active: row.active !== false, builtIn: Boolean(row.built_in), createdAt: row.created_at, updatedAt: row.updated_at };
}
function accountFromApi(row) { return { id: row.id, platform: row.platform, name: row.name, externalAccountId: row.external_account_id || "", credentialRef: row.credential_ref || "", metadata: row.metadata_json || {}, status: row.status || "disconnected" }; }

function automationFromApi(row) {
  return { id: row.id, profileId: row.profile_id, contentTypeId: row.content_type_id, name: row.name, enabled: row.enabled !== false, scheduleType: row.schedule_type || "interval", scheduleConfig: row.schedule_config_json || {}, sourceConfig: row.source_config_json || {}, generationConfig: row.generation_config_json || {}, approvalMode: row.approval_mode || "review", maxItemsPerRun: row.max_items_per_run || 1, timezone: row.timezone || "UTC", nextRunAt: row.next_run_at || null, profileName: row.profile_name, contentTypeName: row.content_type_name, destinations: [] };
}

export async function isStudioRemote() {
  if (remoteMode !== null) return remoteMode;
  try { remoteMode = Boolean((await getStudioHealth())?.connected); }
  catch { remoteMode = false; }
  return remoteMode;
}

export async function loadStudioState() {
  if (!(await isStudioRemote())) return getAutomationState();
  const [p, c, a, accounts, n8n] = await Promise.all([listProfiles(), listContentTypes(), listAutomations(), listStudioAccounts(), listN8nWorkflows()]);
  return {
    profiles: (p.profiles || []).map(profileFromApi),
    contentTypes: (c.contentTypes || []).map(contentTypeFromApi),
    automations: (a.automations || []).map(automationFromApi),
    accounts: (accounts.accounts || []).map(accountFromApi),
    n8nWorkflows: n8n?.workflows || [],
  };
}

export function watchStudioState(callback) {
  let stopped = false;
  let timer = null;
  const run = async () => {
    try { if (!stopped) callback(await loadStudioState()); }
    catch { if (!stopped) callback(getAutomationState()); }
  };
  run();
  const onChange = () => run();
  window.addEventListener(EVENT, onChange);
  timer = setInterval(() => { if (remoteMode) run(); }, 10000);
  const localUnwatch = watchAutomationState(() => { if (remoteMode === false) run(); });
  return () => { stopped = true; clearInterval(timer); window.removeEventListener(EVENT, onChange); localUnwatch(); };
}

export async function createAccount(input) {
  if (await isStudioRemote()) {
    const result = await createStudioAccount(input);
    emit();
    return accountFromApi(result.account);
  }
  throw new Error("Social accounts require PostgreSQL in this version.");
}
export async function updateAccount(id, patch) {
  if (await isStudioRemote()) {
    const result = await updateStudioAccount(id, patch);
    emit();
    return accountFromApi(result.account);
  }
  throw new Error("Social accounts require PostgreSQL in this version.");
}
export async function deleteAccount(id) {
  if (await isStudioRemote()) {
    await deleteStudioAccount(id);
    emit();
    return;
  }
  throw new Error("Social accounts require PostgreSQL in this version.");
}

export async function createProfile(input) { const result = await isStudioRemote() ? createStudioProfile(input).then(x => profileFromApi(x.profile)) : Promise.resolve(createLocalProfile(input)); emit(); return result; }
export async function updateProfile(id, patch) { const result = await isStudioRemote() ? updateStudioProfile(id, patch).then(x => profileFromApi(x.profile)) : Promise.resolve(updateLocalProfile(id, patch)); emit(); return result; }
export async function deleteProfile(id) { if (await isStudioRemote()) await deleteStudioProfile(id); else deleteLocalProfile(id); emit(); }

export async function createContentType(input) {
  if (await isStudioRemote()) {
    const result = await createStudioContentType({ ...input, config: { ...(input.config || {}), prompt: input.prompt || "" } });
    emit(); return contentTypeFromApi(result.contentType);
  }
  const result = createLocalContentType(input); emit(); return result;
}
export async function updateContentType(id, patch) {
  if (await isStudioRemote()) {
    const result = await updateStudioContentType(id, { ...patch, config: { ...(patch.config || {}), prompt: patch.prompt || patch.config?.prompt || "" } });
    emit(); return contentTypeFromApi(result.contentType);
  }
  const result = updateLocalContentType(id, patch); emit(); return result;
}
export async function deleteContentType(id) { if (await isStudioRemote()) await deleteStudioContentType(id); else deleteLocalContentType(id); emit(); }

export async function createAutomation(input) { const result = await isStudioRemote() ? createStudioAutomation(input).then(x => automationFromApi(x.automation)) : Promise.resolve(createLocalAutomation(input)); emit(); return result; }
export async function updateAutomation(id, patch) { const result = await isStudioRemote() ? updateStudioAutomation(id, patch).then(x => automationFromApi(x.automation)) : Promise.resolve(updateLocalAutomation(id, patch)); emit(); return result; }
export async function deleteAutomation(id) { if (await isStudioRemote()) await deleteStudioAutomation(id); else deleteLocalAutomation(id); emit(); }
