import { query } from "./db.mjs";
import { loadCredential } from "./credentialVault.mjs";
import { getGoogleAccessToken } from "./youtube.mjs";

async function getJson(url, token, headers = {}) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token, ...headers } });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error || data.message) throw new Error(data.error?.message || data.error_description || data.message || "Provider rejected the account check.");
  return data;
}

export async function testSocialAccount(account) {
  const credential = await loadCredential(account.workspace_id, account.credential_ref);
  if (!credential) throw new Error("No encrypted credential is stored for this account.");

  switch (account.platform) {
    case "facebook":
      await getJson("https://graph.facebook.com/" + String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v") + "/" + (credential.pageId || account.external_account_id), credential.pageAccessToken || credential.accessToken);
      return { ok: true, label: "Facebook Page token accepted" };
    case "instagram":
      await getJson("https://graph.facebook.com/" + String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v") + "/" + (credential.igUserId || account.external_account_id) + "?fields=id,username", credential.accessToken);
      return { ok: true, label: "Instagram account accepted" };
    case "youtube":
      await getGoogleAccessToken({ clientId: credential.clientId, clientSecret: credential.clientSecret, refreshToken: credential.refreshToken });
      return { ok: true, label: "YouTube refresh token accepted" };
    case "linkedin":
      await getJson("https://api.linkedin.com/v2/userinfo", credential.accessToken);
      return { ok: true, label: "LinkedIn token accepted" };
    case "tiktok":
      await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", credential.accessToken);
      return { ok: true, label: "TikTok token accepted" };
    case "threads":
      await getJson("https://graph.threads.net/v1.0/me?fields=id,username", credential.accessToken);
      return { ok: true, label: "Threads token accepted" };
    case "pinterest":
      await getJson("https://api.pinterest.com/v5/user_account", credential.accessToken);
      return { ok: true, label: "Pinterest token accepted" };
    case "x":
      await getJson("https://api.x.com/2/users/me?user.fields=id,username", credential.accessToken);
      return { ok: true, label: "X token accepted" };
    case "mastodon":
      await getJson(String(credential.instance).replace(/\/+$/, "") + "/api/v1/accounts/verify_credentials", credential.accessToken);
      return { ok: true, label: "Mastodon token accepted" };
    case "reddit":
      await getJson("https://oauth.reddit.com/api/v1/meidentity", credential.accessToken);
      return { ok: true, label: "Reddit token accepted" };
    case "telegram": {
      const response = await fetch("https://api.telegram.org/bot" + credential.botToken + "/getMe");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.description || "Telegram bot token was rejected.");
      return { ok: true, label: "Telegram bot token accepted" };
    }
    case "discord": {
      const response = await fetch(credential.webhookUrl || "");
      if (!response.ok) throw new Error("Discord webhook is not reachable.");
      return { ok: true, label: "Discord webhook reachable" };
    }
    default:
      throw new Error("No connection test is implemented for " + account.platform + ".");
  }
}

export async function markAccountTest(accountId, success) {
  await query(
    "UPDATE social_accounts SET status=$2,updated_at=now() WHERE id=$1",
    [accountId, success ? "connected" : "error"]
  );
}
