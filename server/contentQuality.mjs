// Explainable content-quality scoring. Pure and deterministic (no I/O, no AI call), so it is cheap enough to
// run on every candidate and fully unit-testable.
//
// The score starts at 100. Every issue carries the exact penalty it cost, so a reviewer can see *why* a post
// scored what it did. "critical" issues (leaked AI boilerplate, template placeholders, empty text) also cap the
// score at 40 and are always held for human review.

const BOILERPLATE = [
  /\bas an ai\b/i,
  /\bas a language model\b/i,
  /\bi (?:cannot|can't|am unable to|'m unable to) (?:assist|help|comply|fulfil+|create|write)\b/i,
  /\bhere(?:'s| is| are) (?:the|a|an|your|some) (?:post|caption|tweet|draft|version|options?)\b/i,
  /^\s*(?:sure|certainly|of course|absolutely)[!,.]/i
];

const PLACEHOLDERS = [
  /\[(?:your|insert|add|link|name|brand|company|date|url|product|topic)[^\]]*\]/i,
  /\{\{[^}]+\}\}/,
  /<(?:insert|your|link|name)[^>]*>/i,
  /lorem ipsum/i,
  /\b(?:TODO|FIXME|XXX)\b/
];

const CLICHES = [
  "game-changer", "game changer", "in today's fast-paced", "unlock the power", "delve", "revolutionize",
  "take it to the next level", "in the ever-evolving", "cutting-edge", "dive into", "buckle up"
];

const EMOJI = /\p{Extended_Pictographic}/gu;

function words(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

function stripHashtagsAndUrls(text) {
  return String(text ?? "").replace(/https?:\/\/\S+/g, " ").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ");
}

/** Numbers worth verifying: percentages, money, and figures — not 4-digit years, not list markers. */
export function significantNumbers(text) {
  const out = new Set();
  const clean = String(text ?? "").replace(/https?:\/\/\S+/g, " ");
  for (const match of clean.matchAll(/[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|[kKmMbB]\b|million|billion|trillion)?/g)) {
    const raw = match[0].trim();
    const digits = raw.replace(/[^\d.]/g, "");
    if (!digits) continue;
    if (/^(?:19|20)\d{2}$/.test(digits) && !/[%$€£]/.test(raw)) continue; // years
    if (digits.length === 1 && !/[%$€£kKmMbB]|million|billion|percent/.test(raw)) continue; // "1", "2" list markers / counts
    out.add(normalizeNumber(raw));
  }
  return [...out];
}

function normalizeNumber(raw) {
  return String(raw).toLowerCase().replace(/[,\s]/g, "").replace("percent", "%");
}

function grade(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * @param {{title?:string, caption?:string, hashtags?:string[], profile?:object, sourceText?:string}} input
 * @returns {{score:number, grade:string, issues:Array<{code:string,severity:string,penalty:number,message:string}>, critical:boolean}}
 */
export function scoreContent({ title = "", caption = "", hashtags = [], profile = {}, sourceText = "" }) {
  const issues = [];
  const add = (code, severity, penalty, message) => issues.push({ code, severity, penalty, message });

  const body = String(caption ?? "").trim();
  const fullText = [title, body].filter(Boolean).join("\n");
  const prose = stripHashtagsAndUrls(body);

  if (!body) add("empty_caption", "critical", 60, "The caption is empty.");

  for (const pattern of BOILERPLATE) {
    if (pattern.test(fullText)) { add("ai_boilerplate", "critical", 40, "Looks like leaked AI boilerplate or a refusal."); break; }
  }
  for (const pattern of PLACEHOLDERS) {
    if (pattern.test(fullText)) { add("placeholder_text", "critical", 40, "Contains an unfilled template placeholder."); break; }
  }

  if (body) {
    if (prose.length < 40) add("too_short", "warning", 15, "Very short caption (under 40 characters).");
    else if (prose.length > 1500) add("too_long", "warning", 10, "Very long caption (over 1500 characters).");

    const firstLine = body.split("\n")[0];
    if (firstLine.length > 200) add("long_opening", "info", 5, "The first line is over 200 characters; the hook is buried.");

    const letters = prose.replace(/[^\p{L}]/gu, "");
    const upper = letters.replace(/[^\p{Lu}]/gu, "");
    if (letters.length > 20 && upper.length / letters.length > 0.4) add("shouting", "warning", 10, "Too much UPPERCASE text.");
    if ((body.match(/!/g) || []).length > 3) add("exclamation_overload", "info", 5, "More than three exclamation marks.");
    if ((body.match(EMOJI) || []).length > 8) add("emoji_overload", "info", 5, "More than eight emoji.");

    const tokens = words(prose);
    if (tokens.length > 15) {
      const counts = new Map();
      for (const w of tokens) if (w.length >= 4) counts.set(w, (counts.get(w) || 0) + 1);
      const top = Math.max(0, ...counts.values());
      if (top / tokens.length > 0.2) add("repetitive_wording", "warning", 10, "One word makes up over 20% of the text.");
    }
    const lines = body.split(/\n+/).map(l => l.trim().toLowerCase()).filter(l => l.length > 12);
    if (new Set(lines).size < lines.length) add("repeated_lines", "warning", 10, "The same line appears more than once.");

    const sentences = prose.split(/[.!?]+\s/).filter(s => s.trim());
    if (sentences.length && tokens.length / sentences.length > 30) add("long_sentences", "info", 5, "Average sentence is over 30 words.");

    const lower = fullText.toLowerCase();
    const cliches = CLICHES.filter(c => lower.includes(c));
    if (cliches.length) add("cliches", "info", Math.min(12, cliches.length * 4), "Cliché wording: " + cliches.slice(0, 3).join(", ") + ".");
  }

  const tags = Array.isArray(hashtags) ? hashtags : [];
  const rules = profile?.hashtag_rules_json || profile?.hashtagRules || {};
  const wantsTags = rules && typeof rules === "object" && (Number(rules.count) > 0 || Number(rules.min) > 0 || (Array.isArray(rules.required) && rules.required.length));
  if (!tags.length && wantsTags) add("no_hashtags", "info", 5, "The profile expects hashtags but none are present.");
  if (tags.length > 15) add("too_many_hashtags", "info", 5, "More than 15 hashtags.");

  if (sourceText) {
    const known = new Set(significantNumbers(sourceText));
    const unsupported = significantNumbers(fullText).filter(n => !known.has(n));
    if (unsupported.length) add("unsupported_numbers", "warning", Math.min(18, unsupported.length * 6), "Figures not found in the source: " + unsupported.slice(0, 4).join(", ") + ".");
  }

  const critical = issues.some(i => i.severity === "critical");
  let score = 100 - issues.reduce((sum, i) => sum + i.penalty, 0);
  if (critical) score = Math.min(score, 40);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: grade(score), issues, critical };
}
