import crypto from "node:crypto";
import { query } from "./db.mjs";
import { saveCredential } from "./credentialVault.mjs";

const META_VERSION = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");
const providers = {
  google: {
    name: "YouTube / Google",
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: String(process.env.GOOGLE_OAUTH_SCOPES || "https://www.googleapis.com/auth/youtube.upload").split(/[ ,]+/).filter(Boolean)
  },
  linkedin: {
    name: "LinkedIn",
    clientId: process.env.LINKEDIN_OAUTH_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_OAUTH_CLIENT_SECRET,
    authorizationEndpoint: "https://www.linkedin.com/oauth/v2/authorization",
    tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: String(process.env.LINKEDIN_OAUTH_SCOPES || "openid profile w_member_social").split(/[ ,]+/).filter(Boolean)
  },
  tiktok: {
    name: "TikTok",
    clientId: process.env.TIKTOK_OAUTH_CLIENT_KEY,
    clientSecret: process.env.TIKTOK_OAUTH_CLIENT_SECRET,
    authorizationEndpoint: "https://www.tiktok.com/v2/auth/authorize/",
    tokenEndpoint: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: String(process.env.TIKTOK_OAUTH_SCOPES || "user.info.basic video.publish").split(/[ ,]+/).filter(Boolean)
  },
  threads: {
    name: "Threads",
    clientId: process.env.THREADS_OAUTH_APP_ID,
    clientSecret: process.env.THREADS_OAUTH_APP_SECRET,
    authorizationEndpoint: "https://threads.net/oauth/authorize",
    tokenEndpoint: "https://graph.threads.net/oauth/access_token",
    scopes: String(process.env.THREADS_OAUTH_SCOPES || "threads_basic threads_content_publish").split(/[ ,]+/).filter(Boolean)
  },
  facebook: {
    name: "Facebook / Instagram",
    clientId: process.env.META_OAUTH_APP_ID,
    clientSecret: process.env.META_OAUTH_APP_SECRET,
    authorizationEndpoint: "https://www.facebook.com/" + META_VERSION + "/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/" + META_VERSION + "/oauth/access_token",
    scopes: String(process.env.META_OAUTH_SCOPES || "pages_show_list,pages_read_engagement,pages_manage_posts").split(/[ ,]+/).filter(Boolean)
  }
};

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function callbackUrl(provider) {
  return publicBase() + "/api/studio/oauth/" + provider + "/callback";
}

function providerConfig(provider) {
  const config = providers[provider];
  if (!config) throw new Error("Unsupported OAuth provider: " + provider);
  if (!config.clientId || !config.clientSecret) throw new Error(providerConfigMessage(provider));
  if (!publicBase() || !/^https:\/\//i.test(publicBase())) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS URL before social OAuth can be used.");
  }
  return config;
}

function providerConfigMessage(provider) {
  const names = {
    google: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
    linkedin: "LINKEDIN_OAUTH_CLIENT_ID and LINKEDIN_OAUTH_CLIENT_SECRET",
    tiktok: "TIKTOK_OAUTH_CLIENT_KEY and TIKTOK_OAUTH_CLIENT_SECRET",
    threads: "THREADS_OAUTH_APP_ID and THREADS_OAUTH_APP_SECRET",
    facebook: "META_OAUTH_APP_ID and META_OAUTH_APP_SECRET"
  };
  return "OAuth is not configured for " + provider + ". Set " + (names[provider] || "the provider client settings") + ".";
}

function stateHash(state) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

async function exchange(config, params) {
  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data.error) {
    throw new Error((data.error_description || data.error?.message || data.error || "OAuth token exchange failed") + "");
  }
  return data;
}

async function getJson(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data.error) throw new Error(data.error?.message || data.error_description || "OAuth provider request failed.");
  return data;
}

async function saveConnectedAccount({ workspaceId, provider, platform: platformOverride, name, externalId, payload, metadata = {} }) {
  const credentialName = "oauth:" + provider + ":" + String(externalId || name).replace(/[^a-zA-Z0-9._:-]/g, "-");
  await saveCredential(workspaceId, credentialName, payload);
  const existing = await query(
    "SELECT id FROM social_accounts WHERE workspace_id=$1 AND platform=$2 AND external_account_id=$3",
    [workspaceId, platformOverride || (provider === "google" ? "youtube" : provider === "facebook" ? "facebook" : provider), externalId]
  );
  const platform = platformOverride || (provider === "google" ? "youtube" : provider === "facebook" ? "facebook" : provider);
  if (existing.rows[0]) {
    const updated = await query(
      "UPDATE social_accounts SET name=$2,credential_ref=$3,metadata_json=$4::jsonb,status='connected',updated_at=now() WHERE id=$1 RETURNING id,name,platform,external_account_id,status,credential_ref,metadata_json",
      [existing.rows[0].id, name, credentialName, JSON.stringify(metadata)]
    );
    return updated.rows[0];
  }
  const created = await query(
    "INSERT INTO social_accounts (workspace_id,platform,name,external_account_id,credential_ref,metadata_json,status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'connected') RETURNING id,name,platform,external_account_id,status,credential_ref,metadata_json",
    [workspaceId, platform, name, externalId, credentialName, JSON.stringify(metadata)]
  );
  return created.rows[0];
}

async function connectGoogle(workspaceId, token) {
  const channels = await getJson("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", token.access_token);
  const channel = channels.items?.[0];
  if (!channel?.id) throw new Error("Google authorization succeeded, but no YouTube channel was found for this account.");
  return [await saveConnectedAccount({
    workspaceId,
    provider: "google",
    name: channel.snippet?.title || "YouTube channel",
    externalId: channel.id,
    payload: {
      clientId: providers.google.clientId,
      clientSecret: providers.google.clientSecret,
      refreshToken: token.refresh_token,
      accessToken: token.access_token,
      channelId: channel.id,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
    },
    metadata: { providerAccount: "google", channelTitle: channel.snippet?.title || "", scope: token.scope || "" }
  })];
}

async function connectLinkedIn(workspaceId, token) {
  const profile = await getJson("https://api.linkedin.com/v2/userinfo", token.access_token);
  const id = profile.sub;
  if (!id) throw new Error("LinkedIn authorization succeeded, but the member identifier was unavailable.");
  return [await saveConnectedAccount({
    workspaceId,
    provider: "linkedin",
    name: profile.name || "LinkedIn member",
    externalId: id,
    payload: {
      accessToken: token.access_token,
      clientId: providers.linkedin.clientId,
      clientSecret: providers.linkedin.clientSecret,
      authorUrn: "urn:li:person:" + id,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000
    },
    metadata: { providerAccount: "linkedin", email: profile.email || "", scope: token.scope || "" }
  })];
}

async function connectTikTok(workspaceId, token) {
  const id = token.open_id;
  if (!id) throw new Error("TikTok authorization succeeded, but open_id was unavailable.");
  let profile = {};
  try { profile = (await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", token.access_token)).data || {}; } catch {}
  return [await saveConnectedAccount({
    workspaceId,
    provider: "tiktok",
    name: profile.display_name || "TikTok account",
    externalId: id,
    payload: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      openId: id,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
      refreshExpiresAt: Date.now() + Number(token.refresh_expires_in || 0) * 1000
    },
    metadata: { providerAccount: "tiktok", displayName: profile.display_name || "", scope: token.scope || "" }
  })];
}

async function connectFacebook(workspaceId, token) {
  const pages = await getJson("https://graph.facebook.com/" + META_VERSION + "/me/accounts?fields=id,name,access_token&access_token=" + encodeURIComponent(token.access_token));
  const results = [];
  for (const page of pages.data || []) {
    const pageToken = page.access_token;
    const metadata = { providerAccount: "facebook", pageName: page.name || "", graphVersion: META_VERSION };
    results.push(await saveConnectedAccount({
      workspaceId,
      provider: "facebook",
      name: page.name || "Facebook Page",
      externalId: page.id,
      payload: { pageId: page.id, pageAccessToken: pageToken, userAccessToken: token.access_token },
      metadata
    }));

    try {
      const linked = await getJson("https://graph.facebook.com/" + META_VERSION + "/" + page.id + "?fields=instagram_business_account&access_token=" + encodeURIComponent(pageToken));
      const ig = linked.instagram_business_account?.id;
      if (ig) results.push(await saveConnectedAccount({
        workspaceId,
        provider: "facebook",
        platform: "instagram",
        name: page.name + " · Instagram",
        externalId: "instagram:" + ig,
        payload: { igUserId: ig, accessToken: pageToken, pageId: page.id },
        metadata: { ...metadata, providerAccount: "instagram", instagramUserId: ig }
      }));
    } catch {}
  }
  if (!results.length) throw new Error("Facebook authorization succeeded, but no accessible Pages were returned.");
  return results;
}

async function exchangeThreadsLongLived(shortToken) {
  const config = providers.threads;
  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("access_token", shortToken);
  const response = await fetch(url);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error) throw new Error(data.error?.message || data.error_description || "Threads long-lived token exchange failed.");
  return data;
}

async function connectThreads(workspaceId, token) {
  const longLived = await exchangeThreadsLongLived(token.access_token);
  const profile = await getJson("https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url", longLived.access_token);
  if (!profile?.id) throw new Error("Threads authorization succeeded, but no Threads user ID was returned.");
  const issuedAt = Date.now();
  return [await saveConnectedAccount({
    workspaceId,
    provider: "threads",
    platform: "threads",
    name: profile.username ? "@" + profile.username : "Threads account",
    externalId: profile.id,
    payload: {
      threadsUserId: profile.id,
      accessToken: longLived.access_token,
      issuedAt,
      expiresAt: issuedAt + Number(longLived.expires_in || 5184000) * 1000
    },
    metadata: { providerAccount: "threads", username: profile.username || "", scope: token.scope || "" }
  })];
}

export function listOAuthProviders() {
  return Object.entries(providers).map(([id, value]) => ({
    id,
    name: value.name,
    configured: Boolean(value.clientId && value.clientSecret)
  }));
}

export async function startOAuth({ provider, workspaceId, userId }) {
  if (!workspaceId || !userId) throw new Error("Sign in to Auto-Media before connecting a social account.");
  const config = providerConfig(provider);
  const state = crypto.randomBytes(32).toString("base64url");
  await query("DELETE FROM oauth_states WHERE expires_at < now()");
  await query(
    "INSERT INTO oauth_states (state_hash,provider,workspace_id,user_id,redirect_path,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')",
    [stateHash(state), provider, workspaceId, userId, "/#/accounts?oauth=complete"]
  );
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(provider === "facebook" || provider === "threads" ? "," : " "));
  url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (provider === "tiktok") url.searchParams.set("disable_auto_auth", "0");
  return { authorizationUrl: url.toString() };
}

export async function finishOAuth({ provider, state, code, error, errorDescription }) {
  if (error) throw new Error("OAuth authorization was rejected: " + (errorDescription || error));
  if (!state || !code) throw new Error("OAuth callback did not include state and code.");
  const found = await query(
    "SELECT * FROM oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at > now() LIMIT 1",
    [stateHash(state), provider]
  );
  if (!found.rows[0]) throw new Error("OAuth state is invalid or expired.");
  const stateRow = found.rows[0];
  await query("DELETE FROM oauth_states WHERE id=$1", [stateRow.id]);
  const config = providerConfig(provider);
  const token = await exchange(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: callbackUrl(provider),
    grant_type: "authorization_code"
  });
  if (!token.refresh_token && provider === "google") throw new Error("Google did not return a refresh token. Re-authorize with consent enabled.");
  let accounts;
  if (provider === "google") accounts = await connectGoogle(stateRow.workspace_id, token);
  else if (provider === "linkedin") accounts = await connectLinkedIn(stateRow.workspace_id, token);
  else if (provider === "tiktok") accounts = await connectTikTok(stateRow.workspace_id, token);
  else if (provider === "threads") accounts = await connectThreads(stateRow.workspace_id, token);
  else accounts = await connectFacebook(stateRow.workspace_id, token);
  return { provider, workspaceId: stateRow.workspace_id, accounts };
}
