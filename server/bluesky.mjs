import { Agent } from "@atproto/api";
import { getBlueskyAgent } from "./blueskyOAuth.mjs";

function textFor(content) {
  return [content.title, content.caption].filter(Boolean).join("\n\n").trim().slice(0, 300);
}

export async function postToBluesky({ workspaceId, did, content, buffer, mimeType, filename }) {
  if (!workspaceId || !did) throw new Error("Bluesky account DID and workspace are required.");
  const agent = await getBlueskyAgent(workspaceId, did);
  const text = textFor(content);
  if (!text) throw new Error("Bluesky requires non-empty post text.");

  let embed;

  if (String(mimeType || "").startsWith("video/")) {
    if ((buffer?.byteLength || 0) > 300000000) throw new Error("Bluesky videos may be up to 300 MB.");
    if (String(mimeType || "").toLowerCase() !== "video/mp4") throw new Error("Bluesky video publishing currently requires MP4 media.");

    const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
      aud: "did:web:video.bsky.app",
      lxm: "com.atproto.repo.uploadBlob",
      exp: Math.floor(Date.now() / 1000) + 30 * 60
    });
    if (!serviceAuth?.token) throw new Error("Bluesky did not return a video upload service token.");

    const uploadUrl = new URL("https://video.bsky.app/xrpc/app.bsky.video.uploadVideo");
    uploadUrl.searchParams.set("did", did);
    uploadUrl.searchParams.set("name", filename || "video.mp4");

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + serviceAuth.token,
        "Content-Type": "video/mp4",
        "Content-Length": String(buffer.byteLength)
      },
      body: buffer
    });
    const raw = await uploadResponse.text();
    let status = {};
    try { status = raw ? JSON.parse(raw) : {}; } catch {}
    if (!uploadResponse.ok || status.error) throw new Error(status.message || status.error || "Bluesky video upload was rejected.");
    const jobStatus = status.jobStatus || status;
    let blob = jobStatus.blob || null;
    const processing = new Agent({ service: "https://video.bsky.app" });
    const started = Date.now();
    while (!blob && Date.now() - started < 120000) {
      const check = await processing.app.bsky.video.getJobStatus({ jobId: jobStatus.jobId });
      const current = check.data?.jobStatus || {};
      if (current.state === "JOB_STATE_FAILED") throw new Error(current.message || current.error || "Bluesky video processing failed.");
      if (current.blob) blob = current.blob;
      if (!blob) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!blob) throw new Error("Bluesky video processing timed out.");
    embed = {
      $type: "app.bsky.embed.video",
      video: blob,
      alt: String(content.title || content.caption || "Auto-Media video").slice(0, 300)
    };
  }
  if (String(mimeType || "").startsWith("image/")) {
    if (!buffer) throw new Error("Bluesky image publishing needs the image bytes.");
    if (buffer.byteLength > 2 * 1024 * 1024) throw new Error("Bluesky image publishing requires images no larger than 2 MB.");
    const upload = await agent.com.atproto.repo.uploadBlob(
      new Blob([buffer], { type: mimeType || "image/png" })
    );
    const blob = upload?.data?.blob;
    if (!blob) throw new Error("Bluesky image upload did not return a blob reference.");
    embed = {
      $type: "app.bsky.embed.images",
      images: [{
        alt: String(content.title || content.caption || "Auto-Media image").slice(0, 300),
        image: blob
      }]
    };
  }

  const result = await agent.post({
    text,
    createdAt: new Date().toISOString(),
    embed
  });

  return {
    uri: result?.uri || null,
    cid: result?.cid || null,
    url: result?.uri ? "https://bsky.app/profile/" + encodeURIComponent(did) + "/post/" + result.uri.split("/").pop() : null
  };
}
