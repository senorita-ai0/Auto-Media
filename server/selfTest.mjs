import assert from "node:assert/strict";
import { validateStructuredOutput } from "./structuredValidation.mjs";
import { notifyAlert } from "./alerts.mjs";
import { nextAutomationRun, expandAutomationCalendar } from "./calendar.mjs";
import { supportsMedia, getPlatformCapabilities } from "./platformCapabilities.mjs";
import { listOAuthProviders } from "./oauth.mjs";
import { classifyError } from "./jobs.mjs";

const schema = {
  type: "object",
  required: ["title", "hashtags"],
  properties: {
    title: { type: "string", minLength: 3 },
    hashtags: { type: "array", minItems: 1, items: { type: "string" } }
  }
};

assert.equal(validateStructuredOutput({ title: "Hello", hashtags: ["#test"] }, schema).valid, true);
assert.equal(validateStructuredOutput({ title: "x", hashtags: [] }, schema).valid, false);

const base = {
  id: "automation-1",
  name: "Demo",
  profile_name: "Demo Page",
  content_type_name: "Text",
  enabled: true,
  schedule_type: "interval",
  schedule_config_json: { intervalMinutes: 60 },
  timezone: "UTC"
};
const from = new Date("2026-10-02T10:00:00Z");
const next = nextAutomationRun(base, from);
assert.equal(next.toISOString(), "2026-10-02T11:00:00.000Z");

const events = expandAutomationCalendar(base ? [base] : [], from, new Date("2026-10-02T13:00:00Z"));
assert.ok(events.length >= 3);
const oauthProviders = listOAuthProviders().map(x => x.id);
assert.ok(oauthProviders.includes("x"));
assert.ok(oauthProviders.includes("mastodon"));
assert.ok(oauthProviders.includes("threads"));
assert.equal(classifyError(new Error("All videos in this folder have already been used.")).retryable, false);
assert.equal(classifyError(new Error("fetch failed")).retryable, true);
console.log("Auto-Media core self-tests passed.");

assert.equal(supportsMedia("facebook", "image"), true);
assert.equal(supportsMedia("youtube", "image"), false);
assert.equal(supportsMedia("bluesky", "video"), true);
assert.deepEqual(getPlatformCapabilities("unknown"), { image: false, video: false });

console.log("Platform capability self-tests passed.");

import { runtimeLiveness } from "./runtimeConfig.mjs";
const live = runtimeLiveness();
assert.equal(live.ok, true);
assert.equal(typeof live.node, "string");
assert.ok(Number(live.pid) > 0);

import { rateLimit } from "./rateLimit.mjs";
const limiter = rateLimit({ windowMs: 60_000, max: 2, prefix: "selftest-" });
function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
const request = { ip: "127.0.0.250", headers: {}, socket: {} };
let nextCount = 0;
let response = fakeResponse();
limiter(request, response, () => { nextCount += 1; });
response = fakeResponse();
limiter(request, response, () => { nextCount += 1; });
response = fakeResponse();
limiter(request, response, () => { nextCount += 1; });
assert.equal(nextCount, 2);
assert.equal(response.statusCode, 429);

const previous = {
  webhook: process.env.ALERT_WEBHOOK_URL,
  slack: process.env.ALERT_SLACK_WEBHOOK_URL,
  email: process.env.ALERT_EMAIL_WEBHOOK_URL,
  min: process.env.ALERT_MIN_LEVEL
};
const sent = [];
global.fetch = async (url, options = {}) => {
  sent.push({ url: String(url), body: JSON.parse(options.body || "{}") });
  return new Response("", { status: 200 });
};
process.env.ALERT_WEBHOOK_URL = "https://alerts.example.test/webhook";
process.env.ALERT_SLACK_WEBHOOK_URL = "https://alerts.example.test/slack";
process.env.ALERT_EMAIL_WEBHOOK_URL = "https://alerts.example.test/email";
process.env.ALERT_MIN_LEVEL = "warning";
await notifyAlert("generation.failed", { error: "test" });
assert.equal(sent.length, 3);
assert.equal(sent[1].body.text.includes("ERROR"), true);
sent.length = 0;
await notifyAlert("worker.info", { message: "ignored" });
assert.equal(sent.length, 0);
if (previous.webhook === undefined) delete process.env.ALERT_WEBHOOK_URL; else process.env.ALERT_WEBHOOK_URL = previous.webhook;
if (previous.slack === undefined) delete process.env.ALERT_SLACK_WEBHOOK_URL; else process.env.ALERT_SLACK_WEBHOOK_URL = previous.slack;
if (previous.email === undefined) delete process.env.ALERT_EMAIL_WEBHOOK_URL; else process.env.ALERT_EMAIL_WEBHOOK_URL = previous.email;
if (previous.min === undefined) delete process.env.ALERT_MIN_LEVEL; else process.env.ALERT_MIN_LEVEL = previous.min;
