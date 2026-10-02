import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = Math.max(1000, Number(process.env.N8N_TIMEOUT_MS || 30000));

function baseUrl() {
  return String(process.env.N8N_BASE_URL || "").replace(/\/+$/, "");
}

function webhookBase() {
  return String(process.env.N8N_WEBHOOK_BASE_URL || baseUrl()).replace(/\/+$/, "");
}

function sharedSecret() {
  return String(process.env.N8N_SHARED_SECRET || "");
}

function isConfigured() {
  return Boolean(baseUrl() && sharedSecret());
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function collectStrings(value, path = "$", out = []) {
  if (typeof value === "string") out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, i) => collectStrings(item, path + "[" + i + "]", out));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => collectStrings(item, path + "." + key, out));
  return out;
}

function secretMatches(text) {
  const value = String(text || "");
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
    /\b(?:sk|pk|rk|xapp|xox[baprs]-)[A-Za-z0-9_\-.]{16,}\b/,
    /AIza[0-9A-Za-z_-]{20,}/,
    /EA[A-Za-z0-9_-]{40,}/,
    /gh[pousr]_[A-Za-z0-9_]{30,}/,
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-.+/=]{20,}/i
  ];
}

export function scanEmbeddedSecrets(workflow) {
  const findings = [];
  for (const entry of collectStrings(workflow)) {
    if (secretMatches(entry.value).some((pattern) => pattern.test(entry.value))) {
      findings.push({
        path: entry.path,
        kind: /private key/i.test(entry.value) ? "private_key" : /Bearer/i.test(entry.value) ? "bearer_token" : "token_or_secret",
        preview: entry.value.length > 12 ? entry.value.slice(0, 6) + "…" + entry.value.slice(-4) : "[redacted]"
      });
    }
  }
  return findings.slice(0, 100);
}

function nodeSummary(node) {
  return {
    name: String(node?.name || ""),
    type: String(node?.type || ""),
    typeVersion: node?.typeVersion ?? null,
    hasCredentials: Boolean(node?.credentials && Object.keys(node.credentials).length),
  };
}

function classifyNodes(nodes) {
  const triggers = [];
  const aiNodes = [];
  const httpNodes = [];
  const communityNodes = [];
  const malformed = [];

  for (const node of nodes) {
    const type = String(node?.type || "");
    const lower = type.toLowerCase();
    if (!node?.name || !type || !Array.isArray(node?.position)) malformed.push(nodeSummary(node));
    if (type.includes("Trigger") || lower.includes("webhook") || lower.includes("scheduletrigger")) triggers.push(nodeSummary(node));
    if (lower.includes("openai") || lower.includes("gemini") || lower.includes("anthropic") || lower.includes("llm") || lower.includes("langchain")) aiNodes.push(nodeSummary(node));
    if (lower.includes("httprequest") || lower.includes("http-request")) httpNodes.push(nodeSummary(node));
    if (type.includes("community") || (!type.startsWith("n8n-nodes-base.") && !type.startsWith("@n8n/") && type !== "n8n-nodes-base.code" && type !== "n8n-nodes-base.webhook" && type !== "n8n-nodes-base.respondToWebhook")) communityNodes.push(nodeSummary(node));
  }

  return { triggers, aiNodes, httpNodes, communityNodes, malformed };
}

export function extractWebhookPaths(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  return nodes
    .filter((node) => String(node?.type || "").toLowerCase().includes("webhook"))
    .map((node) => ({
      nodeName: node.name,
      path: String(node?.parameters?.path || node?.webhookId || "").replace(/^\/+/, ""),
      method: String(node?.parameters?.httpMethod || "POST").toUpperCase(),
      responseMode: String(node?.parameters?.responseMode || "")
    }))
    .filter((item) => item.path);
}

export function validateN8nWorkflow(input) {
  let workflow = input;
  const errors = [];
  const warnings = [];

  if (typeof input === "string") {
    try { workflow = JSON.parse(input); }
    catch (error) { return { valid: false, errors: ["Invalid JSON: " + error.message], warnings, report: null, workflow: null }; }
  }

  if (!isObject(workflow)) errors.push("Workflow JSON must be an object.");
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  if (!nodes.length) errors.push("Workflow must contain at least one node.");
  if (!isObject(workflow?.connections)) warnings.push("Workflow has no connections object; verify the imported structure.");
  if (!String(workflow?.name || "").trim()) warnings.push("Workflow has no name.");

  const classified = classifyNodes(nodes);
  if (classified.malformed.length) errors.push(classified.malformed.length + " node(s) are missing required name/type/position fields.");
  const webhookPaths = extractWebhookPaths(workflow);
  if (!webhookPaths.length) warnings.push("No Webhook trigger was detected. Auto-Media runtime execution expects a callable webhook or another explicitly configured trigger.");
  if (classified.communityNodes.length) warnings.push(classified.communityNodes.length + " node(s) use non-standard/community node types; verify the target n8n instance has them installed.");

  const credentialRequirements = [];
  for (const node of nodes) {
    if (node?.credentials && isObject(node.credentials)) {
      for (const [type, value] of Object.entries(node.credentials)) {
        credentialRequirements.push({ nodeName: node.name, type, name: value?.name || null, id: value?.id || null });
      }
    }
  }

  const secrets = scanEmbeddedSecrets(workflow);
  if (secrets.length) errors.push(secrets.length + " likely embedded secret/token value(s) detected. Remove them and use n8n credentials instead.");

  const expectedInputs = ["jobId", "profileId", "contentTypeId", "automationId"];
  const jsonText = JSON.stringify(workflow);
  const mentionedInputs = expectedInputs.filter((key) => jsonText.includes(key));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    workflow,
    report: {
      name: String(workflow?.name || "Untitled workflow"),
      nodeCount: nodes.length,
      triggerNodes: classified.triggers,
      aiNodes: classified.aiNodes,
      httpNodes: classified.httpNodes,
      communityNodes: classified.communityNodes,
      malformedNodes: classified.malformed,
      credentialRequirements,
      embeddedSecrets: secrets,
      webhookPaths,
      expectedInputs,
      mentionedInputs,
      expectedOutputs: ["status", "content", "media", "error"],
    }
  };
}

function signPayload(payload) {
  const secret = sharedSecret();
  return secret ? crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex") : "";
}

export function verifyCallbackSignature(payload, signature) {
  if (!sharedSecret() || !signature) return false;
  const expected = signPayload(payload);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
}

function buildWebhookUrl(workflow, test = false) {
  const hooks = extractWebhookPaths(workflow);
  if (!hooks[0]) throw new Error("Imported workflow has no Webhook trigger path.");
  const prefix = process.env.N8N_WEBHOOK_PREFIX || (test ? "webhook-test" : "webhook");
  return webhookBase() + "/" + prefix + "/" + hooks[0].path.split("/").map(encodeURIComponent).join("/");
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error("n8n request failed (" + res.status + "): " + (data?.message || data?.error || text || "Unknown error"));
    return data;
  } finally { clearTimeout(timer); }
}

export async function n8nHealth() {
  if (!baseUrl()) return { configured: false, reachable: false, message: "N8N_BASE_URL is not configured." };
  try {
    const data = await request(baseUrl() + "/healthz", { method: "GET", headers: {} });
    return { configured: Boolean(sharedSecret()), reachable: true, message: "n8n is reachable.", data };
  } catch (error) {
    return { configured: Boolean(sharedSecret()), reachable: false, message: error.message };
  }
}

export async function invokeN8nWorkflow({ workflow, jobId, input, test = false }) {
  if (!isConfigured()) throw new Error("n8n is not configured. Set N8N_BASE_URL, N8N_SHARED_SECRET and a reachable webhook URL.");
  const callbackUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") + "/api/studio/n8n/callback";
  const payload = {
    jobId,
    profileId: input?.profileId,
    contentTypeId: input?.contentTypeId,
    automationId: input?.automationId,
    profile: input?.profile || null,
    contentType: input?.contentType || null,
    source: input?.source || null,
    config: input?.config || {},
    callbackUrl,
    callbackToken: signPayload({ jobId }),
    mode: test ? "test" : "run"
  };
  const response = await request(buildWebhookUrl(workflow, test), {
    method: "POST",
    headers: {
      "X-Auto-Media-Secret": sharedSecret(),
      "X-Auto-Media-Signature": signPayload(payload)
    },
    body: JSON.stringify(payload)
  });
  return { payload, response };
}
