const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");

// Posting to a Facebook Page you administer doesn't need App Review as
// long as the Facebook app stays in Development Mode and the person
// generating the token is listed as an admin/developer/tester on that
// app — that's the setup the guide walks through. Public/third-party
// posting would need App Review, which is out of scope here.
export async function postVideoToFacebook({ pageId, pageAccessToken, buffer, filename, title, description }) {
  if (!pageId || !pageAccessToken) {
    throw new Error('Facebook needs a Page ID and a Page access token.');
  }

  const form = new FormData();
  form.append('access_token', pageAccessToken);
  if (title) form.append('title', title.slice(0, 255));
  if (description) form.append('description', description);
  form.append('source', new Blob([buffer]), filename || 'video.mp4');

  const res = await fetch(`https://graph-video.facebook.com/${GRAPH_VERSION}/${pageId}/videos`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Facebook rejected the video.');
  }

  return { url: `https://www.facebook.com/${pageId}/videos/${data.id}`, videoId: data.id };
}
