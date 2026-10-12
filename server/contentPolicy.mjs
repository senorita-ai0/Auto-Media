import { detectInjection } from "./promptSafety.mjs";
import { scoreContent } from "./contentQuality.mjs";
// Brand-policy enforcement for generated content. Pure functions (no I/O) so they are unit-testable.
//
// Hashtag rules (profile.hashtag_rules_json), all optional:
//   { "count": 5, "min": 3, "max": 7, "required": ["#FutureTech"], "avoid": ["#spam"] }
// "count" is shorthand for min = max = count.

export function normalizeHashtag(value) {
  const cleaned = String(value || "").trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned ? "#" + cleaned : "";
}

export function normalizeHashtags(list) {
  const input = Array.isArray(list)
    ? list
    : String(list || "").split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const tag = normalizeHashtag(raw);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function applyHashtagRules(tags, rules = {}) {
  const r = rules && typeof rules === "object" ? rules : {};
  const required = normalizeHashtags(r.required);
  const avoid = new Set(normalizeHashtags(r.avoid).map(x => x.toLowerCase()));
  const requiredKeys = new Set(required.map(x => x.toLowerCase()));
  let max = Number(r.count ?? r.max);
  let min = Number(r.count ?? r.min);
  max = Number.isFinite(max) && max > 0 ? Math.floor(max) : Infinity;
  min = Number.isFinite(min) && min > 0 ? Math.floor(min) : 0;

  const optional = normalizeHashtags(tags).filter(t => !avoid.has(t.toLowerCase()) && !requiredKeys.has(t.toLowerCase()));
  const room = Math.max(0, max - required.length);
  const result = [...required, ...optional.slice(0, room)];
  return { hashtags: result, belowMinimum: result.length < min };
}

export function applyDisclaimer(caption, disclaimer) {
  const text = String(caption || "").trim();
  const note = String(disclaimer || "").trim();
  if (!note) return text;
  if (text.toLowerCase().includes(note.toLowerCase())) return text;
  return text ? text + "\n\n" + note : note;
}

/** Remove a trailing/embedded profile disclaimer so stored captions compare fairly with fresh ones. */
export function stripDisclaimer(caption, disclaimer) {
  const note = String(disclaimer || "").trim();
  const text = String(caption || "");
  if (!note) return text.trim();
  const index = text.toLowerCase().indexOf(note.toLowerCase());
  return (index >= 0 ? text.slice(0, index) + text.slice(index + note.length) : text).trim();
}

function shingles(text, size = 3) {
  const words = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length < size) return new Set(words.length ? [words.join(" ")] : []);
  const set = new Set();
  for (let i = 0; i <= words.length - size; i++) set.add(words.slice(i, i + size).join(" "));
  return set;
}

/** Jaccard similarity of word 3-shingles, 0..1. */
export function similarity(a, b) {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let shared = 0;
  for (const item of sa) if (sb.has(item)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

export function findNearDuplicate(text, recent = [], threshold = 0.6) {
  let best = null;
  for (const candidate of recent) {
    const score = similarity(text, candidate);
    if (score >= threshold && (!best || score > best.score)) best = { score: Math.round(score * 100) / 100, text: String(candidate).slice(0, 120) };
  }
  return best;
}

/**
 * Apply the profile's policies to freshly generated content.
 * Returns the final caption/hashtags, any flags, and whether a human must review before publishing
 * (even for automations set to auto-approve).
 */
export function evaluateContent({ caption, hashtags, profile = {}, recentCaptions = [], duplicateThreshold = 0.6, title = "", sourceText = "", untrustedText = "", minQualityScore = 55 }) {
  const flags = [];
  const ruled = applyHashtagRules(hashtags, profile.hashtag_rules_json || profile.hashtagRules || {});
  if (ruled.belowMinimum) flags.push({ code: "few_hashtags", message: "Fewer hashtags than the profile minimum." });

  const finalCaption = applyDisclaimer(caption, profile.disclaimer);
  if (!String(caption || "").trim()) flags.push({ code: "empty_caption", message: "Generated caption is empty." });

  const comparable = recentCaptions.map(text => stripDisclaimer(text, profile.disclaimer));
  const duplicate = findNearDuplicate(caption, comparable, duplicateThreshold);
  if (duplicate) flags.push({ code: "near_duplicate", message: "Very similar to a recent post (" + Math.round(duplicate.score * 100) + "% overlap).", score: duplicate.score });

  const injection = detectInjection(untrustedText);
  if (injection.suspicious) flags.push({ code: "suspicious_source", message: "Source text contains instruction-like content (" + injection.matches.join(", ") + "). Check the post was not steered by it." });

  const quality = scoreContent({ title, caption, hashtags: ruled.hashtags, profile, sourceText });
  if (quality.critical) flags.push({ code: "quality_critical", message: quality.issues.filter(i => i.severity === "critical").map(i => i.message).join(" ") });
  else if (quality.score < minQualityScore) flags.push({ code: "low_quality", message: "Quality score " + quality.score + " is below the minimum of " + minQualityScore + ".", score: quality.score });

  const forceReview = flags.some(f => ["near_duplicate", "empty_caption", "quality_critical", "low_quality", "suspicious_source"].includes(f.code));
  return { caption: finalCaption, hashtags: ruled.hashtags, flags, forceReview, quality };
}
