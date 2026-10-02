import "dotenv/config";

function baseUrl(value) { return String(value || "").replace(/\/+$/, ""); }
function jsonHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.AI_API_KEY) headers.Authorization = "Bearer " + process.env.AI_API_KEY;
  return headers;
}
async function requestJson(url, body, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || response.statusText;
      throw new Error("AI request failed (" + response.status + "): " + detail);
    }
    return data;
  } finally { clearTimeout(timer); }
}
function parseJsonContent(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  throw new Error("AI returned invalid JSON.");
}
export function aiConfigured() { return Boolean(process.env.AI_BASE_URL && process.env.AI_TEXT_MODEL); }
export async function generateStructured({ system, user }) {
  if (!aiConfigured()) throw new Error("AI is not configured. Set AI_BASE_URL, AI_TEXT_MODEL and AI_API_KEY.");
  const payload = { model: process.env.AI_TEXT_MODEL, temperature: Number(process.env.AI_TEMPERATURE || 0.7), messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (process.env.AI_JSON_MODE !== "false") payload.response_format = { type: "json_object" };
  const data = await requestJson(baseUrl(process.env.AI_BASE_URL) + "/chat/completions", payload);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no text content.");
  return parseJsonContent(content);
}
export async function generateImage({ prompt }) {
  if (!process.env.AI_BASE_URL) throw new Error("AI_BASE_URL is required for image generation.");
  const payload = { model: process.env.AI_IMAGE_MODEL || process.env.AI_TEXT_MODEL || "auto", prompt, size: process.env.AI_IMAGE_SIZE || "1024x1024", n: 1, response_format: "b64_json" };
  const data = await requestJson(baseUrl(process.env.AI_IMAGE_BASE_URL || process.env.AI_BASE_URL) + "/images/generations", payload, Number(process.env.AI_IMAGE_TIMEOUT_MS || 120000));
  const first = Array.isArray(data?.data) ? data.data[0] : null;
  if (!first?.b64_json) throw new Error("AI image provider returned no base64 image.");
  return { base64: first.b64_json, revisedPrompt: first.revised_prompt || null };
}