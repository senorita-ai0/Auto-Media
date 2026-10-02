const KEY = "automedia:automation-studio:v1";
const EVENT = "automedia:automation-studio-changed";
const now = () => new Date().toISOString();
const uid = (prefix) => prefix + "_" + crypto.randomUUID();

const DEFAULT_CONTENT_TYPES = [
  { id: "ct_news_image", name: "Tech News Image", slug: "tech-news-image", category: "news", generationMode: "ai_image", description: "Recent story + original post + AI image + branding.", prompt: "", active: true, builtIn: true },
  { id: "ct_local_video", name: "Local Video", slug: "local-video", category: "video", generationMode: "local_media", description: "Select an unused local video and optionally generate its caption.", prompt: "", active: true, builtIn: true },
  { id: "ct_quote_image", name: "Quote Image", slug: "quote-image", category: "image", generationMode: "ai_image", description: "Generate a quote and a branded shareable image.", prompt: "", active: true, builtIn: true },
];

function seed() { return { version: 1, profiles: [], contentTypes: DEFAULT_CONTENT_TYPES, automations: [], updatedAt: now() }; }
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!value || typeof value !== "object") return seed();
    return { version: 1, profiles: Array.isArray(value.profiles) ? value.profiles : [], contentTypes: Array.isArray(value.contentTypes) && value.contentTypes.length ? value.contentTypes : DEFAULT_CONTENT_TYPES, automations: Array.isArray(value.automations) ? value.automations : [], updatedAt: value.updatedAt || now() };
  } catch { return seed(); }
}
function write(data) { const next = { ...data, updatedAt: now() }; localStorage.setItem(KEY, JSON.stringify(next)); window.dispatchEvent(new Event(EVENT)); return next; }
export function watchAutomationState(callback) { const emit = () => callback(read()); emit(); window.addEventListener(EVENT, emit); window.addEventListener("storage", emit); return () => { window.removeEventListener(EVENT, emit); window.removeEventListener("storage", emit); }; }
export function getAutomationState() { return read(); }
function slugify(value) { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export function createProfile(input) {
  const data = read();
  if (!input.name || !input.name.trim()) throw new Error("Profile name is required.");
  const slug = slugify(input.slug || input.name) || uid("profile");
  if (data.profiles.some((x) => x.slug === slug)) throw new Error("A profile with this name already exists.");
  const profile = { id: uid("profile"), name: input.name.trim(), slug, description: (input.description || "").trim(), niche: (input.niche || "").trim(), language: input.language || "English", timezone: input.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), tone: (input.tone || "").trim(), audience: (input.audience || "").trim(), masterPrompt: (input.masterPrompt || "").trim(), disclaimer: (input.disclaimer || "").trim(), enabled: true, createdAt: now(), updatedAt: now() };
  write({ ...data, profiles: [profile, ...data.profiles] });
  return profile;
}
export function updateProfile(id, patch) {
  const data = read(); const index = data.profiles.findIndex((x) => x.id === id);
  if (index < 0) throw new Error("Profile not found.");
  const next = { ...data.profiles[index], ...patch, updatedAt: now() };
  if (!next.name || !String(next.name).trim()) throw new Error("Profile name is required.");
  next.name = String(next.name).trim();
  if (patch.slug && data.profiles.some((x) => x.id !== id && x.slug === patch.slug)) throw new Error("Another profile already uses this slug.");
  data.profiles[index] = next; write(data); return next;
}
export function deleteProfile(id) { const data = read(); write({ ...data, profiles: data.profiles.filter((x) => x.id !== id), automations: data.automations.filter((x) => x.profileId !== id) }); }

export function createContentType(input) {
  const data = read(); if (!input.name || !input.name.trim()) throw new Error("Content type name is required.");
  const slug = slugify(input.slug || input.name) || uid("content");
  if (data.contentTypes.some((x) => x.slug === slug)) throw new Error("A content type with this name already exists.");
  const item = { id: uid("ct"), name: input.name.trim(), slug, category: input.category || "custom", generationMode: input.generationMode || "ai_text", description: (input.description || "").trim(), prompt: (input.prompt || "").trim(), active: true, builtIn: false, createdAt: now(), updatedAt: now() };
  write({ ...data, contentTypes: [item, ...data.contentTypes] }); return item;
}
export function updateContentType(id, patch) { const data = read(); const index = data.contentTypes.findIndex((x) => x.id === id); if (index < 0) throw new Error("Content type not found."); data.contentTypes[index] = { ...data.contentTypes[index], ...patch, updatedAt: now() }; write(data); return data.contentTypes[index]; }
export function deleteContentType(id) { const data = read(); const item = data.contentTypes.find((x) => x.id === id); if (item && item.builtIn) throw new Error("Built-in content types cannot be removed."); write({ ...data, contentTypes: data.contentTypes.filter((x) => x.id !== id), automations: data.automations.filter((x) => x.contentTypeId !== id) }); }

export function createAutomation(input) {
  const data = read(); const profile = data.profiles.find((x) => x.id === input.profileId); const type = data.contentTypes.find((x) => x.id === input.contentTypeId);
  if (!profile || !type) throw new Error("Select a valid profile and content type.");
  const item = { id: uid("automation"), profileId: input.profileId, contentTypeId: input.contentTypeId, name: (input.name || (profile.name + " · " + type.name)).trim(), enabled: true, scheduleType: input.scheduleType || "interval", scheduleConfig: input.scheduleConfig || { intervalMinutes: 360 }, sourceConfig: input.sourceConfig || {}, generationConfig: input.generationConfig || {}, destinations: Array.isArray(input.destinations) ? input.destinations : [], approvalMode: input.approvalMode || "review", maxItemsPerRun: Number(input.maxItemsPerRun) > 0 ? Number(input.maxItemsPerRun) : 1, timezone: input.timezone || profile.timezone || "UTC", createdAt: now(), updatedAt: now() };
  write({ ...data, automations: [item, ...data.automations] }); return item;
}
export function updateAutomation(id, patch) { const data = read(); const index = data.automations.findIndex((x) => x.id === id); if (index < 0) throw new Error("Automation not found."); data.automations[index] = { ...data.automations[index], ...patch, updatedAt: now() }; write(data); return data.automations[index]; }
export function deleteAutomation(id) { const data = read(); write({ ...data, automations: data.automations.filter((x) => x.id !== id) }); }
export function resetAutomationStudio() { write(seed()); }