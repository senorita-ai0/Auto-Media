const CHUNK_SIZE = 3 * 1024 * 1024;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || data.errors?.length || data.detail) {
    const first = data.errors?.[0];
    throw new Error(first?.detail || first?.message || data.detail || data.message || "X API request failed.");
  }
  return data;
}

async function initialize({ accessToken, totalBytes, mimeType }) {
  const data = await requestJson("https://api.x.com/2/media/upload/initialize", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ total_bytes: totalBytes, media_type: mimeType || "video/mp4", media_category: "tweet_video", shared: false })
  });
  const id = data.data?.id;
  if (!id) throw new Error("X did not return a media upload ID.");
  return id;
}

async function append({ accessToken, id, chunk, segmentIndex }) {
  await requestJson("https://api.x.com/2/media/upload/" + encodeURIComponent(id) + "/append", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ media: chunk.toString("base64"), segment_index: segmentIndex })
  });
}

async function finalize({ accessToken, id }) {
  return requestJson("https://api.x.com/2/media/upload/" + encodeURIComponent(id) + "/finalize", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken }
  });
}

async function waitForProcessing({ accessToken, id, attempts = 40 }) {
  for (let i = 0; i < attempts; i++) {
    const params = new URLSearchParams({ media_id: id, command: "STATUS" });
    const data = await requestJson("https://api.x.com/2/media/upload?" + params.toString(), {
      headers: { Authorization: "Bearer " + accessToken }
    });
    const info = data.data?.processing_info;
    if (!info || info.state === "succeeded") return;
    if (info.state === "failed") throw new Error(info.error?.message || "X failed to process the video.");
    await new Promise(resolve => setTimeout(resolve, Math.min(15000, Number(info.check_after_secs || 3) * 1000)));
  }
  throw new Error("X is still processing the video after the allowed wait window.");
}

async function createPost({ accessToken, mediaId, text }) {
  const data = await requestJson("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ text: String(text || "").slice(0, 280), media: { media_ids: [mediaId] } })
  });
  const id = data.data?.id;
  if (!id) throw new Error("X did not return a post ID.");
  return { tweetId: id, url: "https://x.com/i/status/" + id };
}

export async function postVideoToXOAuth2({ accessToken, buffer, text, mimeType = "video/mp4" }) {
  if (!accessToken) throw new Error("X OAuth 2 access token is missing.");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("X requires a non-empty media buffer.");

  const mediaId = await initialize({ accessToken, totalBytes: buffer.length, mimeType });
  for (let offset = 0, segmentIndex = 0; offset < buffer.length; offset += CHUNK_SIZE, segmentIndex++) {
    await append({
      accessToken,
      id: mediaId,
      chunk: buffer.subarray(offset, offset + CHUNK_SIZE),
      segmentIndex
    });
  }

  const finalized = await finalize({ accessToken, id: mediaId });
  if (finalized.data?.processing_info) await waitForProcessing({ accessToken, id: mediaId });
  return createPost({ accessToken, mediaId, text });
}
