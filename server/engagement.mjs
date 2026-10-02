import { query } from "./db.mjs";
import { loadCredential } from "./credentialVault.mjs";
import { getGoogleAccessToken } from "./youtube.mjs";
import { getBlueskyAgent } from "./blueskyOAuth.mjs";

const LINKEDIN_VERSION = String(process.env.LINKEDIN_VERSION || "202609").replace(/[^0-9]/g, "");

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error || data.errors || data.message) {
    const message = data.error?.message || data.error_description || data.message || (Array.isArray(data.errors) ? data.errors[0]?.message : "") || response.statusText;
    const error = new Error(String(message || "Platform analytics request failed."));
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function normalize(metrics = {}) {
  const keys = ["followers","following","posts","likes","views","comments","shares","subscribersGained","followersGained7d","likes7d","comments7d","shares7d","views7d","engagement7d"];
  const result = { source: metrics.source || "platform" };
  for (const key of keys) result[key] = metrics[key] == null ? null : Number(metrics[key]);
  return result;
}

async function facebook(account, credential) {
  const version = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");
  const token = credential.pageAccessToken || credential.accessToken;
  const headers = { Authorization: "Bearer " + token };
  const pageId = credential.pageId || account.external_account_id;
  const data = await getJson("https://graph.facebook.com/" + version + "/" + encodeURIComponent(pageId) + "?fields=id,name,followers_count,fan_count", { headers });
  const metrics = { followers: data.followers_count ?? data.fan_count, source: "facebook" };
  try {
    const since = Math.floor((Date.now() - 7 * 86400000) / 1000);
    const until = Math.floor(Date.now() / 1000);
    const insights = await getJson("https://graph.facebook.com/" + version + "/" + encodeURIComponent(pageId) + "/insights?metric=page_daily_follows,page_post_engagements,page_views_total&period=day&since=" + since + "&until=" + until, { headers });
    const values = {};
    for (const item of insights.data || []) values[item.name] = (item.values || []).reduce((n,v)=>n+Number(v.value||0),0);
    metrics.followersGained7d = values.page_daily_follows;
    metrics.engagement7d = values.page_post_engagements;
    metrics.views7d = values.page_views_total;
  } catch {}
  return normalize(metrics);
}

async function instagram(account, credential) {
  const version = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");
  const id = credential.igUserId || account.external_account_id;
  const data = await getJson("https://graph.facebook.com/" + version + "/" + encodeURIComponent(id) + "?fields=id,username,followers_count,media_count", { headers: { Authorization: "Bearer " + credential.accessToken } });
  return normalize({ followers: data.followers_count, posts: data.media_count, source: "instagram" });
}

async function youtube(account, credential) {
  const accessToken = await getGoogleAccessToken({ clientId: credential.clientId, clientSecret: credential.clientSecret, refreshToken: credential.refreshToken });
  const channelId = credential.channelId || account.external_account_id;
  const channel = await getJson("https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=" + encodeURIComponent(channelId), { headers: { Authorization: "Bearer " + accessToken } });
  const stats = channel.items?.[0]?.statistics || {};
  const metrics = { followers: stats.subscriberCount, posts: stats.videoCount, views: stats.viewCount, source: "youtube" };
  try {
    const end = new Date(Date.now() - 3 * 86400000);
    const start = new Date(end.getTime() - 6 * 86400000);
    const format = date => date.toISOString().slice(0,10);
    const report = await getJson("https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D" + encodeURIComponent(channelId) + "&startDate=" + format(start) + "&endDate=" + format(end) + "&metrics=views%2Clikes%2Ccomments%2Cshares%2CsubscribersGained&dimensions=day&sort=-day&maxResults=7", { headers: { Authorization: "Bearer " + accessToken } });
    const rows = report.rows || [];
    metrics.views7d = rows.reduce((n,r)=>n+Number(r[1]||0),0);
    metrics.likes7d = rows.reduce((n,r)=>n+Number(r[2]||0),0);
    metrics.comments7d = rows.reduce((n,r)=>n+Number(r[3]||0),0);
    metrics.shares7d = rows.reduce((n,r)=>n+Number(r[4]||0),0);
    metrics.subscribersGained = rows.reduce((n,r)=>n+Number(r[5]||0),0);
  } catch {}
  return normalize(metrics);
}

async function tiktok(account, credential) {
  const data = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,following_count,likes_count,video_count", { headers: { Authorization: "Bearer " + credential.accessToken } });
  const user = data.data?.user || {};
  if (credential.openId && user.open_id && String(user.open_id) !== String(credential.openId)) throw new Error("TikTok account identity did not match the stored connection.");
  return normalize({ followers: user.follower_count, following: user.following_count, likes: user.likes_count, posts: user.video_count, source: "tiktok" });
}

async function linkedin(account, credential) {
  const data = await getJson("https://api.linkedin.com/rest/memberFollowersCount?q=me", { headers: { Authorization: "Bearer " + credential.accessToken, "Linkedin-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" } });
  const latest = (data.elements || []).at(-1) || {};
  return normalize({ followers: latest.followerCounts?.organicFollowerCount ?? latest.followerCount ?? latest.totalFollowers, source: "linkedin" });
}

async function xAccount(account, credential) {
  const data = await getJson("https://api.x.com/2/users/me?user.fields=public_metrics", { headers: { Authorization: "Bearer " + credential.accessToken } });
  const m = data.data?.public_metrics || {};
  return normalize({ followers: m.followers_count, following: m.following_count, posts: m.tweet_count, source: "x" });
}

async function mastodon(account, credential) {
  const data = await getJson(String(credential.instance).replace(/\/+$/,"") + "/api/v1/accounts/verify_credentials", { headers: { Authorization: "Bearer " + credential.accessToken } });
  return normalize({ followers: data.followers_count, following: data.following_count, posts: data.statuses_count, source: "mastodon" });
}

async function bluesky(account, credential) {
  const did = credential.did || account.external_account_id;
  const agent = await getBlueskyAgent(account.workspace_id, did);
  const data = (await agent.getProfile({ actor: did })).data || {};
  return normalize({ followers: data.followersCount, following: data.followsCount, posts: data.postsCount, source: "bluesky" });
}

async function pinterest(account, credential) {
  const data = await getJson("https://api.pinterest.com/v5/user_account", { headers: { Authorization: "Bearer " + credential.accessToken } });
  return normalize({ followers: data.follower_count ?? data.followers_count, following: data.following_count, posts: data.pin_count ?? data.board_count, source: "pinterest" });
}

export async function fetchAccountMetrics(account) {
  const credential = await loadCredential(account.workspace_id, account.credential_ref);
  if (!credential) throw new Error("Encrypted credentials are missing for this account.");
  switch (account.platform) {
    case "facebook": return facebook(account, credential);
    case "instagram": return instagram(account, credential);
    case "youtube": return youtube(account, credential);
    case "tiktok": return tiktok(account, credential);
    case "linkedin": return linkedin(account, credential);
    case "x": return xAccount(account, credential);
    case "mastodon": return mastodon(account, credential);
    case "bluesky": return bluesky(account, credential);
    case "pinterest": return pinterest(account, credential);
    default: { const error = new Error("Engagement metrics are not implemented for " + account.platform + "."); error.code = "UNSUPPORTED_PLATFORM"; throw error; }
  }
}

export async function syncAccountMetrics(account) {
  const metricDate = new Date().toISOString().slice(0,10);
  try {
    const metrics = await fetchAccountMetrics(account);
    await query("INSERT INTO account_metric_snapshots (social_account_id,metric_date,metrics_json,source,error_message,fetched_at) VALUES ($1,$2,$3::jsonb,$4,NULL,now()) ON CONFLICT (social_account_id,metric_date) DO UPDATE SET metrics_json=EXCLUDED.metrics_json,source=EXCLUDED.source,error_message=NULL,fetched_at=now()", [account.id,metricDate,JSON.stringify(metrics),account.platform]);
    await query("UPDATE social_accounts SET status='connected',updated_at=now() WHERE id=$1", [account.id]);
    return { accountId: account.id, platform: account.platform, name: account.name, metricDate, metrics, ok: true };
  } catch (error) {
    const reconnect = Number(error.status || 0) === 401 || Number(error.status || 0) === 403 || /scope|permission|authorization|token|credential/i.test(String(error.message || ""));
    await query("INSERT INTO account_metric_snapshots (social_account_id,metric_date,metrics_json,source,error_message,fetched_at) VALUES ($1,$2,'{}'::jsonb,$3,$4,now()) ON CONFLICT (social_account_id,metric_date) DO UPDATE SET error_message=EXCLUDED.error_message,source=EXCLUDED.source,fetched_at=now()", [account.id,metricDate,account.platform,error.message]);
    if (reconnect) await query("UPDATE social_accounts SET status='error',updated_at=now() WHERE id=$1", [account.id]);
    return { accountId: account.id, platform: account.platform, name: account.name, metricDate, metrics: {}, ok: false, needsReconnect: reconnect, error: error.message };
  }
}

export async function listLatestEngagement(workspaceId) {
  const result = await query("SELECT sa.id AS account_id,sa.name,sa.platform,sa.status,sa.external_account_id,s.metric_date,s.metrics_json,s.source,s.error_message,s.fetched_at FROM social_accounts sa LEFT JOIN LATERAL (SELECT metric_date,metrics_json,source,error_message,fetched_at FROM account_metric_snapshots ams WHERE ams.social_account_id=sa.id ORDER BY metric_date DESC LIMIT 1) s ON TRUE WHERE sa.workspace_id=$1 ORDER BY sa.platform,sa.name", [workspaceId]);
  return result.rows;
}