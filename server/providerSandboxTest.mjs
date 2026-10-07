import "dotenv/config";
import assert from "node:assert/strict";
import { query, closeDatabase } from "./db.mjs";
import { testSocialAccount, markAccountTest } from "./accountHealth.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";
import { putBuffer } from "./storage.mjs";

const enabled = String(process.env.AUTOMEDIA_E2E_PUBLISH || "false").toLowerCase() === "true";
const strict = String(process.env.AUTOMEDIA_E2E_STRICT || "false").toLowerCase() === "true";
const accountIds = String(process.env.AUTOMEDIA_E2E_ACCOUNT_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);
const platformsFilter = new Set(
  String(process.env.AUTOMEDIA_E2E_PLATFORMS || "")
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
);

if (!process.env.DATABASE_URL) {
  if (strict) throw new Error("Strict platform sandbox suite requires DATABASE_URL.");
  console.log("Platform sandbox suite skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

async function loadAccounts() {
  if (accountIds.length) {
    const result = await query(
      "SELECT * FROM social_accounts WHERE id = ANY($1::uuid[]) ORDER BY platform,name",
      [accountIds]
    );
    return result.rows;
  }
  const result = await query(
    "SELECT * FROM social_accounts WHERE COALESCE((metadata_json->>'integrationTest'),'false')='true' ORDER BY platform,name"
  );
  return result.rows;
}

async function createVideoFixture(workspaceId, profileId, automationId) {
  const key = "integration/e2e/" + Date.now() + ".mp4";
  const buffer = Buffer.from("Auto-Media sandbox integration fixture");
  const stored = await putBuffer({ key, buffer, contentType: "video/mp4" });
  const media = await query(
    "INSERT INTO media_assets(workspace_id,profile_id,type,storage_key,local_path,public_url,mime_type,source,status) VALUES($1,$2,'video',$3,$4,$5,'video/mp4','e2e','ready') RETURNING id",
    [workspaceId, profileId, stored.storageKey, stored.localPath, stored.publicUrl || null]
  );
  const content = await query(
    "INSERT INTO content_items(profile_id,content_type_id,automation_id,title,caption,status,structured_data_json,source_type) SELECT $1,id,$2,'Auto-Media sandbox test','Automated integration-test post — do not use in production.','approved',$3::jsonb,'e2e' FROM content_types WHERE slug='local-video' LIMIT 1 RETURNING id",
    [profileId, automationId, JSON.stringify({ hashtags: ["#automediae2e"], e2e: true })]
  );
  if (!content.rows[0] || !media.rows[0]) throw new Error("Could not create e2e fixture rows.");
  await query(
    "INSERT INTO content_media(content_item_id,media_asset_id,role,sort_order) VALUES($1,$2,'primary',0)",
    [content.rows[0].id, media.rows[0].id]
  );
  return content.rows[0].id;
}

try {
  const accounts = await loadAccounts();
  if (!accounts.length) {
    if (strict) throw new Error("Strict platform sandbox suite requires at least one e2e account.");
    console.log("Platform sandbox suite skipped: no accounts marked for e2e testing.");
    process.exit(0);
  }

  const results = [];
  const selectedAccounts = accounts.filter(account => !platformsFilter.size || platformsFilter.has(String(account.platform).toLowerCase()));
  if (strict && selectedAccounts.length !== accounts.length) throw new Error("Strict sandbox mode does not allow a platform filter to skip configured sandbox accounts.");
  for (const account of selectedAccounts) {
    try {
      const health = await testSocialAccount(account);
      await markAccountTest(account.id, true);
      results.push({ platform: account.platform, name: account.name, health: "ok", label: health.label });
    } catch (error) {
      await markAccountTest(account.id, false);
      results.push({ platform: account.platform, name: account.name, health: "failed", error: error.message });
    }
  }

  console.log(JSON.stringify({ mode: enabled ? "health+publish" : "health-only", accounts: results }, null, 2));

  if (strict && results.length !== selectedAccounts.length) throw new Error("Strict sandbox suite did not execute every selected sandbox account.");

  const failedHealth = results.filter(x => x.health === "failed");
  assert.equal(failedHealth.length, 0, "One or more sandbox account health checks failed.");

  if (enabled) {
    const targets = selectedAccounts.filter(x =>
      (!platformsFilter.size || platformsFilter.has(String(x.platform).toLowerCase())) &&
      ["facebook","instagram","youtube","tiktok","x","threads","mastodon","linkedin","pinterest","reddit","telegram","discord","bluesky"].includes(String(x.platform).toLowerCase())
    );
    if (strict && targets.length !== selectedAccounts.length) throw new Error("Strict sandbox suite found an unsupported or unselected configured provider account.");
    if (!targets.length) throw new Error("No supported sandbox accounts selected for publish e2e.");

    const type = await query("SELECT id FROM content_types WHERE slug='local-video' LIMIT 1");
    if (!type.rows[0]) throw new Error("local-video content type is required for publish e2e.");

    const publishResults = [];
    const workspaceProfiles = new Map();
    for (const target of targets) {
      let profileId = workspaceProfiles.get(target.workspace_id);
      if (!profileId) {
        const existing = await query(
          "SELECT id FROM profiles WHERE workspace_id=$1 ORDER BY created_at LIMIT 1",
          [target.workspace_id]
        );
        if (existing.rows[0]) {
          profileId = existing.rows[0].id;
        } else {
          const profile = await query(
            "INSERT INTO profiles(workspace_id,name,slug,description) VALUES($1,$2,$3,$4) RETURNING id",
            [target.workspace_id, "E2E Sandbox", "e2e-sandbox-" + Date.now(), "Disposable provider integration test profile."]
          );
          profileId = profile.rows[0].id;
        }
        workspaceProfiles.set(target.workspace_id, profileId);
      }

      const automation = await query(
        "INSERT INTO automations(profile_id,content_type_id,name,enabled,approval_mode) VALUES($1,$2,$3,true,'auto') RETURNING id",
        [profileId, type.rows[0].id, "E2E " + target.platform + " " + Date.now()]
      );
      const automationId = automation.rows[0].id;
      const contentId = await createVideoFixture(target.workspace_id, profileId, automationId);
      await query(
        "INSERT INTO automation_destinations(automation_id,social_account_id,enabled) VALUES($1,$2,true)",
        [automationId, target.id]
      );
      const jobs = await createPublishingJobs(contentId);
      const job = jobs.find(x => x.social_account_id === target.id);
      if (!job) throw new Error("Publishing job was not created for " + target.platform + ".");
      const published = await publishPublishingJob(job.id);
      publishResults.push({ platform: target.platform, account: target.name, result: published });
      if (published.status !== "published") {
        throw new Error("Sandbox publish failed for " + target.platform + ": " + (published.error || published.status));
      }
    }
    console.log(JSON.stringify({ publishResults }, null, 2));
  }

  console.log("Auto-Media provider sandbox suite passed.");
} finally {
  await closeDatabase().catch(() => {});
}
