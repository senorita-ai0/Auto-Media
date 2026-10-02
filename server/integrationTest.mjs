import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.CREDENTIALS_MASTER_KEY ||= "auto-media-ci-test-master-key";
process.env.MEDIA_ROOT ||= path.resolve(".automedia-integration-media");
process.env.PUBLIC_BASE_URL ||= "https://example.test";

const { query, withAdvisoryLock, closeDatabase } = await import("./db.mjs");
const { saveCredential } = await import("./credentialVault.mjs");
const { createPublishingJobs, publishPublishingJob } = await import("./studioPublishing.mjs");

const suffix = Date.now().toString(36);
const mediaPath = path.join(path.resolve(process.env.MEDIA_ROOT), "integration-" + suffix + ".mp4");
await fs.mkdir(path.dirname(mediaPath), { recursive: true });
await fs.writeFile(mediaPath, Buffer.from("auto-media integration fixture"));

let originalFetch = global.fetch;
const requests = [];

try {
  const workspace = await query("INSERT INTO workspaces(name) VALUES($1) RETURNING id", ["Integration " + suffix]);
  const workspaceId = workspace.rows[0].id;
  const profile = await query(
    "INSERT INTO profiles(workspace_id,name,slug) VALUES($1,$2,$3) RETURNING id",
    [workspaceId, "Integration Profile", "integration-" + suffix]
  );
  const type = await query("SELECT id FROM content_types WHERE slug='local-video' LIMIT 1");
  assert.ok(type.rows[0], "local-video content type should be seeded");

  const automation = await query(
    "INSERT INTO automations(profile_id,content_type_id,name,enabled,approval_mode) VALUES($1,$2,$3,true,'auto') RETURNING id",
    [profile.rows[0].id, type.rows[0].id, "Integration Automation"]
  );

  const credentialName = "integration:discord:" + suffix;
  await saveCredential(workspaceId, credentialName, { webhookUrl: "https://discord.example.test/webhook" });
  const account = await query(
    "INSERT INTO social_accounts(workspace_id,platform,name,external_account_id,credential_ref,status) VALUES($1,'discord',$2,$3,$4,'connected') RETURNING id",
    [workspaceId, "Integration Discord", "discord-" + suffix, credentialName]
  );
  await query(
    "INSERT INTO automation_destinations(automation_id,social_account_id,enabled) VALUES($1,$2,true)",
    [automation.rows[0].id, account.rows[0].id]
  );

  const content = await query(
    "INSERT INTO content_items(profile_id,content_type_id,automation_id,title,caption,status,structured_data_json) VALUES($1,$2,$3,'Integration item','Integration caption','approved',$4::jsonb) RETURNING id",
    [profile.rows[0].id, type.rows[0].id, automation.rows[0].id, JSON.stringify({ hashtags: ["#test"] })]
  );
  const media = await query(
    "INSERT INTO media_assets(workspace_id,profile_id,type,storage_key,local_path,mime_type,source,status) VALUES($1,$2,'video',$3,$4,'video/mp4','integration','ready') RETURNING id",
    [workspaceId, profile.rows[0].id, "integration/" + suffix + ".mp4", mediaPath]
  );
  await query(
    "INSERT INTO content_media(content_item_id,media_asset_id,role,sort_order) VALUES($1,$2,'primary',0)",
    [content.rows[0].id, media.rows[0].id]
  );

  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    return new Response(JSON.stringify({ id: "mock-discord-message", attachments: [{ url: "https://cdn.example.test/mock.mp4" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const first = await createPublishingJobs(content.rows[0].id);
  const second = await createPublishingJobs(content.rows[0].id);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id, "publishing-job idempotency must hold");

  const published = await publishPublishingJob(first[0].id);
  assert.equal(published.status, "published");
  assert.equal(requests.length, 1);
  const replay = await publishPublishingJob(first[0].id);
  assert.equal(replay.status, "published");
  assert.equal(requests.length, 1, "published jobs must not duplicate the outbound post");

  let nestedAcquired = null;
  const outer = await withAdvisoryLock("integration:worker-lock", async () => {
    const inner = await withAdvisoryLock("integration:worker-lock", async () => true);
    nestedAcquired = inner.acquired;
    return "outer";
  });
  assert.equal(outer.acquired, true);
  assert.equal(nestedAcquired, false);

  console.log("Auto-Media PostgreSQL integration tests passed.");
} finally {
  global.fetch = originalFetch;
  await closeDatabase().catch(() => {});
}
