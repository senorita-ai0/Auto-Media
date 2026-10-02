import fs from "node:fs/promises";
import { query } from "./db.mjs";
import { loadCredential } from "./credentialVault.mjs";
import { getGoogleAccessToken, uploadVideoToYoutube } from "./youtube.mjs";
import { postVideoToTelegram } from "./telegram.mjs";
import { postVideoToDiscord } from "./discord.mjs";
import { postVideoToFacebook } from "./facebook.mjs";
import { postVideoToLinkedIn } from "./linkedin.mjs";
import { postVideoToPinterest } from "./pinterest.mjs";
import { postVideoToReddit } from "./reddit.mjs";
import { postVideoToX } from "./x.mjs";
import { postVideoToInstagram } from "./instagram.mjs";
import { postVideoToThreads } from "./threads.mjs";
import { postVideoToTikTok } from "./tiktok.mjs";
import { classifyError } from "./jobs.mjs";

const API_BASE = () => String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

async function loadContent(contentId) {
  const result = await query(
    "SELECT c.*, p.workspace_id, p.name AS profile_name, ct.slug AS content_type_slug, ma.storage_key, ma.local_path, ma.public_url, ma.mime_type FROM content_items c JOIN profiles p ON p.id = c.profile_id JOIN content_types ct ON ct.id = c.content_type_id LEFT JOIN content_media cm ON cm.content_item_id = c.id AND cm.role = 'primary' LEFT JOIN media_assets ma ON ma.id = cm.media_asset_id WHERE c.id = $1",
    [contentId]
  );
  if (!result.rows[0]) throw new Error("Content item not found.");
  return result.rows[0];
}

async function loadAccount(accountId) {
  const result = await query("SELECT * FROM social_accounts WHERE id = $1", [accountId]);
  if (!result.rows[0]) throw new Error("Social account not found.");
  return result.rows[0];
}

async function buildVideoContext(content) {
  if (!content.local_path) throw new Error("This content item has no local video file.");
  const buffer = await fs.readFile(content.local_path);
  const publicUrl = content.public_url || (API_BASE() && content.storage_key ? API_BASE() + "/media/" + content.storage_key.split("/").map(encodeURIComponent).join("/") : null);
  return { buffer, publicUrl, filename: content.storage_key?.split("/").pop() || "video.mp4", mimeType: content.mime_type || "video/mp4" };
}

function rowFromContent(content, media, account) {
  const structured = content.structured_data_json || {};
  return {
    title: content.title,
    description: content.caption,
    tags: Array.isArray(structured.hashtags) ? structured.hashtags.join(",") : "",
    thumbnail: structured.thumbnail || "",
    video: content.local_path || content.public_url || content.storage_key,
    destinationUrl: structured.destinationUrl || "",
    mediaUrl: media.publicUrl,
    filename: media.filename,
    platform: account.platform
  };
}

async function postForPlatform(account, credential, content, media) {
  const row = rowFromContent(content, media, account);
  const c = credential || {};
  switch (account.platform) {
    case "facebook":
      return postVideoToFacebook({ pageId: c.pageId || account.external_account_id, pageAccessToken: c.pageAccessToken || c.accessToken, buffer: media.buffer, filename: media.filename, title: row.title, description: row.description });
    case "instagram":
      return postVideoToInstagram({ igUserId: c.igUserId || account.external_account_id, accessToken: c.accessToken, videoUrl: media.publicUrl, caption: [row.title, row.description].filter(Boolean).join("\n\n") });
    case "threads":
      return postVideoToThreads({ threadsUserId: c.threadsUserId || account.external_account_id, accessToken: c.accessToken, videoUrl: media.publicUrl, text: [row.title, row.description].filter(Boolean).join("\n\n") });
    case "tiktok":
      return postVideoToTikTok({ accessToken: c.accessToken, buffer: media.buffer, title: row.title });
    case "youtube": {
      const accessToken = await getGoogleAccessToken({ clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken });
      return uploadVideoToYoutube({ accessToken, buffer: media.buffer, contentType: media.mimeType, title: row.title, description: row.description, tags: row.tags });
    }
    case "telegram":
      return postVideoToTelegram({ botToken: c.botToken, chatId: c.chatId || account.external_account_id, buffer: media.buffer, filename: media.filename, caption: [row.title, row.description].filter(Boolean).join("\n\n") });
    case "discord":
      return postVideoToDiscord({ webhookUrl: c.webhookUrl, buffer: media.buffer, filename: media.filename, content: row.title || "" });
    case "linkedin":
      return postVideoToLinkedIn({ accessToken: c.accessToken, authorUrn: c.authorUrn || account.external_account_id, buffer: media.buffer, title: row.title, description: row.description });
    case "pinterest":
      return postVideoToPinterest({ accessToken: c.accessToken, boardId: c.boardId || account.external_account_id, buffer: media.buffer, filename: media.filename, title: row.title, description: row.description, link: row.destinationUrl });
    case "reddit":
      return postVideoToReddit({ clientId: c.clientId, clientSecret: c.clientSecret, username: c.username, password: c.password, subreddit: c.subreddit, buffer: media.buffer, filename: media.filename, title: row.title, thumbnailUrl: row.thumbnail });
    case "x":
      return postVideoToX({ apiKey: c.apiKey, apiSecret: c.apiSecret, accessToken: c.accessToken, accessTokenSecret: c.accessTokenSecret, buffer: media.buffer, text: row.title });
    default:
      throw new Error("Unsupported publishing platform: " + account.platform);
  }
}

export async function createPublishingJobs(contentId) {
  const content = await loadContent(contentId);
  const result = await query(
    "SELECT ad.social_account_id, sa.name, sa.platform FROM automation_destinations ad JOIN social_accounts sa ON sa.id = ad.social_account_id WHERE ad.automation_id = $1 AND ad.enabled AND sa.status = 'connected'",
    [content.automation_id]
  );
  if (!result.rows.length) throw new Error("No connected destination accounts are configured for this automation.");

  const jobs = [];
  for (const account of result.rows) {
    const key = "content:" + contentId + ":account:" + account.social_account_id;
    const inserted = await query(
      "INSERT INTO publishing_jobs (content_item_id, social_account_id, status, scheduled_at, idempotency_key) VALUES ($1,$2,'queued',now(),$3) ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = publishing_jobs.completed_at RETURNING id,content_item_id,social_account_id,status,idempotency_key",
      [contentId, account.social_account_id, key]
    ).catch(async () => {
      const existing = await query("SELECT id,content_item_id,social_account_id,status,idempotency_key FROM publishing_jobs WHERE idempotency_key = $1", [key]);
      return { rows: existing.rows };
    });
    if (inserted.rows[0]) jobs.push({ ...inserted.rows[0], platform: account.platform, accountName: account.name });
  }
  return jobs;
}

export async function publishPublishingJob(jobId) {
  const row = await query(
    "SELECT pj.*, sa.platform, sa.name AS account_name, sa.credential_ref, c.workspace_id, c.title, c.caption, c.structured_data_json, ma.storage_key, ma.local_path, ma.public_url, ma.mime_type FROM publishing_jobs pj JOIN social_accounts sa ON sa.id = pj.social_account_id JOIN content_items c ON c.id = pj.content_item_id LEFT JOIN content_media cm ON cm.content_item_id = c.id AND cm.role = 'primary' LEFT JOIN media_assets ma ON ma.id = cm.media_asset_id WHERE pj.id = $1",
    [jobId]
  );
  const job = row.rows[0];
  if (!job) throw new Error("Publishing job not found.");
  if (job.status === "published") return job;

  const credential = await loadCredential(job.workspace_id, job.credential_ref);
  if (!credential) throw new Error("Credential '" + (job.credential_ref || "missing") + "' is not configured for this account.");

  const content = { ...job, id: job.content_item_id, automation_id: job.automation_id, structured_data_json: job.structured_data_json };
  const media = await buildVideoContext(job);

  await query("UPDATE publishing_jobs SET status = 'publishing', started_at = now(), attempts = attempts + 1 WHERE id = $1", [jobId]);
  try {
    const result = await postForPlatform(job, credential, content, media);
    await query(
      "UPDATE publishing_jobs SET status = 'published', completed_at = now(), external_post_id = $2, external_url = $3, error_code = NULL, error_message = NULL WHERE id = $1",
      [jobId, result?.videoId || result?.mediaId || result?.publishId || result?.id || null, result?.url || null]
    );
    return { id: jobId, status: "published", platform: job.platform, url: result?.url || null, note: result?.note || null };
  } catch (error) {
    const policy = classifyError(error);
    await query(
      "UPDATE publishing_jobs SET status = 'failed', completed_at = now(), error_code = $2, error_message = $3 WHERE id = $1",
      [jobId, policy.reason, error.message]
    );
    return { id: jobId, status: "failed", platform: job.platform, error: error.message, retryable: policy.retryable };
  }
}
