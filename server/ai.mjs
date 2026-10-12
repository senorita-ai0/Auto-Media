import "dotenv/config";
import { query } from "./db.mjs";
import { loadCredential } from "./credentialVault.mjs";
import { runWithFailover } from "./aiFailover.mjs";

function baseUrl(value) { return String(value || "").replace(/\/+$/, ""); }

function parseJsonContent(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  throw new Error("AI returned invalid JSON.");
}

async function requestJson(url, body, apiKey, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || response.statusText;
      throw new Error("AI request failed (" + response.status + "): " + detail);
    }
    return data;
  } finally { clearTimeout(timer); }
}

function toConfig(provider, credential) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: baseUrl(provider.base_url),
    imageBaseUrl: baseUrl(provider.image_base_url || provider.base_url),
    textModel: provider.text_model,
    imageModel: provider.image_model || provider.text_model,
    temperature: Number(provider.temperature ?? 0.7),
    jsonMode: Boolean(provider.json_mode),
    apiKey: credential?.apiKey || credential?.api_key || ""
  };
}

function legacyConfig() {
  if (!process.env.AI_BASE_URL || !process.env.AI_TEXT_MODEL) return null;
  return {
    id: "env",
    name: "Environment provider",
    baseUrl: baseUrl(process.env.AI_BASE_URL),
    imageBaseUrl: baseUrl(process.env.AI_IMAGE_BASE_URL || process.env.AI_BASE_URL),
    textModel: process.env.AI_TEXT_MODEL,
    imageModel: process.env.AI_IMAGE_MODEL || process.env.AI_TEXT_MODEL,
    temperature: Number(process.env.AI_TEMPERATURE || 0.7),
    jsonMode: process.env.AI_JSON_MODE !== "false",
    apiKey: process.env.AI_API_KEY || ""
  };
}

/**
 * Ordered failover chain: the automation's explicit provider first, then the workspace's other enabled
 * providers (oldest first), then the legacy environment provider. Providers whose credential cannot be
 * decrypted are skipped rather than failing the whole chain.
 */
export async function resolveAiChain(automation = {}, { single = false } = {}) {
  const explicitId = automation?.generation_config_json?.aiProviderId || automation?.config_json?.aiProviderId;
  const chain = [];
  if (automation?.workspace_id) {
    const result = await query("SELECT * FROM ai_providers WHERE workspace_id=$1 AND enabled=true ORDER BY (id::text = $2::text) DESC, created_at", [automation.workspace_id, explicitId ? String(explicitId) : ""]);
    for (const provider of result.rows) {
      try { chain.push(toConfig(provider, await loadCredential(provider.workspace_id, provider.credential_ref))); } catch { /* skip unusable provider */ }
    }
  }
  const legacy = legacyConfig();
  if (legacy) chain.push(legacy);
  if (!chain.length) throw new Error("No AI provider is configured for this workspace. Add one in AI Providers or set legacy AI_BASE_URL and AI_TEXT_MODEL.");
  return single ? chain.slice(0, 1) : chain;
}

export async function resolveAiConfig(automation = {}) {
  return (await resolveAiChain(automation, { single: true }))[0];
}

const failoverOptions = () => ({
  retries: Math.max(0, Number(process.env.AI_RETRIES ?? 1)),
  baseMs: Number(process.env.AI_RETRY_BASE_MS ?? 500)
});

export function aiConfigured() {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_TEXT_MODEL);
}

export async function generateStructured({ system, user, automation = null, config = {} }) {
  const chain = await resolveAiChain(automation, { single: Boolean(config.noFailover) });
  const { value } = await runWithFailover(chain, async ai => {
    const payload = {
      model: String(config.aiTextModel || ai.textModel),
      temperature: Number(config.aiTemperature ?? ai.temperature),
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    };
    if (ai.jsonMode) payload.response_format = { type: "json_object" };
    const data = await requestJson(baseUrl(ai.baseUrl) + "/chat/completions", payload, ai.apiKey, Number(process.env.AI_TEXT_TIMEOUT_MS || 120000));
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI returned no text content.");
    return parseJsonContent(content);
  }, failoverOptions());
  return value;
}

export async function generateImage({ prompt, automation = null, config = {} }) {
  const chain = await resolveAiChain(automation, { single: Boolean(config.noFailover) });
  const { value } = await runWithFailover(chain, async ai => {
    const payload = {
      model: String(config.aiImageModel || ai.imageModel),
      prompt,
      size: String(config.aiImageSize || "1024x1024"),
      n: 1,
      response_format: "b64_json"
    };
    const data = await requestJson(baseUrl(ai.imageBaseUrl) + "/images/generations", payload, ai.apiKey, Number(process.env.AI_IMAGE_TIMEOUT_MS || 120000));
    const first = Array.isArray(data?.data) ? data.data[0] : null;
    if (!first?.b64_json) throw new Error("AI image provider returned no base64 image.");
    return { base64: first.b64_json, revisedPrompt: first.revised_prompt || null };
  }, failoverOptions());
  return value;
}
