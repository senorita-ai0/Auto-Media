import crypto from "node:crypto";
import { query } from "./db.mjs";

function masterKey() {
  const value = String(process.env.CREDENTIALS_MASTER_KEY || "");
  if (!value) throw new Error("CREDENTIALS_MASTER_KEY is not configured.");
  return crypto.createHash("sha256").update(value).digest();
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(x => x.toString("base64url")).join(".");
}

function open(value) {
  const [ivRaw, tagRaw, ciphertextRaw] = String(value).split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error("Invalid encrypted credential.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final()
  ]).toString("utf8"));
}

export async function saveCredential(workspaceId, name, payload) {
  if (!name) throw new Error("Credential name is required.");
  if (!payload || typeof payload !== "object") throw new Error("Credential payload must be an object.");
  const encrypted = seal(payload);
  const result = await query(
    "INSERT INTO credentials (workspace_id, name, encrypted_payload) VALUES ($1,$2,$3) ON CONFLICT (workspace_id,name) DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload, updated_at = now() RETURNING id,name,created_at,updated_at",
    [workspaceId, name, encrypted]
  );
  return result.rows[0];
}

export async function loadCredential(workspaceId, name) {
  if (!name) return null;
  const result = await query(
    "SELECT encrypted_payload FROM credentials WHERE workspace_id = $1 AND name = $2",
    [workspaceId, name]
  );
  if (!result.rows[0]) return null;
  return open(result.rows[0].encrypted_payload);
}

export async function listCredentialNames(workspaceId) {
  const result = await query(
    "SELECT id,name,created_at,updated_at FROM credentials WHERE workspace_id = $1 ORDER BY name",
    [workspaceId]
  );
  return result.rows;
}

export async function deleteCredential(workspaceId, name) {
  await query("DELETE FROM credentials WHERE workspace_id = $1 AND name = $2", [workspaceId, name]);
}
