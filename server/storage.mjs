import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const mode = String(process.env.STORAGE_MODE || "local").toLowerCase();
const root = process.env.MEDIA_ROOT || path.resolve("media");

function s3Configured() {
  return Boolean(
    process.env.S3_BUCKET &&
    process.env.S3_REGION &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

let client = null;

function getClient() {
  if (!s3Configured()) throw new Error("S3 storage is selected but S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are not configured.");
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase() === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
      }
    });
  }
  return client;
}

export function storageMode() {
  if (mode === "s3" && s3Configured()) return "s3";
  return "local";
}

export async function putBuffer({ key, buffer, contentType }) {
  const safeKey = String(key || "").replace(/^\/+/, "");
  if (!safeKey) throw new Error("Storage key is required.");

  if (storageMode() === "s3") {
    await getClient().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: safeKey,
      Body: buffer,
      ContentType: contentType || "application/octet-stream"
    }));
    return {
      storageKey: safeKey,
      publicUrl: process.env.S3_PUBLIC_BASE_URL
        ? String(process.env.S3_PUBLIC_BASE_URL).replace(/\/+$/, "") + "/" + safeKey.split("/").map(encodeURIComponent).join("/")
        : null,
      localPath: null,
      mode: "s3"
    };
  }

  const filePath = path.resolve(root, safeKey);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Storage key must remain inside MEDIA_ROOT.");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  return { storageKey: safeKey, publicUrl: null, localPath: filePath, mode: "local" };
}

export async function getReadUrl(key) {
  const safeKey = String(key || "").replace(/^\/+/, "");
  if (!safeKey) return null;
  if (storageMode() === "s3") {
    if (process.env.S3_PUBLIC_BASE_URL) {
      return String(process.env.S3_PUBLIC_BASE_URL).replace(/\/+$/, "") + "/" + safeKey.split("/").map(encodeURIComponent).join("/");
    }
    return getSignedUrl(getClient(), new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: safeKey
    }), { expiresIn: Math.max(60, Number(process.env.STORAGE_SIGNED_URL_TTL || 3600)) });
  }
  return null;
}

export async function deleteObject(key) {
  const safeKey = String(key || "").replace(/^\/+/, "");
  if (!safeKey) return;
  if (storageMode() === "s3") {
    await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: safeKey }));
    return;
  }
  const filePath = path.resolve(root, safeKey);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Storage key must remain inside MEDIA_ROOT.");
  try { await fs.unlink(filePath); } catch {}
}
