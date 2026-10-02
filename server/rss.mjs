function decode(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}
function firstTag(block, names) {
  for (const name of names) { const re = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"); const hit = block.match(re); if (hit?.[1]) return decode(hit[1]); }
  return "";
}
function firstLink(block) { const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i); if (atom?.[1]) return atom[1]; return firstTag(block, ["link", "guid"]); }
function blocks(xml, tag) { return [...String(xml || "").matchAll(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "gi"))].map(m => m[1]); }
export async function readFeed(url, timeoutMs = 15000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Auto-Media/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error("Feed returned " + response.status);
    const xml = await response.text(); const itemBlocks = blocks(xml, "item"); const entryBlocks = itemBlocks.length ? itemBlocks : blocks(xml, "entry");
    const feedTitle = firstTag(xml.slice(0, Math.min(xml.length, 20000)), ["title"]);
    return entryBlocks.map(block => ({ title: firstTag(block, ["title"]), link: firstLink(block), summary: firstTag(block, ["description", "summary", "content"]), publishedAt: firstTag(block, ["pubDate", "published", "updated", "dc:date"]), sourceName: feedTitle || new URL(url).hostname, sourceUrl: url })).filter(x => x.title && x.link);
  } finally { clearTimeout(timer); }
}
export async function collectStories(urls, perFeed = 12) { const results = []; for (const url of urls.filter(Boolean)) { try { results.push(...(await readFeed(url)).slice(0, perFeed)); } catch {} } return results; }
export function selectFreshStory(stories, usedUrls = []) {
  const used = new Set(usedUrls.filter(Boolean).map(String)); const available = stories.filter(x => !used.has(String(x.link))); const pool = available.length ? available : stories;
  if (!pool.length) throw new Error("No stories were found.");
  return [...pool].sort((a,b) => (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0))[0];
}