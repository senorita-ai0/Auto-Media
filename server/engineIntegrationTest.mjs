// End-to-end test of the native content engine against a real PostgreSQL database and a mock
// OpenAI-compatible AI server. Verifies workspace AI providers, hashtag rules, disclaimer,
// image branding, near-duplicate review holds, regeneration and metrics.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.env.CREDENTIALS_MASTER_KEY ||= "auto-media-engine-test-key";
process.env.MEDIA_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "automedia-engine-"));
process.env.AI_RETRY_BASE_MS = "1";
process.env.PUBLIC_BASE_URL ||= "https://example.test";
// Force the workspace-provider path: legacy env fallbacks must not be what makes this pass.
delete process.env.AI_BASE_URL;
delete process.env.AI_TEXT_MODEL;

const { databaseConfigured, query, closeDatabase } = await import("./db.mjs");
if (!databaseConfigured()) {
  if (String(process.env.ENGINE_TEST_STRICT || "").toLowerCase() === "true") throw new Error("Engine integration test requires a database.");
  console.log("Engine integration test skipped: no database configured.");
  process.exit(0);
}

const { saveCredential } = await import("./credentialVault.mjs");
const { runNativeAutomation, regenerateContentItem } = await import("./contentEngine.mjs");
const { renderMetrics } = await import("./metrics.mjs");

// ---------- mock AI server ----------
let scenario = { announcement: { title: "Big news", caption: "We just launched a brand new dashboard for everyone.", hashtags: ["#spam", "launch", "#Dashboard", "#news", "#extra", "#more"] } };
let chatCalls = 0;
const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#204060" } }).png().toBuffer();
const ai = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/images/generations")) return res.end(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }));
    chatCalls += 1;
    const payload = JSON.parse(body || "{}");
    const text = payload.messages.map(m => m.content).join("\n");
    const out = text.includes("CONTENT TYPE INSTRUCTIONS:") && text.includes("release notes")
      ? scenario.product
      : (scenario.queue?.length ? scenario.queue.shift() : scenario.announcement);
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
});
await new Promise(resolve => ai.listen(0, "127.0.0.1", resolve));
const aiBase = "http://127.0.0.1:" + ai.address().port + "/v1";

const suffix = Date.now().toString(36);
let workspaceId = null;
try {
  workspaceId = (await query("INSERT INTO workspaces(name) VALUES($1) RETURNING id", ["Engine test " + suffix])).rows[0].id;

  // Workspace-scoped, encrypted AI provider (the Studio "AI Providers" feature).
  await saveCredential(workspaceId, "ai:engine-test", { apiKey: "test-key" });
  await query(
    "INSERT INTO ai_providers(workspace_id,name,base_url,text_model,image_model,credential_ref,enabled) VALUES($1,'Mock',$2,'mock-text','mock-image','ai:engine-test',true)",
    [workspaceId, aiBase]
  );

  const profile = (await query(
    "INSERT INTO profiles(workspace_id,name,slug,master_prompt,disclaimer,hashtag_rules_json,visual_identity_json) VALUES($1,'Future Tech',$2,'Write about tech.','AI image, for reference only.',$3::jsonb,$4::jsonb) RETURNING id",
    [workspaceId, "future-tech-" + suffix, JSON.stringify({ count: 4, required: ["#FutureTech"], avoid: ["#spam"] }), JSON.stringify({ footerText: "@futuretech", logoPosition: "top-left" })]
  )).rows[0].id;

  // Brand logo asset (red square).
  const logo = await sharp({ create: { width: 100, height: 100, channels: 4, background: "#ff0000" } }).png().toBuffer();
  await fs.mkdir(path.join(process.env.MEDIA_ROOT, "brand"), { recursive: true });
  await fs.writeFile(path.join(process.env.MEDIA_ROOT, "brand", "logo-" + suffix + ".png"), logo);
  const logoAsset = (await query(
    "INSERT INTO media_assets(workspace_id,profile_id,type,storage_key,local_path,mime_type,source,status) VALUES($1,$2,'image',$3,$4,'image/png','upload','ready') RETURNING id",
    [workspaceId, profile, "brand/logo-" + suffix + ".png", path.join(process.env.MEDIA_ROOT, "brand", "logo-" + suffix + ".png")]
  )).rows[0].id;
  await query("INSERT INTO profile_brand_assets(profile_id,media_asset_id,role) VALUES($1,$2,'logo')", [profile, logoAsset]);

  const typeId = async slug => (await query("SELECT id FROM content_types WHERE slug=$1", [slug])).rows[0]?.id;
  const announcementType = await typeId("announcement");
  const productType = await typeId("product-update");
  assert.ok(announcementType && productType, "new built-in content types are seeded");

  const makeAutomation = async (typeId, name, source) => (await query(
    "INSERT INTO automations(profile_id,content_type_id,name,enabled,approval_mode,source_config_json) VALUES($1,$2,$3,true,'auto',$4::jsonb) RETURNING id",
    [profile, typeId, name, JSON.stringify(source)]
  )).rows[0].id;

  // 1) Text content: provider from DB, hashtag rules, disclaimer, auto-approval.
  const announcement = await makeAutomation(announcementType, "Announce", { context: "We launched a new dashboard." });
  const first = await runNativeAutomation(announcement);
  assert.equal(first.status, "approved");
  assert.ok(first.caption.endsWith("AI image, for reference only."), "profile disclaimer is appended");
  assert.equal(first.hashtags[0], "#FutureTech", "required hashtag comes first");
  assert.ok(!first.hashtags.includes("#spam"), "avoided hashtag is removed");
  assert.equal(first.hashtags.length, 4, "hashtag count rule is enforced");
  assert.equal(first.media, null, "text content type produces no image");
  assert.equal(first.policyFlags.length, 0);

  // 2) Same output again => near-duplicate is held for review even on an auto-approve automation.
  const second = await runNativeAutomation(announcement);
  assert.equal(second.status, "needs_review");
  assert.ok(second.policyFlags.some(f => f.code === "near_duplicate"));

  // 3) Image content: generated image is branded with the profile logo and footer.
  scenario.product = { title: "v2 released", caption: "Version two ships faster exports and a redesigned editor today.", hashtags: ["#release"], image_prompt: "abstract blue gradient" };
  const product = await makeAutomation(productType, "Product", { context: "release notes: faster exports, new editor" });
  const withImage = await runNativeAutomation(product);
  assert.equal(withImage.status, "approved");
  assert.equal(withImage.media.branded, true);
  const stored = await sharp(withImage.media.localPath).raw().toBuffer({ resolveWithObject: true });
  assert.equal(stored.info.width, 512);
  const at = (x, y) => { const i = (y * stored.info.width + x) * stored.info.channels; return [stored.data[i], stored.data[i + 1], stored.data[i + 2]]; };
  assert.deepEqual(at(40, 40), [255, 0, 0], "logo is composited at the profile's configured corner");
  assert.deepEqual(at(256, 256), [0x20, 0x40, 0x60], "rest of the image is unchanged");
  const attached = await query("SELECT count(*)::int AS n FROM content_media WHERE content_item_id=$1", [withImage.contentId]);
  assert.equal(attached.rows[0].n, 1);

  // 4) Regeneration works for the generic AI types and keeps revision lineage.
  scenario.announcement = { title: "Another angle", caption: "Meet the redesigned workspace: quicker search, cleaner layout, calmer colours.", hashtags: ["#Workspace"] };
  const regenerated = await regenerateContentItem(first.contentId);
  assert.equal(regenerated.revisionOf, first.contentId);
  assert.equal(regenerated.status, "approved");
  assert.ok(regenerated.caption.includes("redesigned workspace"));

  // 4b) Quality gate: leaked AI boilerplate is held for review even on an auto-approve automation.
  scenario.announcement = { title: "Oops", caption: "As an AI language model, I cannot announce this. [Your Name] will follow up.", hashtags: ["#x"] };
  const boiler = await runNativeAutomation(await makeAutomation(announcementType, "Boilerplate", { context: "x" }));
  assert.equal(boiler.status, "needs_review");
  assert.ok(boiler.policyFlags.some(f => f.code === "quality_critical"));

  // 4c) Best-of-N: with variants=3 the highest-scoring candidate wins and alternatives are stored.
  const variantAutomation = await makeAutomation(announcementType, "Variants", { context: "Dashboard launch" });
  await query("UPDATE automations SET generation_config_json=$2::jsonb WHERE id=$1", [variantAutomation, JSON.stringify({ variants: 3 })]);
  scenario.queue = [
    { title: "A", caption: "Invalid title is dropped by schema validation.", hashtags: ["#a"] },
    { title: "Reporting view", caption: "Today we are rolling out the new reporting view.\nIt loads faster and keeps your filters between sessions, so weekly reviews take minutes.", hashtags: ["#b"] },
    { title: "Boilerplate try", caption: "As an AI I cannot write this.", hashtags: ["#c"] }
  ];
  const best = await runNativeAutomation(variantAutomation);
  assert.equal(best.title, "Reporting view");
  const bestStored = (await query("SELECT structured_data_json FROM content_items WHERE id=$1", [best.contentId])).rows[0].structured_data_json;
  assert.equal(bestStored.variants.length, 2, "schema-invalid candidate is dropped");
  assert.equal(bestStored.variants.filter(v => v.chosen).length, 1);
  assert.ok(bestStored.quality.score >= 85, "chosen variant quality is recorded");
  scenario.queue = [];

  // 4d) Provider failover: a dead, older provider is tried first; the working one still produces content.
  const dead = (await query(
    "INSERT INTO ai_providers(workspace_id,name,base_url,text_model,credential_ref,enabled,created_at) VALUES($1,'Dead','http://127.0.0.1:9/v1','dead-text','ai:engine-test',true, now() - interval '1 day') RETURNING id",
    [workspaceId]
  )).rows[0].id;
  scenario.announcement = { title: "Failover works", caption: "Even with the first provider down, the second one answered and the post went out intact.", hashtags: ["#ok"] };
  const failedOver = await runNativeAutomation(await makeAutomation(announcementType, "Failover", { context: "x" }));
  assert.equal(failedOver.title, "Failover works");
  await query("UPDATE ai_providers SET enabled=false WHERE id=$1", [dead]);

  // 5) Metrics render real queue/content counts.
  const metrics = await renderMetrics();
  assert.match(metrics, /automedia_content_items\{status="approved"\} \d+/);
  assert.match(metrics, /automedia_publish_overdue_seconds \d+/);

  assert.ok(chatCalls >= 4, "mock AI server was used");
  console.log("Auto-Media engine integration test passed.");
} finally {
  if (workspaceId) await query("DELETE FROM workspaces WHERE id=$1", [workspaceId]).catch(() => {});
  await new Promise(resolve => ai.close(resolve));
  await fs.rm(process.env.MEDIA_ROOT, { recursive: true, force: true }).catch(() => {});
  await closeDatabase().catch(() => {});
}
