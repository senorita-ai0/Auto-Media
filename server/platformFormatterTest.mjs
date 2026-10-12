import assert from "node:assert/strict";
import {
  graphemeLength, xWeightedLength, findUrls, findHashtags, trimToFit, applyUtm, youtubeTags,
  adaptForPlatform, rulesFor, buildBlueskyFacets, PLATFORM_RULES
} from "./platformFormatter.mjs";

// ---- counting ----
assert.equal(graphemeLength("héllo"), 5);
assert.equal(graphemeLength("👨‍👩‍👧‍👦"), 1, "a ZWJ family emoji is one grapheme");
assert.equal(graphemeLength("🇵🇰"), 1, "a flag is one grapheme");
assert.equal(xWeightedLength("hello"), 5);
assert.equal(xWeightedLength("日本語"), 6, "CJK weighs 2 on X");
assert.equal(xWeightedLength("see https://example.com/a/very/long/path?with=query&and=more now"), "see ".length + 23 + " now".length, "every URL costs 23 on X");

// ---- token detection ----
assert.deepEqual(findUrls("Read https://a.com/x?y=1, then (https://b.com/z).").map(u => u.url), ["https://a.com/x?y=1", "https://b.com/z"]);
assert.deepEqual(findHashtags("Love #AI and #Future_Tech! Not #123 or a&#amp or https://a.com/#frag").map(h => h.tag), ["AI", "Future_Tech"]);

// ---- trimToFit ----
const sentence = "First sentence is here. Second sentence goes on for a while longer. Third one is the tail end of it.";
const trimmed = trimToFit(sentence, 50);
assert.ok(graphemeLength(trimmed) <= 50);
assert.ok(trimmed.endsWith("…"));
assert.ok(trimmed.startsWith("First sentence is here."));
assert.equal(trimToFit("short", 50), "short");
const word = trimToFit("alpha beta gamma delta epsilon zeta eta theta", 22);
assert.ok(!/\bgam…|\bdel…|\bep…/.test(word), "no mid-word cut: " + word);
assert.ok(graphemeLength(word) <= 22);
const noUrlCut = trimToFit("Check this out https://example.com/a-very-long-link-that-must-not-be-split ok", 40);
assert.ok(!noUrlCut.includes("https://example.com/a-very-long-link-that-must-not-be-split") || noUrlCut.endsWith("ok"), "URL kept whole or dropped: " + noUrlCut);
assert.ok(!/https?:\/\/\S*[^\s…]…$/.test(noUrlCut), "never ends inside a URL: " + noUrlCut);
const emoji = trimToFit("🎉".repeat(30), 10);
assert.ok(graphemeLength(emoji) <= 10 && !emoji.includes("�"), "emoji never split");
assert.equal(trimToFit("anything", 0), "");

// ---- hashtags and limits ----
const longBody = "Word ".repeat(80).trim();
const bsky = adaptForPlatform({ platform: "bluesky", title: "Headline here", caption: longBody, hashtags: ["#ai", "chips", "#News"] });
assert.ok(bsky.length <= 300 && bsky.limit === 300, "bluesky fits 300 graphemes");
assert.equal(bsky.truncated, true);
assert.deepEqual(bsky.hashtags, [], "body is trimmed rather than keeping hashtags when nothing fits");

const x = adaptForPlatform({ platform: "x", title: "Chip makers race ahead", caption: "ignored on x by default", hashtags: ["#ai", "#chips", "#tech", "#extra"], link: "https://example.com/very/long/article/path/that/is/long" });
assert.ok(x.length <= 280);
assert.deepEqual(x.hashtags, ["#ai", "#chips", "#tech"], "x allows 3 hashtags");
assert.ok(x.text.startsWith("Chip makers race ahead") && x.text.includes("https://example.com/very/long/article/path/that/is/long"));
assert.ok(!x.text.includes("ignored on x"), "x defaults to title mode");

const xLong = adaptForPlatform({ platform: "x", title: "T".repeat(278), hashtags: ["#a1", "#b2"] });
assert.equal(xLong.droppedHashtags, 2);
assert.ok(xLong.length <= 280);

const ig = adaptForPlatform({ platform: "instagram", title: "Title", caption: "Body text", hashtags: Array.from({ length: 40 }, (_, i) => "#tag" + i) });
assert.equal(ig.hashtags.length, 30, "instagram caps at 30 hashtags");
assert.ok(ig.text.startsWith("Title\n\nBody text\n\n#tag0 "));

const threads = adaptForPlatform({ platform: "threads", title: "T", caption: "B", hashtags: ["#one", "#two"] });
assert.deepEqual(threads.hashtags, ["#one"], "threads shows a single topic tag");

// caption already starting with the title is not duplicated
const dup = adaptForPlatform({ platform: "facebook", title: "Big news today", caption: "Big news today: we shipped it.", hashtags: [] });
assert.equal(dup.text, "Big news today: we shipped it.");

// hashtags already in the body are not repeated
const rep = adaptForPlatform({ platform: "telegram", title: "", caption: "Loving #AI lately", hashtags: ["#ai", "#chips"] });
assert.deepEqual(rep.hashtags, ["#chips"]);

// per-destination overrides
assert.equal(adaptForPlatform({ platform: "facebook", caption: "Body", hashtags: ["#a1"], options: { hashtags: false } }).text, "Body");
assert.equal(adaptForPlatform({ platform: "mastodon", caption: "x".repeat(900), options: { maxChars: 800 } }).limit, 800);
assert.equal(rulesFor("linkedin").mode, "caption");
assert.equal(rulesFor("nowhere").limit, 2000, "unknown platforms get a safe fallback");
assert.deepEqual(Object.keys(PLATFORM_RULES).sort(), ["bluesky", "discord", "facebook", "instagram", "linkedin", "mastodon", "pinterest", "reddit", "telegram", "threads", "tiktok", "x", "youtube"]);

// ---- UTM ----
assert.equal(applyUtm("See https://example.com/a?x=1 now.", { source: "fb", medium: "social" }), "See https://example.com/a?x=1&utm_source=fb&utm_medium=social now.");
assert.equal(applyUtm("https://example.com/?utm_source=keep", { source: "fb" }), "https://example.com/?utm_source=keep", "existing utm is never overwritten");
assert.equal(applyUtm("no links here", { source: "fb" }), "no links here");
assert.equal(applyUtm("https://example.com", null), "https://example.com");
const utmPost = adaptForPlatform({ platform: "linkedin", caption: "Read https://example.com/post", options: { utm: { campaign: "launch" } } });
assert.ok(utmPost.text.includes("utm_source=linkedin") && utmPost.text.includes("utm_medium=social") && utmPost.text.includes("utm_campaign=launch"));
const noUtm = adaptForPlatform({ platform: "linkedin", caption: "Read https://example.com/post" });
assert.ok(!noUtm.text.includes("utm_"), "UTM is opt-in");

// ---- YouTube tags ----
assert.equal(youtubeTags(["#ai", "chips", "#AI", "x".repeat(40)]), "ai,chips");
assert.ok(youtubeTags(Array.from({ length: 200 }, (_, i) => "#tagnumber" + i)).length <= 500);

// ---- Bluesky facets: byte offsets, not character offsets ----
const text = "Café 🚀 #AI news https://example.com/x.";
const facets = buildBlueskyFacets(text);
const bytes = new TextEncoder().encode(text);
const slice = f => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
const tag = facets.find(f => f.features[0].$type.endsWith("#tag"));
const link = facets.find(f => f.features[0].$type.endsWith("#link"));
assert.equal(slice(tag), "#AI");
assert.equal(tag.features[0].tag, "AI");
assert.equal(slice(link), "https://example.com/x");
assert.equal(link.features[0].uri, "https://example.com/x");
assert.ok(tag.index.byteStart < link.index.byteStart, "facets are ordered");

console.log("Platform formatter tests passed.");
