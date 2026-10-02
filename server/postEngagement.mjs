import { query } from "./db.mjs";
import { loadCredential, saveCredential } from "./credentialVault.mjs";
import { getGoogleAccessToken } from "./youtube.mjs";

const LINKEDIN_VERSION = String(process.env.LINKEDIN_VERSION || "202609").replace(/[^0-9]/g, "");
const META_VERSION = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error || data.errors) {
    const message = data.error?.message || data.error_description || data.message || (Array.isArray(data.errors) ? data.errors[0]?.message : "") || response.statusText;
    const error = new Error(String(message || "Platform analytics request failed."));
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function number(value) {
  return value == null || value === "" ? null : Number(value);
}

function normalize(metrics, source) {
  const allowed = [
    "views","impressions","reach","likes","comments","shares","reactions",
    "saves","clicks","engagement","followersGained"
  ];
  const out = { source };
  for (const key of allowed) {
    if (metrics[key] != null && Number.isFinite(Number(metrics[key]))) out[key] = Number(metrics[key]);
  }
  if (out.reactions == null && out.likes != null) out.reactions = out.likes;
  return out;
}

function summaryCount(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  return value.summary?.total_count ?? value.count ?? null;
}

async function fetchFacebook(job, credential) {
  const token = credential.pageAccessToken || credential.accessToken;
  const id = job.external_post_id;
  const data = await jsonRequest(
    "https://graph.facebook.com/" + META_VERSION + "/" + encodeURIComponent(id) + "?fields=id,permalink_url,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)",
    { headers: { Authorization: "Bearer " + token } }
  );
  const metrics = {
    likes: summaryCount(data.reactions),
    reactions: summaryCount(data.reactions),
    comments: summaryCount(data.comments),
    shares: summaryCount(data.shares)
  };
  try {
    const insights = await jsonRequest(
      "https://graph.facebook.com/" + META_VERSION + "/" + encodeURIComponent(id) + "/insights?metric=post_impressions,post_engagements&period=lifetime",
      { headers: { Authorization: "Bearer " + token } }
    );
    for (const item of insights.data || []) {
      const value = Array.isArray(item.values) ? item.values.at(-1)?.value : item.value;
      if (item.name === "post_impressions") metrics.impressions = value;
      if (item.name === "post_engagements") metrics.engagement = value;
    }
  } catch {}
  return normalize(metrics, "facebook");
}

async function fetchInstagram(job, credential) {
  const token = credential.accessToken;
  const id = job.external_post_id;
  const base = await jsonRequest(
    "https://graph.facebook.com/" + META_VERSION + "/" + encodeURIComponent(id) + "?fields=id,media_type,like_count,comments_count,permalink",
    { headers: { Authorization: "Bearer " + token } }
  );
  const metrics = {
    likes: number(base.like_count),
    reactions: number(base.like_count),
    comments: number(base.comments_count)
  };
  try {
    const insights = await jsonRequest(
      "https://graph.facebook.com/" + META_VERSION + "/" + encodeURIComponent(id) + "/insights?metric=views,reach,likes,comments,saved,shares,total_interactions",
      { headers: { Authorization: "Bearer " + token } }
    );
    for (const item of insights.data || []) {
      const value = Array.isArray(item.values) ? item.values.at(-1)?.value : item.value;
      if (item.name === "saved") metrics.saves = value;
      else if (item.name === "total_interactions") metrics.engagement = value;
      else metrics[item.name] = value;
    }
  } catch {
    // Base media counts remain useful when insights are unavailable for this media type/account.
  }
  return normalize(metrics, "instagram");
}

async function fetchYouTube(job, credential) {
  const accessToken = await getGoogleAccessToken({
    clientId: credential.clientId,
    clientSecret: credential.clientSecret,
    refreshToken: credential.refreshToken
  });
  const data = await jsonRequest(
    "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" + encodeURIComponent(job.external_post_id),
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  const stats = data.items?.[0]?.statistics || {};
  return normalize({
    views: number(stats.viewCount),
    likes: number(stats.likeCount),
    comments: number(stats.commentCount),
    reactions: number(stats.likeCount)
  }, "youtube");
}

async function refreshTikTok(credential) {
  if (!credential?.refreshToken || Number(credential.expiresAt || 0) > Date.now() + 5 * 60 * 1000) return credential;
  const clientKey = String(process.env.TIKTOK_OAUTH_CLIENT_KEY || "");
  const clientSecret = String(process.env.TIKTOK_OAUTH_CLIENT_SECRET || "");
  if (!clientKey || !clientSecret) return credential;
  const data = await jsonRequest("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken
    })
  });
  return {
    ...credential,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || credential.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 86400) * 1000
  };
}

async function fetchTikTok(job, credential) {
  const next = await refreshTikTok(credential);
  if (next !== credential && job.workspace_id && job.credential_ref) await saveCredential(job.workspace_id, job.credential_ref, next);
  const data = await jsonRequest("https://open.tiktokapis.com/v2/video/query/", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + next.accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filters: { video_ids: [String(job.external_post_id)] },
      fields: "id,like_count,comment_count,share_count,view_count"
    })
  });
  const video = data.data?.videos?.[0] || {};
  return normalize({
    views: number(video.view_count),
    likes: number(video.like_count),
    comments: number(video.comment_count),
    shares: number(video.share_count),
    reactions: number(video.like_count)
  }, "tiktok");
}

async function fetchLinkedIn(job, credential) {
  const urn = String(job.external_post_id || "");
  const wrapper = urn.includes(":ugcPost:") ? "ugc" : "share";
  const metrics = {};
  const types = [
    ["impressions", "IMPRESSION"],
    ["reach", "MEMBERS_REACHED"],
    ["shares", "RESHARE"],
    ["likes", "REACTION"],
    ["comments", "COMMENT"]
  ];
  for (const [key, queryType] of types) {
    const url = new URL("https://api.linkedin.com/rest/memberCreatorPostAnalytics");
    url.searchParams.set("q", "entity");
    url.searchParams.set("entity", "(" + wrapper + ":" + urn + ")");
    url.searchParams.set("queryType", queryType);
    url.searchParams.set("aggregation", "TOTAL");
    try {
      const data = await jsonRequest(url.toString(), {
        headers: {
          Authorization: "Bearer " + credential.accessToken,
          "Linkedin-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0"
        }
      });
      metrics[key] = data.elements?.[0]?.count ?? 0;
    } catch {
      metrics[key] = null;
    }
  }
  if (Object.values(metrics).every(x => x == null)) throw new Error("LinkedIn post analytics are unavailable for this account or post; check r_member_postAnalytics access.");
  return normalize(metrics, "linkedin");
}

async function fetchPinterest(job, credential) {
  const id = encodeURIComponent(job.external_post_id);
  const data = await jsonRequest(
    "https://api.pinterest.com/v5/pins/" + id + "?pin_metrics=true",
    { headers: { Authorization: "Bearer " + credential.accessToken } }
  );
  const m = data.pin_metrics || data.metrics || {};
  const metric = (...names) => {
    for (const name of names) {
      if (m[name] != null) return m[name];
      if (m.lifetime?.[name] != null) return m.lifetime[name];
      if (m["90d"]?.[name] != null) return m["90d"][name];
      if (m["30d"]?.[name] != null) return m["30d"][name];
      if (m["7d"]?.[name] != null) return m["7d"][name];
    }
    return null;
  };
  return normalize({
    impressions: metric("impression","impressions"),
    engagement: metric("engagement","engagements"),
    saves: metric("save","saves"),
    clicks: metric("clickthrough","clickthroughs","clicks"),
    comments: metric("comment","comments"),
    reactions: metric("reaction","reactions"),
    likes: metric("reaction","reactions","like","likes")
  }, "pinterest");
}

export async function fetchPublishedJobMetrics(job) {
  const credential = await loadCredential(job.workspace_id, job.credential_ref);
  if (!credential) throw new Error("Encrypted credentials are missing for this publishing account.");
  switch (job.platform) {
    case "facebook": return fetchFacebook(job, credential);
    case "instagram": return fetchInstagram(job, credential);
    case "youtube": return fetchYouTube(job, credential);
    case "tiktok": return fetchTikTok(job, credential);
    case "linkedin": return fetchLinkedIn(job, credential);
    case "pinterest": return fetchPinterest(job, credential);
    default: {
      const error = new Error("Post-level analytics are not implemented for " + job.platform + ".");
      error.code = "UNSUPPORTED_PLATFORM";
      throw error;
    }
  }
}

export async function syncPublishedJobMetrics(job) {
  const metricDate = new Date().toISOString().slice(0, 10);
  try {
    const metrics = await fetchPublishedJobMetrics(job);
    await query(
      "INSERT INTO publishing_metric_snapshots (publishing_job_id,content_item_id,social_account_id,metric_date,metrics_json,source,error_message,fetched_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,NULL,now()) ON CONFLICT (publishing_job_id,metric_date) DO UPDATE SET metrics_json=EXCLUDED.metrics_json,source=EXCLUDED.source,error_message=NULL,fetched_at=now()",
      [job.id, job.content_item_id, job.social_account_id, metricDate, JSON.stringify(metrics), metrics.source || job.platform]
    );
    return { jobId: job.id, contentId: job.content_item_id, platform: job.platform, metricDate, metrics, ok: true };
  } catch (error) {
    await query(
      "INSERT INTO publishing_metric_snapshots (publishing_job_id,content_item_id,social_account_id,metric_date,metrics_json,source,error_message,fetched_at) VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,$6,now()) ON CONFLICT (publishing_job_id,metric_date) DO UPDATE SET error_message=EXCLUDED.error_message,source=EXCLUDED.source,fetched_at=now()",
      [job.id, job.content_item_id, job.social_account_id, metricDate, job.platform, error.message]
    );
    return { jobId: job.id, contentId: job.content_item_id, platform: job.platform, metricDate, metrics: {}, ok: false, error: error.message };
  }
}

export async function listPublishedJobMetrics(workspaceId, contentId = null) {
  const params = [workspaceId];
  let where = "p.workspace_id=$1";
  if (contentId) {
    params.push(contentId);
    where += " AND pj.content_item_id=$2";
  }
  const result = await query(
    "SELECT pj.id AS publishing_job_id,pj.content_item_id,pj.social_account_id,pj.status,pj.external_post_id,pj.external_url,pj.scheduled_at,sa.platform,sa.name AS account_name,c.title,c.profile_id,s.metric_date,s.metrics_json,s.source,s.error_message,s.fetched_at FROM publishing_jobs pj JOIN social_accounts sa ON sa.id=pj.social_account_id JOIN content_items c ON c.id=pj.content_item_id JOIN profiles p ON p.id=c.profile_id LEFT JOIN LATERAL (SELECT metric_date,metrics_json,source,error_message,fetched_at FROM publishing_metric_snapshots pms WHERE pms.publishing_job_id=pj.id ORDER BY metric_date DESC LIMIT 1) s ON TRUE WHERE " + where + " ORDER BY COALESCE(pj.completed_at,pj.scheduled_at) DESC NULLS LAST,pj.id LIMIT 1000",
    params
  );
  return result.rows;
}
