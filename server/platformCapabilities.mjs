const capabilities = {
  facebook: { image: true, video: true },
  instagram: { image: true, video: true },
  youtube: { image: false, video: true },
  tiktok: { image: false, video: true },
  x: { image: false, video: true },
  threads: { image: true, video: true },
  mastodon: { image: false, video: true },
  linkedin: { image: false, video: true },
  pinterest: { image: false, video: true },
  reddit: { image: false, video: true },
  telegram: { image: false, video: true },
  discord: { image: false, video: true },
  bluesky: { image: true, video: true }
};

export function getPlatformCapabilities(platform) {
  return capabilities[String(platform || "").toLowerCase()] || { image: false, video: false };
}

export function listPlatformCapabilities() {
  return Object.entries(capabilities).map(([platform, support]) => ({ platform, ...support }));
}

export function supportsMedia(platform, kind) {
  return Boolean(getPlatformCapabilities(platform)[kind]);
}
