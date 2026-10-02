const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");

// Instagram's Graph API is fundamentally different from every other
// poster here: it does NOT accept uploaded bytes. You give it a video_url
// and Instagram's own servers fetch it. That means:
//   - This only works for rows whose video cell is a real URL (a direct
//     link or a Google Drive share link) - a local-folder filename has
//     no public URL to hand over, and there's no way around that.
//   - A Google Drive link large enough to trigger Drive's "can't scan for
//     viruses" interstitial will fail here even though it works for the
//     platforms that download the bytes themselves - Instagram's fetcher
//     gets that HTML warning page, not the video, and there's no session
//     to click through it with. Small/medium Drive files are fine.

async function createContainer({ igUserId, accessToken, videoUrl, caption }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: caption || '',
      access_token: accessToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Instagram rejected the video container.');
  }
  return data.id;
}

async function waitForContainer({ creationId, accessToken, attempts = 20, delayMs = 5000 }) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${creationId}?fields=status_code,status&access_token=${accessToken}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Could not check Instagram processing status.');
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error(
        data.status ||
          'Instagram failed to process the video - if this is a Google Drive link, the file may be too large for Instagram to fetch directly.'
      );
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Instagram is still processing the video after waiting — try again shortly.');
}

async function publishContainer({ igUserId, accessToken, creationId }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media_publish`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Instagram rejected publishing the container.');
  }
  return data.id;
}

async function getPermalink({ mediaId, accessToken }) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}?fields=permalink&access_token=${accessToken}`
  );
  const data = await res.json().catch(() => ({}));
  return res.ok ? data.permalink : null;
}

export async function postVideoToInstagram({ igUserId, accessToken, videoUrl, caption }) {
  if (!igUserId || !accessToken) {
    throw new Error('Instagram needs an Instagram Business Account ID and an access token.');
  }
  if (!videoUrl) {
    throw new Error('Instagram needs a public video URL for this row.');
  }

  const creationId = await createContainer({ igUserId, accessToken, videoUrl, caption });
  await waitForContainer({ creationId, accessToken });
  const mediaId = await publishContainer({ igUserId, accessToken, creationId });
  const permalink = await getPermalink({ mediaId, accessToken });

  return { url: permalink || null, mediaId };
}
