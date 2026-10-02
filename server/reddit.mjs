// Reddit's flow has two things the other platforms don't:
//   1. Auth uses a "script" app's password grant (client id/secret +
//      Reddit username/password) - no interactive redirect needed, which
//      fits this app's "paste credentials" model. Reddit requires a
//      descriptive User-Agent on every call or it will throttle/block you.
//   2. A video post REQUIRES a poster/thumbnail image - there's no way
//      around this on Reddit's side, so this needs the sheet's mapped
//      thumbnail column to be a real image URL.

const USER_AGENT = 'auto-media/1.0 (local posting tool)';

async function getAccessToken({ clientId, clientSecret, username, password }) {
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: 'password', username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.message || data.error || 'Reddit rejected those credentials.');
  }
  return data.access_token;
}

async function leaseMediaAsset({ accessToken, filename, mimetype }) {
  const res = await fetch('https://oauth.reddit.com/api/media/asset.json', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ filepath: filename, mimetype }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Reddit rejected the media lease request.');
  return data; // { args: { action, fields: [{name,value}] }, asset: { asset_id, websocket_url } }
}

async function uploadToLease({ lease, buffer, filename }) {
  const { action, fields } = lease.args;
  const form = new FormData();
  fields.forEach((f) => form.append(f.name, f.value));
  form.append('file', new Blob([buffer]), filename);

  const uploadUrl = action.startsWith('http') ? action : `https:${action}`;
  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Reddit rejected the video upload.');

  const key = fields.find((f) => f.name === 'key')?.value;
  return `${uploadUrl}/${key}`;
}

function waitForWebsocketResult(websocketUrl, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(websocketUrl);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('Reddit did not confirm the post within a minute — it may still be processing.'));
      }
    }, timeoutMs);

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'success') {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve(payload.payload?.redirect || null);
        } else if (payload.type === 'failed') {
          settled = true;
          clearTimeout(timer);
          ws.close();
          reject(new Error('Reddit failed to process the video after upload.'));
        }
      } catch {
        /* ignore unrelated frames */
      }
    });
    ws.addEventListener('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Lost connection to Reddit while waiting for the post to finish processing.'));
      }
    });
  });
}

export async function postVideoToReddit({
  clientId,
  clientSecret,
  username,
  password,
  subreddit,
  buffer,
  filename,
  title,
  thumbnailUrl,
}) {
  if (!clientId || !clientSecret || !username || !password || !subreddit) {
    throw new Error('Reddit needs a client ID, client secret, username, password, and subreddit.');
  }
  if (!thumbnailUrl) {
    throw new Error(
      "Reddit requires a poster/thumbnail image for video posts — map this row's thumbnail column to an image URL."
    );
  }

  const accessToken = await getAccessToken({ clientId, clientSecret, username, password });

  const videoLease = await leaseMediaAsset({ accessToken, filename: filename || 'video.mp4', mimetype: 'video/mp4' });
  const videoUrl = await uploadToLease({ lease: videoLease, buffer, filename: filename || 'video.mp4' });

  const res = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      sr: subreddit,
      kind: 'video',
      title: (title || 'Untitled').slice(0, 300),
      url: videoUrl,
      video_poster_url: thumbnailUrl,
      api_type: 'json',
    }),
  });
  const data = await res.json();
  if (!res.ok || data.json?.errors?.length) {
    throw new Error(data.json?.errors?.[0]?.[1] || 'Reddit rejected the post.');
  }

  const websocketUrl = data.json?.data?.websocket_url || videoLease.asset?.websocket_url;
  const redirect = websocketUrl ? await waitForWebsocketResult(websocketUrl).catch(() => null) : null;

  return { url: redirect, submitted: true };
}

export async function postVideoToRedditOAuth({
  accessToken,
  subreddit,
  buffer,
  filename,
  title,
  thumbnailUrl,
}) {
  if (!accessToken || !subreddit) throw new Error("Reddit OAuth access token and subreddit are required.");
  if (!thumbnailUrl) throw new Error("Reddit requires a poster/thumbnail image for video posts.");

  const videoLease = await leaseMediaAsset({ accessToken, filename: filename || "video.mp4", mimetype: "video/mp4" });
  const videoUrl = await uploadToLease({ lease: videoLease, buffer, filename: filename || "video.mp4" });

  const res = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT
    },
    body: new URLSearchParams({
      sr: subreddit,
      kind: "video",
      title: (title || "Untitled").slice(0, 300),
      url: videoUrl,
      video_poster_url: thumbnailUrl,
      api_type: "json"
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.json?.errors?.length) throw new Error(data.json?.errors?.[0]?.[1] || "Reddit rejected the post.");

  const websocketUrl = data.json?.data?.websocket_url || videoLease.asset?.websocket_url;
  const redirect = websocketUrl ? await waitForWebsocketResult(websocketUrl).catch(() => null) : null;
  return { url: redirect, submitted: true };
}

