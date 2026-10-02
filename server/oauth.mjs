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
  pinterest: {
    name: "Pinterest",
    clientId: process.env.PINTEREST_OAUTH_APP_ID,
    clientSecret: process.env.PINTEREST_OAUTH_APP_SECRET,
    authorizationEndpoint: "https://www.pinterest.com/oauth/",
    tokenEndpoint: "https://api.pinterest.com/v5/oauth/token",
    scopes: String(process.env.PINTEREST_OAUTH_SCOPES || "boards:read boards:write pins:read pins:write").split(/[ ,]+/).filter(Boolean)
  },
  threads: {
    name: "Threads",
    clientId: process.env.THREADS_OAUTH_APP_ID,
    clientSecret: process.env.THREADS_OAUTH_APP_SECRET,
    authorizationEndpoint: "https://threads.net/oauth/authorize",
    tokenEndpoint: "https://graph.threads.net/oauth/access_token",
    scopes: String(process.env.THREADS_OAUTH_SCOPES || "threads_basic threads_content_publish").split(/[ ,]+/).filter(Boolean)
  },
  mastodon: {
    name: "Mastodon",
    dynamic: true,
    scopes: ["read", "write:media", "write:statuses"]
  },
  x: {
    name: "X",
    clientId: process.env.X_OAUTH_CLIENT_ID,
    clientSecret: process.env.X_OAUTH_CLIENT_SECRET,
    authorizationEndpoint: "https://x.com/i/oauth2/authorize",
    tokenEndpoint: "https://api.x.com/2/oauth2/token",
    scopes: String(process.env.X_OAUTH_SCOPES || "tweet.read tweet.write users.read offline.access media.write").split(/[ ,]+/).filter(Boolean)
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

async function mastodonConfig(workspaceId, instance) {
  let base;
  try {
    base = new URL(String(instance || "").trim());
  } catch { throw new Error("Enter a valid Mastodon instance URL, such as https://mastodon.social."); }
  if (base.protocol !== "https:") throw new Error("Mastodon instances must use HTTPS.");
  const origin = base.origin;
  let metadata = {};
  try {
    const response = await fetch(origin + "/.well-known/oauth-authorization-server", { headers: { Accept: "application/json" } });
    if (response.ok) metadata = await response.json();
  } catch {}

  const authorizationEndpoint = metadata.authorization_endpoint || origin + "/oauth/authorize";
  const tokenEndpoint = metadata.token_endpoint || origin + "/oauth/token";
  const hostKey = base.host.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  const appRef = "oauth:mastodon:app:" + hostKey;
  let app = null;
  try { app = await (await import("./credentialVault.mjs")).loadCredential(workspaceId, appRef); } catch {}

  if (!app?.clientId || !app?.clientSecret) {
    const form = new URLSearchParams({
      client_name: "Auto-Media",
      redirect_uris: publicBase() + "/api/studio/oauth/mastodon/callback",
      scopes: "read write:media write:statuses",
      website: publicBase()
    });
    const response = await fetch(origin + "/api/v1/apps", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok || !data.client_id || !data.client_secret) throw new Error(data.error || data.error_description || "Mastodon app registration failed on this instance.");
    app = { clientId: data.client_id, clientSecret: data.client_secret, instance: origin };
    await (await import("./credentialVault.mjs")).saveCredential(workspaceId, appRef, app);
  }

  return { instance: origin, authorizationEndpoint, tokenEndpoint, scopes: ["read", "write:media", "write:statuses"], clientId: app.clientId, clientSecret: app.clientSecret, appRef };
}

async function connectReddit(workspaceId, token, config) {
  const me = await getJson("https://oauth.reddit.com/api/v1/meidentity", token.access_token);
  const username = me.name || me.subreddit?.display_name_prefixed || "Reddit account";
  const subreddit = String(config?.subreddit || "").replace(/^r\//i, "").trim();
  if (!subreddit) throw new Error("Reddit subreddit is required when connecting the account.");
  return [await saveConnectedAccount({
    workspaceId,
    provider: "reddit",
    platform: "reddit",
    name: "u/" + username + " · r/" + subreddit,
    externalId: username,
    payload: {
      oauthVersion: 2,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      clientId: providers.reddit.clientId,
      clientSecret: providers.reddit.clientSecret,
      username,
      subreddit,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
    },
    metadata: { providerAccount: "reddit", username, subreddit, scope: token.scope || "" }
  })];
}

async function connectMastodon(workspaceId, token, config) {
  const response = await getJson(config.instance + "/api/v1/accounts/verify_credentials", token.access_token);
  if (!response?.id) throw new Error("Mastodon authorization succeeded, but the account ID was unavailable.");
  return [await saveConnectedAccount({
    workspaceId,
    provider: "mastodon",
    platform: "mastodon",
    name: response.acct ? "@" + response.acct : (response.display_name || "Mastodon account"),
    externalId: response.id,
    payload: {
      oauthVersion: 2,
      accessToken: token.access_token,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      instance: config.instance,
      accountId: response.id,
      acct: response.acct || "",
      scope: token.scope || ""
    },
    metadata: { providerAccount: "mastodon", instance: config.instance, acct: response.acct || "" }
  })];
}

function providerConfigMessage(provider) {
  const names = {
    google: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
    linkedin: "LINKEDIN_OAUTH_CLIENT_ID and LINKEDIN_OAUTH_CLIENT_SECRET",
    tiktok: "TIKTOK_OAUTH_CLIENT_KEY and TIKTOK_OAUTH_CLIENT_SECRET",
    threads: "THREADS_OAUTH_APP_ID and THREADS_OAUTH_APP_SECRET",
    x: "X_OAUTH_CLIENT_ID and X_OAUTH_CLIENT_SECRET",
    pinterest: "PINTEREST_OAUTH_APP_ID and PINTEREST_OAUTH_APP_SECRET",
    reddit: "REDDIT_OAUTH_CLIENT_ID and REDDIT_OAUTH_CLIENT_SECRET",
    facebook: "META_OAUTH_APP_ID and META_OAUTH_APP_SECRET"
  };
  return "OAuth is not configured for " + provider + ". Set " + (names[provider] || "the provider client settings") + ".";
}

function stateHash(state) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function createPkce() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function exchange(config, params) {
  const basic = params._basic;
  const bodyParams = { ...params };
  delete bodyParams._basic;
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (basic) headers.Authorization = "Basic " + basic;
  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers,
    body: new URLSearchParams(bodyParams)
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

async function connectPinterest(workspaceId, token) {
  const profile = await getJson("https://api.pinterest.com/v5/user_account", token.access_token);
  const boardsResponse = await getJson("https://api.pinterest.com/v5/boards?page_size=100", token.access_token);
  const boards = Array.isArray(boardsResponse.items) ? boardsResponse.items : [];
  if (!boards.length) throw new Error("Pinterest authorization succeeded, but no boards were returned.");
  return Promise.all(boards.map(board => saveConnectedAccount({
    workspaceId,
    provider: "pinterest",
    platform: "pinterest",
    name: (profile.username || profile.business_name || "Pinterest") + " · " + (board.name || "Board"),
    externalId: board.id,
    payload: {
      boardId: board.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      clientId: providers.pinterest.clientId,
      clientSecret: providers.pinterest.clientSecret,
      issuedAt: Date.now(),
      expiresAt: Date.now() + Number(token.expires_in || 2592000) * 1000,
      refreshExpiresAt: Date.now() + Number(token.refresh_token_expires_in || 31536000) * 1000
    },
    metadata: { providerAccount: "pinterest", boardName: board.name || "", username: profile.username || "", scope: token.scope || "" }
  })));
}

async function connectX(workspaceId, token) {
  const profile = await getJson("https://api.x.com/2/users/me?user.fields=id,name,username", token.access_token);
  const user = profile.data || {};
  if (!user.id) throw new Error("X authorization succeeded, but the X user ID was unavailable.");
  return [await saveConnectedAccount({
    workspaceId,
    provider: "x",
    platform: "x",
    name: user.username ? "@" + user.username : (user.name || "X account"),
    externalId: user.id,
    payload: {
      oauthVersion: 2,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      clientId: providers.x.clientId,
      clientSecret: providers.x.clientSecret,
      userId: user.id,
      username: user.username || "",
      expiresAt: Date.now() + Number(token.expires_in || 7200) * 1000
    },
    metadata: { providerAccount: "x", username: user.username || "", scope: token.scope || "" }
  })];
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
    dynamic: Boolean(value.dynamic),
    configured: Boolean(value.dynamic || (value.clientId && value.clientSecret))
  }));
}

export async function startOAuth({ provider, workspaceId, userId, instance = null, subreddit = null }) {
  if (!workspaceId || !userId) throw new Error("Sign in to Auto-Media before connecting a social account.");
  const dynamicConfig = provider === "mastodon" ? await mastodonConfig(workspaceId, instance) : provider === "reddit" ? { ...providers.reddit, subreddit: String(subreddit || "").replace(/^r\\//i, "").trim() } : null;
  const config = dynamicConfig || providerConfig(provider);
  if (provider === "reddit" && (!dynamicConfig?.subreddit || !config.clientId || !config.clientSecret)) throw new Error("Reddit OAuth requires app credentials and a subreddit.");
  const state = crypto.randomBytes(32).toString("base64url");
  await query("DELETE FROM oauth_states WHERE expires_at < now()");
  await query(
    "INSERT INTO oauth_states (state_hash,provider,workspace_id,user_id,redirect_path,provider_config_json,expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '10 minutes')",
    [stateHash(state), provider, workspaceId, userId, "/#/accounts?oauth=complete", JSON.stringify(dynamicConfig || {})]
  );
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(provider === "facebook" || provider === "threads" ? "," : " "));
  url.searchParams.set("state", state);
  if (provider === "x") {
    const pkce = createPkce();
    await query("UPDATE oauth_states SET code_verifier=$2 WHERE state_hash=$1", [stateHash(state), pkce.verifier]);
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
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
  const membership = await query("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [stateRow.workspace_id, stateRow.user_id]);
  if (!membership.rows[0] || !["owner","admin"].includes(membership.rows[0].role)) throw new Error("The initiating workspace admin is no longer authorized to connect this account.");
  await query("DELETE FROM oauth_states WHERE id=$1", [stateRow.id]);
  const stateConfig = stateRow.provider_config_json && Object.keys(stateRow.provider_config_json).length ? stateRow.provider_config_json : null;
  let dynamicConfig = stateConfig;
  if (provider === "mastodon") {
    const vault = await import("./credentialVault.mjs");
    const app = await vault.loadCredential(stateRow.workspace_id, stateConfig?.appRef);
    if (!app?.clientId || !app?.clientSecret) throw new Error("Stored Mastodon application credentials are unavailable; reconnect the instance.");
    dynamicConfig = { ...stateConfig, clientId: app.clientId, clientSecret: app.clientSecret };
  }
  if (provider === "reddit") dynamicConfig = { ...(stateConfig || {}) };
  const config = provider === "mastodon" ? dynamicConfig : provider === "reddit" ? { ...providers.reddit, ...dynamicConfig } : providerConfig(provider);
  const tokenParams = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: callbackUrl(provider),
    grant_type: "authorization_code"
  };
  if (provider === "x") tokenParams.code_verifier = stateRow.code_verifier || "";
  const token = await exchange(config, tokenParams);
  if (!token.refresh_token && provider === "google") throw new Error("Google did not return a refresh token. Re-authorize with consent enabled.");
  let accounts;
  if (provider === "google") accounts = await connectGoogle(stateRow.workspace_id, token);
  else if (provider === "linkedin") accounts = await connectLinkedIn(stateRow.workspace_id, token);
  else if (provider === "tiktok") accounts = await connectTikTok(stateRow.workspace_id, token);
  else if (provider === "threads") accounts = await connectThreads(stateRow.workspace_id, token);
  else if (provider === "x") accounts = await connectX(stateRow.workspace_id, token);
  else if (provider === "mastodon") accounts = await connectMastodon(stateRow.workspace_id, token, dynamicConfig);
  else if (provider === "reddit") accounts = await connectReddit(stateRow.workspace_id, token, dynamicConfig);
  else if (provider === "pinterest") accounts = await connectPinterest(stateRow.workspace_id, token);
  else accounts = await connectFacebook(stateRow.workspace_id, token);
  return { provider, workspaceId: stateRow.workspace_id, accounts };
}
