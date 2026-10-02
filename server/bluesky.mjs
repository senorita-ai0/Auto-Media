import { getBlueskyAgent } from "./blueskyOAuth.mjs";

function textFor(content) {
  return [content.title, content.caption].filter(Boolean).join("\n\n").trim().slice(0, 300);
}

export async function postToBluesky({ workspaceId, did, content, buffer, mimeType, filename }) {
  if (!workspaceId || !did) throw new Error("Bluesky account DID and workspace are required.");
  const agent = await getBlueskyAgent(workspaceId, did);
  const text = textFor(content);
  if (!text) throw new Error("Bluesky requires non-empty post text.");

  if (String(mimeType || "").startsWith("video/")) {
    throw new Error("Bluesky video publishing is not enabled yet; use an image or text content item for this destination.");
  }

  let embed;
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
