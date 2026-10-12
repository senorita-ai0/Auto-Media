// Platform-aware post formatting. Pure functions (no I/O) so every rule is unit-testable.
//
// Turns a content item (title, caption, hashtags, optional link) into the exact text a platform will accept:
//   - appends hashtags (previously generated hashtags never reached the published post),
//   - respects each platform's limit using the platform's own way of counting (graphemes; X's weighted count
//     where every URL costs 23),
//   - degrades gracefully: drop trailing hashtags first, then trim the body at a sentence/word boundary,
//     never inside a word, URL, hashtag or emoji,
//   - optionally tags links with UTM parameters,
//   - builds Bluesky rich-text facets so links and hashtags are clickable.

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function graphemes(text) {
  const value = String(text ?? "");
  return segmenter ? Array.from(segmenter.segment(value), part => part.segment) : Array.from(value);
}

export function graphemeLength(text) {
  return graphemes(text).length;
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** Find URLs in text. Trailing sentence punctuation is not part of the URL. */
export function findUrls(text) {
  const value = String(text ?? "");
  const found = [];
  for (const match of value.matchAll(URL_PATTERN)) {
    const trimmed = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) continue;
    found.push({ url: trimmed, start: match.index, end: match.index + trimmed.length });
  }
  return found;
}

const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;

/** Find hashtags in text (outside URLs). Pure-numeric tags such as "#1" are not hashtags. */
export function findHashtags(text) {
  const value = String(text ?? "");
  const urls = findUrls(value);
  const found = [];
  for (const match of value.matchAll(HASHTAG_PATTERN)) {
    const start = match.index + match[1].length;
    if (urls.some(u => start >= u.start && start < u.end)) continue;
    found.push({ tag: match[2], start, end: start + 1 + match[2].length });
  }
  return found;
}

// ---- counting ----

const X_URL_COST = 23;

function xCodePointWeight(codePoint) {
  // twitter-text weighting: most Latin/punctuation ranges weigh 1, everything else (CJK, emoji, ...) weighs 2.
  if (codePoint <= 0x10ff) return 1;
  if (codePoint >= 0x2000 && codePoint <= 0x200d) return 1;
  if (codePoint >= 0x2010 && codePoint <= 0x201f) return 1;
  if (codePoint >= 0x2032 && codePoint <= 0x2037) return 1;
  return 2;
}

export function xWeightedLength(text) {
  const value = String(text ?? "").normalize("NFC");
  const urls = findUrls(value);
  let total = 0;
  let cursor = 0;
  const countPlain = chunk => { for (const ch of chunk) total += xCodePointWeight(ch.codePointAt(0)); };
  for (const u of urls) {
    countPlain(value.slice(cursor, u.start));
    total += X_URL_COST;
    cursor = u.end;
  }
  countPlain(value.slice(cursor));
  return total;
}

export function measureFor(platformRules) {
  return platformRules?.measure === "x" ? xWeightedLength : graphemeLength;
}

// ---- platform rules ----

/**
 * limit        maximum length in the platform's own measure
 * measure      "graphemes" (default) or "x" (weighted, URLs cost 23)
 * mode         "full" = title + caption, "title" = title only, "caption" = caption only (default "full")
 * maxHashtags  most hashtags to append (0 disables)
 * Each value can be overridden per destination through automation_destinations.platform_config_json.
 */
export const PLATFORM_RULES = {
  facebook: { limit: 63206, maxHashtags: 30, mode: "full" },
  instagram: { limit: 2200, maxHashtags: 30, mode: "full" },
  threads: { limit: 500, maxHashtags: 1, mode: "full" },
  mastodon: { limit: 500, maxHashtags: 10, mode: "full" },
  bluesky: { limit: 300, maxHashtags: 5, mode: "full", facets: true },
  x: { limit: 280, measure: "x", maxHashtags: 3, mode: "title" },
  telegram: { limit: 1024, maxHashtags: 15, mode: "full" },
  discord: { limit: 2000, maxHashtags: 15, mode: "full" },
  linkedin: { limit: 3000, maxHashtags: 5, mode: "caption" },
  pinterest: { limit: 500, maxHashtags: 5, mode: "caption" },
  youtube: { limit: 5000, maxHashtags: 15, mode: "caption" },
  tiktok: { limit: 150, maxHashtags: 3, mode: "title" },
  reddit: { limit: 300, maxHashtags: 0, mode: "title" }
};

const FALLBACK_RULES = { limit: 2000, maxHashtags: 10, mode: "full" };

export function rulesFor(platform, overrides = {}) {
  const base = PLATFORM_RULES[String(platform || "").toLowerCase()] || FALLBACK_RULES;
  const merged = { ...base };
  const o = overrides && typeof overrides === "object" ? overrides : {};
  const limit = Number(o.maxChars ?? o.limit);
  if (Number.isFinite(limit) && limit > 0) merged.limit = Math.floor(limit);
  if (o.hashtags === false) merged.maxHashtags = 0;
  const maxHashtags = Number(o.maxHashtags);
  if (o.hashtags !== false && Number.isFinite(maxHashtags) && maxHashtags >= 0) merged.maxHashtags = Math.floor(maxHashtags);
  if (["full", "title", "caption"].includes(o.mode)) merged.mode = o.mode;
  return merged;
}

// ---- hashtags ----

export function normalizeTag(value) {
  const cleaned = String(value ?? "").trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned && /\p{L}|_/u.test(cleaned) ? "#" + cleaned : "";
}

function uniqueTags(list) {
  const input = Array.isArray(list) ? list : String(list ?? "").split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const tag = normalizeTag(raw);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** YouTube tags: comma separated, each <= 30 characters, all together <= 500 characters. */
export function youtubeTags(hashtags) {
  const tags = [];
  let total = 0;
  for (const tag of uniqueTags(hashtags).map(t => t.slice(1)).filter(t => t.length <= 30)) {
    const cost = tag.length + (tags.length ? 1 : 0);
    if (total + cost > 500) break;
    tags.push(tag);
    total += cost;
  }
  return tags.join(",");
}

// ---- UTM ----

/**
 * Add utm_* parameters to every http(s) link in the text. Existing utm_* parameters are never overwritten,
 * and URLs that cannot be parsed are left untouched.
 */
export function applyUtm(text, utm) {
  const value = String(text ?? "");
  if (!utm || typeof utm !== "object") return value;
  const params = {};
  for (const key of ["source", "medium", "campaign", "content", "term"]) {
    const v = String(utm[key] ?? "").trim();
    if (v) params["utm_" + key] = v;
  }
  if (!Object.keys(params).length) return value;
  let out = "";
  let cursor = 0;
  for (const found of findUrls(value)) {
    out += value.slice(cursor, found.start);
    try {
      const url = new URL(found.url);
      for (const [key, v] of Object.entries(params)) if (!url.searchParams.has(key)) url.searchParams.set(key, v);
      out += url.toString();
    } catch {
      out += found.url;
    }
    cursor = found.end;
  }
  return out + value.slice(cursor);
}

// ---- trimming ----

function tidy(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Trim text so measure(result) <= budget. Cuts at a sentence end if one exists in the last ~40% of the text,
 * otherwise at a word boundary, never inside a URL or hashtag, and never splits a grapheme. Appends "…".
 */
export function trimToFit(text, budget, measure = graphemeLength) {
  const value = tidy(text);
  if (measure(value) <= budget) return value;
  const ellipsis = "…";
  const units = graphemes(value);

  // Largest grapheme prefix that fits together with the ellipsis (measure is monotonic in the prefix).
  let low = 0;
  let high = units.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(units.slice(0, mid).join("") + ellipsis) <= budget) low = mid; else high = mid - 1;
  }
  let cut = units.slice(0, low).join("");
  if (!cut) return "";

  // Never cut through a URL or hashtag: back up to where the token starts.
  const tokenSpans = [...findUrls(value), ...findHashtags(value)];
  for (const span of tokenSpans) {
    if (cut.length > span.start && cut.length < span.end) { cut = cut.slice(0, span.start); break; }
  }

  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(".\n"), cut.lastIndexOf("!\n"), cut.lastIndexOf("?\n"));
  if (sentenceEnd >= cut.length * 0.6) {
    cut = cut.slice(0, sentenceEnd + 1);
    return cut.trimEnd() + ellipsis;
  }
  // Cutting exactly at a word boundary (the next character is whitespace) keeps the last word.
  const nextChar = value.charAt(cut.length);
  if (nextChar && !/\s/.test(nextChar)) {
    const lastSpace = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
    if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(/[\s,;:\-–—]+$/u, "");
  return cut + ellipsis;
}

// ---- composition ----

function sameStart(a, b) {
  const x = String(a ?? "").trim().toLowerCase();
  const y = String(b ?? "").trim().toLowerCase();
  return Boolean(x && y && (y.startsWith(x) || x.startsWith(y)));
}

function compose(body, tags, link) {
  return [body, link, tags.join(" ")].filter(part => part && part.trim()).join("\n\n");
}

/**
 * Build the final text for a platform.
 *   { platform, title, caption, hashtags, link, options }
 * options: per-destination overrides (maxChars, maxHashtags, hashtags:false, mode, utm, link:false)
 * Returns { text, hashtags, droppedHashtags, truncated, length, limit, measure }.
 */
export function adaptForPlatform({ platform, title = "", caption = "", hashtags = [], link = "", options = {} }) {
  const rules = rulesFor(platform, options);
  const measure = measureFor(rules);
  const opts = options && typeof options === "object" ? options : {};

  const cleanTitle = tidy(title);
  const cleanCaption = tidy(caption);
  let body;
  if (rules.mode === "title") body = cleanTitle || cleanCaption;
  else if (rules.mode === "caption") body = cleanCaption || cleanTitle;
  else body = sameStart(cleanTitle, cleanCaption) && cleanCaption.length >= cleanTitle.length ? cleanCaption : [cleanTitle, cleanCaption].filter(Boolean).join("\n\n");

  let linkText = opts.link === false ? "" : String(link ?? "").trim();
  if (linkText && body.includes(linkText)) linkText = "";

  if (opts.utm) {
    const defaults = { source: String(platform || ""), medium: "social" };
    const utm = opts.utm === true ? defaults : { ...defaults, ...opts.utm };
    body = applyUtm(body, utm);
    linkText = applyUtm(linkText, utm);
  }

  // Hashtags already written in the body are not repeated.
  const present = new Set(findHashtags(body).map(h => "#" + h.tag.toLowerCase()));
  let tags = uniqueTags(hashtags).filter(t => !present.has(t.toLowerCase())).slice(0, rules.maxHashtags);
  const requested = tags.length;

  let text = compose(body, tags, linkText);
  while (measure(text) > rules.limit && tags.length) {
    tags = tags.slice(0, -1);
    text = compose(body, tags, linkText);
  }
  let truncated = false;
  if (measure(text) > rules.limit) {
    truncated = true;
    // Reserve room for the link (it must stay clickable), then fit the body into what is left.
    const tail = compose("", [], linkText);
    const separator = tail ? 2 : 0;
    const budget = Math.max(0, rules.limit - measure(tail) - separator);
    body = trimToFit(body, budget, measure);
    text = compose(body, [], linkText);
    tags = [];
  }
  return {
    text,
    hashtags: tags,
    droppedHashtags: Math.max(0, requested - tags.length),
    truncated,
    length: measure(text),
    limit: rules.limit,
    measure: rules.measure === "x" ? "x" : "graphemes"
  };
}

// ---- Bluesky rich text ----

const encoder = new TextEncoder();
const byteLength = text => encoder.encode(text).length;

/** Link and tag facets for app.bsky.feed.post. Offsets are UTF-8 byte positions as the protocol requires. */
export function buildBlueskyFacets(text) {
  const value = String(text ?? "");
  const facets = [];
  for (const found of findUrls(value)) {
    facets.push({
      index: { byteStart: byteLength(value.slice(0, found.start)), byteEnd: byteLength(value.slice(0, found.end)) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: found.url }]
    });
  }
  for (const found of findHashtags(value)) {
    const tag = found.tag.replace(/[.,;:!?]+$/, "");
    if (!tag || tag.length > 64) continue;
    facets.push({
      index: { byteStart: byteLength(value.slice(0, found.start)), byteEnd: byteLength(value.slice(0, found.start + 1 + tag.length)) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }]
    });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
