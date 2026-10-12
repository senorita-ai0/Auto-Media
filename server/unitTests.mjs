import assert from "node:assert/strict";
import sharp from "sharp";
import { databaseUrl, databaseConfigured } from "./db.mjs";
import { securityHeaders, corsOptions } from "./securityHeaders.mjs";
import { normalizeHashtags, applyHashtagRules, applyDisclaimer, stripDisclaimer, similarity, findNearDuplicate, evaluateContent } from "./contentPolicy.mjs";
import { resolveBrandingConfig, brandImage } from "./branding.mjs";
import { contentStatusFromPublishingResults } from "./studioPublishing.mjs";
import { legacyApiAuthMiddleware } from "./studioAuth.mjs";

// --- database URL assembly (special characters must be encoded) ---
const savedEnv = { ...process.env };
for (const key of ["DATABASE_URL", "DB_HOST", "DB_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) delete process.env[key];
assert.equal(databaseConfigured(), false);
process.env.DB_HOST = "postgres";
process.env.POSTGRES_PASSWORD = "p@ss/w:rd#1?";
assert.equal(databaseUrl(), "postgresql://automedia:p%40ss%2Fw%3Ard%231%3F@postgres:5432/automedia");
assert.equal(new URL(databaseUrl()).password, "p%40ss%2Fw%3Ard%231%3F");
process.env.DATABASE_URL = "postgresql://x:y@h:1/d";
assert.equal(databaseUrl(), "postgresql://x:y@h:1/d");
Object.assign(process.env, savedEnv);
for (const key of ["DATABASE_URL", "DB_HOST", "DB_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) if (!(key in savedEnv)) delete process.env[key];

// --- security headers + CORS allow-list ---
const headers = {};
securityHeaders()({}, { setHeader: (k, v) => { headers[k] = v; }, removeHeader() {} }, () => {});
assert.equal(headers["X-Content-Type-Options"], "nosniff");
assert.equal(headers["X-Frame-Options"], "DENY");
const previousOrigins = process.env.CORS_ORIGINS;
delete process.env.CORS_ORIGINS;
assert.deepEqual(corsOptions(), {});
process.env.CORS_ORIGINS = "https://studio.example.com, https://b.example.com";
const origin = corsOptions().origin;
let allowed;
origin("https://studio.example.com", (_e, ok) => { allowed = ok; });
assert.equal(allowed, true);
origin("https://evil.example.com", (_e, ok) => { allowed = ok; });
assert.equal(allowed, false);
if (previousOrigins === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = previousOrigins;

// --- hashtag rules ---
assert.deepEqual(normalizeHashtags("#AI, ai  #Future-Tech #"), ["#AI", "#FutureTech"]);
const ruled = applyHashtagRules(["#spam", "#news", "#ai", "#cloud", "#chips"], { count: 4, required: ["#FutureTech"], avoid: ["#spam"] });
assert.deepEqual(ruled.hashtags, ["#FutureTech", "#news", "#ai", "#cloud"]);
assert.equal(applyHashtagRules(["#a"], { min: 3 }).belowMinimum, true);
assert.equal(applyHashtagRules(["#a", "#b"], {}).belowMinimum, false);

// --- disclaimer ---
assert.equal(applyDisclaimer("Hello", "Image is AI generated."), "Hello\n\nImage is AI generated.");
assert.equal(applyDisclaimer("Hello\n\nImage is AI generated.", "Image is AI generated."), "Hello\n\nImage is AI generated.");
assert.equal(applyDisclaimer("Hello", ""), "Hello");

// --- near-duplicate detection ---
const a = "OpenAI announced a new model today that improves coding accuracy for developers worldwide";
assert.ok(similarity(a, a) === 1);
assert.ok(similarity(a, "Completely different sentence about gardening and tomatoes in summer") < 0.1);
assert.ok(findNearDuplicate(a + " and more", [a]));
assert.equal(findNearDuplicate("Totally unrelated content here for the test run", [a]), null);

assert.equal(stripDisclaimer("Hello world\n\nAI image.", "AI image."), "Hello world");
// A stored caption that carries the disclaimer must still match the same text freshly generated.
const stored = applyDisclaimer("We just launched a brand new dashboard for everyone.", "AI image, for reference only.");
assert.equal(evaluateContent({ caption: "We just launched a brand new dashboard for everyone.", hashtags: [], profile: { disclaimer: "AI image, for reference only." }, recentCaptions: [stored] }).forceReview, true);

const clean = evaluateContent({ caption: "A fresh original caption about chips", hashtags: ["#chips"], profile: { disclaimer: "AI image." }, recentCaptions: [a] });
assert.equal(clean.forceReview, false);
assert.ok(clean.caption.endsWith("AI image."));
const dup = evaluateContent({ caption: a, hashtags: [], profile: {}, recentCaptions: [a] });
assert.equal(dup.forceReview, true);
assert.ok(dup.flags.some(f => f.code === "near_duplicate"));
assert.equal(evaluateContent({ caption: "  ", hashtags: [], profile: {}, recentCaptions: [] }).forceReview, true);

// --- branding config normalisation ---
const defaults = resolveBrandingConfig({});
assert.equal(defaults.logoPosition, "bottom-right");
assert.equal(resolveBrandingConfig({ logoPosition: "nowhere", logoScale: 9, bandColor: "red" }).logoScale, 0.4);
assert.equal(resolveBrandingConfig({ bandColor: "red" }).bandColor, "#0b1220");
assert.equal(resolveBrandingConfig({ branding: false }).enabled, false);

// --- branding compositing ---
const base = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#204060" } }).png().toBuffer();
const logo = await sharp({ create: { width: 80, height: 80, channels: 4, background: "#ff0000" } }).png().toBuffer();

const untouched = await brandImage({ imageBuffer: base, visualIdentity: {} });
assert.equal(untouched.branded, false);
assert.equal(untouched.buffer, base);

const withLogo = await brandImage({ imageBuffer: base, logoBuffer: logo, visualIdentity: { logoPosition: "top-left", logoScale: 0.2 } });
assert.equal(withLogo.branded, true);
assert.deepEqual(withLogo.applied, ["logo"]);
const raw = await sharp(withLogo.buffer).raw().toBuffer({ resolveWithObject: true });
assert.equal(raw.info.width, 400);
const px = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
assert.deepEqual(px(30, 30), [255, 0, 0], "logo pixels land at the top-left");
assert.deepEqual(px(380, 380), [0x20, 0x40, 0x60], "background pixels elsewhere are untouched");

const withFooter = await brandImage({ imageBuffer: base, logoBuffer: logo, visualIdentity: { footerText: "@futuretech", logoPosition: "bottom-right" } });
assert.deepEqual(withFooter.applied.sort(), ["footer", "logo"]);
const footerRaw = await sharp(withFooter.buffer).raw().toBuffer({ resolveWithObject: true });
const fi = (390 * footerRaw.info.width + 5) * footerRaw.info.channels;
assert.notDeepEqual([footerRaw.data[fi], footerRaw.data[fi + 1], footerRaw.data[fi + 2]], [0x20, 0x40, 0x60], "footer band darkens the bottom edge");

const badLogo = await brandImage({ imageBuffer: base, logoBuffer: Buffer.from("not an image"), visualIdentity: { footerText: "x" } });
assert.deepEqual(badLogo.applied, ["footer"], "an undecodable logo is skipped, not fatal");

// --- publishing state must not claim success while retries are pending ---
assert.equal(contentStatusFromPublishingResults([{ status: "published" }, { status: "published" }]), "published");
assert.equal(contentStatusFromPublishingResults([{ status: "retry_wait" }]), "scheduled");
assert.equal(contentStatusFromPublishingResults([{ status: "published" }, { status: "retry_wait" }]), "partially_published");
assert.equal(contentStatusFromPublishingResults([{ status: "failed" }]), "failed");
assert.equal(contentStatusFromPublishingResults([]), "approved");

// --- legacy API is gated when production authentication is required ---
const authEnv = {
  STUDIO_AUTH_REQUIRED: process.env.STUDIO_AUTH_REQUIRED,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY
};
process.env.STUDIO_AUTH_REQUIRED = "true";
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
let authStatus = 0;
let nextCalled = false;
const authResponse = {
  status(code) { authStatus = code; return this; },
  json(value) { this.body = value; return this; }
};
await legacyApiAuthMiddleware({ headers: {} }, authResponse, () => { nextCalled = true; });
assert.equal(authStatus, 503);
assert.equal(nextCalled, false);
for (const key of Object.keys(authEnv)) {
  if (authEnv[key] === undefined) delete process.env[key];
  else process.env[key] = authEnv[key];
}

console.log("Auto-Media unit tests passed.");
