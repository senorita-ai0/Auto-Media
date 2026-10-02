import crypto from "node:crypto";

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.error) throw new Error(data.error || data.error_description || "Mastodon API request failed.");
  return data;
}

async function uploadMedia({ instance, accessToken, buffer, filename, mimeType }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "video/mp4" }), filename || "video.mp4");
  const response = await fetch(instance + "/api/v2/media", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken },
    body: form
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || !data.id) throw new Error(data.error || "Mastodon rejected the media upload.");
  return data.id;
}

async function waitForMedia({ instance, accessToken, mediaId, attempts = 40 }) {
  for (let i = 0; i < attempts; i++) {
    const data = await requestJson(instance + "/api/v1/media/" + encodeURIComponent(mediaId), {
      headers: { Authorization: "Bearer " + accessToken }
    });
    if (data.url) return data;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error("Mastodon media processing did not finish in time.");
}

export async function postVideoToMastodon({ instance, accessToken, buffer, filename, mimeType, text }) {
  if (!instance || !accessToken) throw new Error("Mastodon instance and access token are required.");
  const mediaId = await uploadMedia({ instance, accessToken, buffer, filename, mimeType });
  const media = await waitForMedia({ instance, accessToken, mediaId });
  const status = await requestJson(instance + "/api/v1/statuses", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": crypto.randomUUID() },
    body: new URLSearchParams({ status: String(text || "").slice(0, 5000), "media_ids[]": mediaId })
  });
  return { statusId: status.id, url: status.url || null };
}
