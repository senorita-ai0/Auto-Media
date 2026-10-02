import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { Agent } from "@atproto/api";
import { query } from "./db.mjs";
import { loadCredential, saveCredential } from "./credentialVault.mjs";
import crypto from "node:crypto";

const clients = new Map();
const locks = new Map();

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function metadata() {
  const base = publicBase();
  return {
    client_id: base + "/api/studio/oauth/bluesky/client-metadata.json",
    client_name: "Auto-Media",
    client_uri: base,
    redirect_uris: [base + "/api/studio/oauth/bluesky/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    scope: String(process.env.BLUESKY_OAUTH_SCOPE || "atproto repo:app.bsky.feed.post?action=create rpc:app.bsky.actor.getProfile").trim(),
    response_types: ["code"],
    application_type: "web",
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true
  };
}

function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  locks.set(key, current);
  return previous.then(fn).finally(() => {
    if (locks.get(key) === current) {
      locks.delete(key);
      release();
    }
  });
}

function stateHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function makeClient(workspaceId, userId = "runtime") {
  const clientKey = workspaceId + ":" + userId;
  if (clients.has(clientKey)) return clients.get(clientKey);

  const client = new NodeOAuthClient({
    clientMetadata: metadata(),
    stateStore: {
      async set(key, internalState) {
        await query(
          "INSERT INTO oauth_states (state_hash,provider,workspace_id,user_id,provider_config_json,expires_at) VALUES ($1,'bluesky',$2,$3,$4::jsonb,now()+interval '15 minutes') ON CONFLICT (state_hash) DO UPDATE SET provider_config_json=EXCLUDED.provider_config_json,expires_at=EXCLUDED.expires_at",
          [stateHash(key), workspaceId, userId, JSON.stringify(internalState)]
        );
      },
      async get(key) {
        const result = await query(
          "SELECT provider_config_json FROM oauth_states WHERE state_hash=$1 AND provider='bluesky' AND workspace_id=$2 AND expires_at>now()",
          [stateHash(key), workspaceId]
        );
        return result.rows[0]?.provider_config_json || undefined;
      },
      async del(key) {
        await query(
          "DELETE FROM oauth_states WHERE state_hash=$1 AND provider='bluesky' AND workspace_id=$2",
          [stateHash(key), workspaceId]
        );
      }
    },
    sessionStore: {
      async set(sub, session) {
        await saveCredential(workspaceId, "oauth:bluesky:session:" + sub, session);
      },
      async get(sub) {
        return loadCredential(workspaceId, "oauth:bluesky:session:" + sub);
      },
      async del(sub) {
        try {
          await query(
            "DELETE FROM credentials WHERE workspace_id=$1 AND name=$2",
            [workspaceId, "oauth:bluesky:session:" + sub]
          );
        } catch {}
      }
    },
    requestLock: (key, fn) => withLock(workspaceId + ":" + key, fn)
  });

  clients.set(clientKey, client);
  return client;
}

export function blueskyMetadata() {
  return metadata();
}

export async function startBlueskyOAuth({ workspaceId, userId, handle }) {
  if (!workspaceId || !userId) throw new Error("Workspace and user are required.");
  if (!publicBase() || !/^https:\/\//i.test(publicBase())) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS URL before Bluesky OAuth can be used.");
  }
  const normalized = String(handle || "").trim();
  if (!normalized) throw new Error("Enter a Bluesky handle or DID.");

  const client = await makeClient(workspaceId, userId);
  const state = crypto.randomBytes(32).toString("base64url");
  const authorizationUrl = await client.authorize(normalized, {
    state,
    scope: metadata().scope
  });
  return { authorizationUrl, state };
}

export async function finishBlueskyOAuth({ state, searchParams }) {
  if (!state) throw new Error("Bluesky callback is missing state.");
  const lookup = await query(
    "SELECT * FROM oauth_states WHERE state_hash=$1 AND provider='bluesky' AND expires_at>now() LIMIT 1",
    [stateHash(state)]
  );
  if (!lookup.rows[0]) throw new Error("Bluesky OAuth state is invalid or expired.");

  const workspaceId = lookup.rows[0].workspace_id;
  const userId = lookup.rows[0].user_id;
  const client = await makeClient(workspaceId, userId);
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || {});
  const { session } = await client.callback(params);
  if (!session?.did) throw new Error("Bluesky OAuth did not return an account DID.");

  const agent = new Agent(session);
  const profile = await agent.getProfile({ actor: session.did });
  const handle = profile.data?.handle || "";
  const name = handle ? "@" + handle : (profile.data?.displayName || session.did);
  const credentialRef = "oauth:bluesky:session:" + session.did;

  await saveCredential(workspaceId, credentialRef, session);

  const existing = await query(
    "SELECT id FROM social_accounts WHERE workspace_id=$1 AND platform='bluesky' AND external_account_id=$2",
    [workspaceId, session.did]
  );

  let account;
  const metadataJson = JSON.stringify({ handle, did: session.did });
  if (existing.rows[0]) {
    const updated = await query(
      "UPDATE social_accounts SET name=$2,credential_ref=$3,metadata_json=$4::jsonb,status='connected',updated_at=now() WHERE id=$1 RETURNING id,name,platform,external_account_id,status,credential_ref,metadata_json",
      [existing.rows[0].id, name, credentialRef, metadataJson]
    );
    account = updated.rows[0];
  } else {
    const created = await query(
      "INSERT INTO social_accounts (workspace_id,platform,name,external_account_id,credential_ref,metadata_json,status) VALUES ($1,'bluesky',$2,$3,$4,$5::jsonb,'connected') RETURNING id,name,platform,external_account_id,status,credential_ref,metadata_json",
      [workspaceId, name, session.did, credentialRef, metadataJson]
    );
    account = created.rows[0];
  }

  await query(
    "DELETE FROM oauth_states WHERE state_hash=$1 AND provider='bluesky'",
    [stateHash(state)]
  );
  return { workspaceId, account };
}

export async function getBlueskyAgent(workspaceId, did) {
  if (!workspaceId || !did) throw new Error("Bluesky workspace and DID are required.");
  const client = await makeClient(workspaceId);
  const session = await client.restore(did);
  if (!session) throw new Error("Bluesky OAuth session is not available. Reconnect the account.");
  return new Agent(session);
}
