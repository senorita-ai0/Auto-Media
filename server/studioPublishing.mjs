const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");

import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns/promises";
import { URL } from "node:url";
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

async function assertSafeRemoteMediaUrl(value) {
  const url = new URL(String(value || ""));
  if (!["https:"].includes(url.protocol)) throw new Error("Remote media URL must use HTTPS.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1") throw new Error("Remote media host is not allowed.");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length) throw new Error("Remote media host did not resolve.");
  for (const entry of addresses) {
    const ip = entry.address;
    const blocked =
      /^127\./.test(ip) ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^169\.254\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
      /^::1$/.test(ip) ||
      /^fc/i.test(ip) ||
      /^fd/i.test(ip) ||
      /^fe80:/i.test(ip) ||
      /^::ffff:(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(ip);
    if (blocked) throw new Error("Remote media host resolves to a private or link-local address.");
  }
  return url.toString();
}

async function buildMediaContext(content) {
  const publicUrl = content.public_url || (API_BASE() && content.storage_key ? API_BASE() + "/media/" + content.storage_key.split("/").map(encodeURIComponent).join("/") : null);
  const root = process.env.MEDIA_ROOT || "media";
  const candidates = [];
  if (content.local_path) candidates.push(content.local_path);
  if (content.storage_key) candidates.push(path.join(root, content.storage_key));
  let buffer = null;
  let localPath = null;
  for (const candidate of candidates) {
    try {
      buffer = await fs.readFile(candidate);
      localPath = candidate;
      break;
    } catch {}
  }
  if (!buffer && publicUrl) {
    const safeUrl = await assertSafeRemoteMediaUrl(publicUrl);
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error("Could not fetch remote media for publishing (" + response.status + ").");
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer) throw new Error("This content item has no readable media file or public URL.");
  const filename = content.storage_key?.split("/").pop() || (localPath ? path.basename(localPath) : "media.bin");
  return { buffer, publicUrl, filename, mimeType: content.mime_type || "application/octet-stream", kind: String(content.mime_type || "").startsWith("image/") ? "image" : "video" };
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

async function postImageToFacebook({ pageId, pageAccessToken, buffer, filename, caption }) {
  const form = new FormData();
  form.append("access_token", pageAccessToken);
  form.append("source", new Blob([buffer], { type: "image/jpeg" }), filename || "image.jpg");
  if (caption) form.append("message", caption);
  const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + pageId + "/photos", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || "Facebook rejected the image.");
  return { url: "https://www.facebook.com/" + pageId + "/photos/" + data.id, mediaId: data.id };
}

async function postImageToInstagram({ igUserId, accessToken, imageUrl, caption }) {
  if (!imageUrl) throw new Error("Instagram requires a public image URL.");
  const createRes = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + igUserId + "/media", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, caption: caption || "", access_token: accessToken })
  });
  const created = await createRes.json();
  if (!createRes.ok || created.error) throw new Error(created.error?.message || "Instagram rejected the image container.");
  const publishRes = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + igUserId + "/media_publish", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: created.id, access_token: accessToken })
  });
  const published = await publishRes.json();
  if (!publishRes.ok || published.error) throw new Error(published.error?.message || "Instagram rejected the image.");
  return { url: null, mediaId: published.id };
}

async function refreshTikTokCredentialIfNeeded(account, credential) {
  if (account.platform !== "tiktok" || !credential?.refreshToken) return credential;
  if (Number(credential.expiresAt || 0) > Date.now() + 5 * 60 * 1000) return credential;
  const clientKey = String(process.env.TIKTOK_OAUTH_CLIENT_KEY || "");
  const clientSecret = String(process.env.TIKTOK_OAUTH_CLIENT_SECRET || "");
  if (!clientKey || !clientSecret) return credential;
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: credential.refreshToken })
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error) throw new Error(data.error_description || data.error || "TikTok token refresh failed.");
  const next = { ...credential, accessToken: data.access_token, refreshToken: data.refresh_token || credential.refreshToken, expiresAt: Date.now() + Number(data.expires_in || 86400) * 1000, refreshExpiresAt: Date.now() + Number(data.refresh_expires_in || 31536000) * 1000 };
  if (account.workspace_id && account.credential_ref) {
    const vault = await import("./credentialVault.mjs");
    await vault.saveCredential(account.workspace_id, account.credential_ref, next);
  }
  return next;
}
async function refreshThreadsCredentialIfNeeded(account, credential) {
  if (account.platform !== "threads" || !credential?.accessToken) return credential;
  const expiresAt = Number(credential.expiresAt || 0);
  const issuedAt = Number(credential.issuedAt || 0);
  if (expiresAt > Date.now() + 7 * 86400000 || !issuedAt || Date.now() - issuedAt < 24 * 3600000) return credential;
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", credential.accessToken);
  const response = await fetch(url);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error) throw new Error(data.error?.message || data.error_description || "Threads token refresh failed.");
  const next = {
    ...credential,
    accessToken: data.access_token || credential.accessToken,
    issuedAt: Date.now(),
    expiresAt: Date.now() + Number(data.expires_in || 5184000) * 1000
  };
  const vault = await import("./credentialVault.mjs");
  if (account.workspace_id && account.credential_ref) await vault.saveCredential(account.workspace_id, account.credential_ref, next);
  return next;
}

async function refreshPinterestCredentialIfNeeded(account, credential) {
  if (account.platform !== "pinterest" || !credential?.refreshToken) return credential;
  if (Number(credential.expiresAt || 0) > Date.now() + 7 * 86400000) return credential;
  const clientId = String(credential.clientId || process.env.PINTEREST_OAUTH_APP_ID || "");
  const clientSecret = String(credential.clientSecret || process.env.PINTEREST_OAUTH_APP_SECRET || "");
  if (!clientId || !clientSecret) return credential;
  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const response = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refreshToken })
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error) throw new Error(data.error_description || data.error || "Pinterest token refresh failed.");
  const next = {
    ...credential,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || credential.refreshToken,
    issuedAt: Date.now(),
    expiresAt: Date.now() + Number(data.expires_in || 2592000) * 1000,
    refreshExpiresAt: data.refresh_token_expires_at ? Number(data.refresh_token_expires_at) * 1000 : credential.refreshExpiresAt
  };
  const vault = await import("./credentialVault.mjs");
  if (account.workspace_id && account.credential_ref) await vault.saveCredential(account.workspace_id, account.credential_ref, next);
  return next;
}

async function postForPlatform(account, credential, content, media) {
  const row = rowFromContent(content, media, account);
  const c = credential || {};
  switch (account.platform) {
    case "facebook":
      if (media.kind === "image") return postImageToFacebook({ pageId: c.pageId || account.external_account_id, pageAccessToken: c.pageAccessToken || c.accessToken, buffer: media.buffer, filename: media.filename, caption: [row.title, row.description].filter(Boolean).join("\n\n") });
      return postVideoToFacebook({ pageId: c.pageId || account.external_account_id, pageAccessToken: c.pageAccessToken || c.accessToken, buffer: media.buffer, filename: media.filename, title: row.title, description: row.description });
    case "instagram":
      if (media.kind === "image") return postImageToInstagram({ igUserId: c.igUserId || account.external_account_id, accessToken: c.accessToken, imageUrl: media.publicUrl, caption: [row.title, row.description].filter(Boolean).join("\n\n") });
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

export async function createPublishingJobs(contentId, scheduledAt = null) {
  const content = await loadContent(contentId);
  const result = await query(
    "SELECT ad.social_account_id, sa.name, sa.platform FROM automation_destinations ad JOIN social_accounts sa ON sa.id = ad.social_account_id WHERE ad.automation_id = $1 AND ad.enabled AND sa.status = 'connected'",
    [content.automation_id]
  );
  if (!result.rows.length) throw new Error("No connected destination accounts are configured for this automation.");

  const jobs = [];
  for (const account of result.rows) {
    const key = "content:" + contentId + ":account:" + account.social_account_id;
    let inserted = await query(
      "INSERT INTO publishing_jobs (content_item_id, social_account_id, status, scheduled_at, idempotency_key) VALUES ($1,$2,CASE WHEN $3::timestamptz IS NOT NULL AND $3::timestamptz > now() THEN 'scheduled' ELSE 'queued' END,COALESCE($3::timestamptz,now()),$4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id,content_item_id,social_account_id,status,idempotency_key,scheduled_at",
      [contentId, account.social_account_id, scheduledAt, key]
    );
    if (!inserted.rows[0]) {
      inserted = await query("SELECT id,content_item_id,social_account_id,status,idempotency_key,scheduled_at FROM publishing_jobs WHERE idempotency_key = $1", [key]);
    }
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
  if (job.scheduled_at && new Date(job.scheduled_at) > new Date()) {
    return { id: job.id, status: "scheduled", platform: job.platform, scheduledAt: job.scheduled_at };
  }

  const claim = await query(
    "UPDATE publishing_jobs SET status='publishing', started_at=now(), attempts=attempts+1, updated_at=now() WHERE id=$1 AND status IN ('queued','scheduled') AND (scheduled_at IS NULL OR scheduled_at<=now()) RETURNING id",
    [jobId]
  );
  if (!claim.rows[0]) {
    const current = await query("SELECT id,status,platform,scheduled_at,external_post_id,external_url,error_code,error_message FROM publishing_jobs WHERE id=$1", [jobId]);
    return current.rows[0] || { id: jobId, status: "busy" };
  }

  let credential = await loadCredential(job.workspace_id, job.credential_ref);
  if (!credential) throw new Error("Credential '" + (job.credential_ref || "missing") + "' is not configured for this account.");
  credential = await refreshTikTokCredentialIfNeeded({ platform: job.platform, workspace_id: job.workspace_id, credential_ref: job.credential_ref }, credential);
  credential = await refreshThreadsCredentialIfNeeded({ platform: job.platform, workspace_id: job.workspace_id, credential_ref: job.credential_ref }, credential);
  credential = await refreshPinterestCredentialIfNeeded({ platform: job.platform, workspace_id: job.workspace_id, credential_ref: job.credential_ref }, credential);

  const content = { ...job, id: job.content_item_id, automation_id: job.automation_id, structured_data_json: job.structured_data_json };
  const media = await buildMediaContext(job);

  try {
    const result = await postForPlatform(job, credential, content, media);
    await query(
      "UPDATE publishing_jobs SET status = 'published', completed_at = now(), updated_at = now(), external_post_id = $2, external_url = $3, error_code = NULL, error_message = NULL WHERE id = $1",
      [jobId, result?.videoId || result?.mediaId || result?.publishId || result?.id || null, result?.url || null]
    );
    return { id: jobId, status: "published", platform: job.platform, url: result?.url || null, note: result?.note || null };
  } catch (error) {
    const policy = classifyError(error);
    await query(
      "UPDATE publishing_jobs SET status = 'failed', completed_at = now(), updated_at = now(), error_code = $2, error_message = $3 WHERE id = $1",
      [jobId, policy.reason, error.message]
    );
    return { id: jobId, status: "failed", platform: job.platform, error: error.message, retryable: policy.retryable };
  }
}
