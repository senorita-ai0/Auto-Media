import fs from "node:fs/promises";
import path from "node:path";
import { query } from "./db.mjs";
import { collectStories, selectFreshStory } from "./rss.mjs";
import { generateStructured, generateImage } from "./ai.mjs";

function cleanHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function articleExcerpt(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Auto-Media/1.0" },
        signal: controller.signal,
      });
      if (!response.ok) return "";
      const html = await response.text();
      const meta = (html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i) || [])[1] || "";
      const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => cleanHtml(m[1]))
        .filter((x) => x.length > 60)
        .slice(0, 8);
      return cleanHtml(meta + " " + paragraphs.join(" ")).slice(0, 3000);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return "";
  }
}

function sourceUrls(automation) {
  const configured = automation.source_config_json || {};
  if (Array.isArray(configured.rssUrls)) return configured.rssUrls;
  return String(process.env.TECH_RSS_FEEDS || "").split(",").map((x) => x.trim()).filter(Boolean);
}

async function usedSourceUrls(profileId, contentTypeId) {
  const result = await query(
    "SELECT source_data_json->>'url' AS url FROM content_items WHERE profile_id = $1 AND content_type_id = $2",
    [profileId, contentTypeId]
  );
  return result.rows.map((x) => x.url).filter(Boolean);
}

async function saveImage(profileId, base64) {
  const root = process.env.MEDIA_ROOT || path.resolve("media");
  const dir = path.join(root, "generated", profileId);
  await fs.mkdir(dir, { recursive: true });
  const fileName = Date.now() + "-" + Math.random().toString(36).slice(2, 9) + ".png";
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return {
    filePath,
    storageKey: path.relative(root, filePath).replace(/\\/g, "/"),
  };
}

async function savePromptVersion(profileId, contentTypeId, prompt) {
  const latest = await query(
    "SELECT id, version, prompt FROM prompt_versions WHERE profile_id = $1 AND content_type_id = $2 ORDER BY version DESC LIMIT 1",
    [profileId, contentTypeId]
  );
  if (latest.rows[0]?.prompt === prompt) return latest.rows[0].id;
  const version = Number(latest.rows[0]?.version || 0) + 1;
  const row = await query(
    "INSERT INTO prompt_versions (profile_id, content_type_id, version, prompt, active) VALUES ($1,$2,$3,$4,TRUE) RETURNING id",
    [profileId, contentTypeId, version, prompt]
  );
  await query(
    "UPDATE prompt_versions SET active = FALSE WHERE profile_id = $1 AND content_type_id = $2 AND id <> $3",
    [profileId, contentTypeId, row.rows[0].id]
  );
  return row.rows[0].id;
}

export async function runNativeAutomation(automationId) {
  const result = await query(
    "SELECT a.*, p.name AS profile_name, p.master_prompt, p.language, p.tone, p.audience, ct.name AS content_type_name, ct.slug AS content_type_slug, ct.config_json FROM automations a JOIN profiles p ON p.id = a.profile_id JOIN content_types ct ON ct.id = a.content_type_id WHERE a.id = $1",
    [automationId]
  );
  const automation = result.rows[0];
  if (!automation) throw new Error("Automation not found.");
  if (!automation.enabled) throw new Error("Automation is paused.");

  if (automation.content_type_slug === "local-video") {
    return runLocalVideoAutomation(automation);
  }
  if (automation.content_type_slug !== "tech-news-image") {
    throw new Error("This content type does not have a native runner yet. Use a custom workflow for it.");
  }

  const feeds = sourceUrls(automation);
  if (!feeds.length) {
    throw new Error("No RSS feeds configured. Add rssUrls to the automation source configuration or set TECH_RSS_FEEDS.");
  }
  const stories = await collectStories(feeds, Number(automation.source_config_json?.itemsPerFeed || 12));
  const used = await usedSourceUrls(automation.profile_id, automation.content_type_id);
  const story = selectFreshStory(stories, used);
  const excerpt = await articleExcerpt(story.link);

  const system = [
    "You are the content editor for the brand/page below.",
    "Brand name: " + automation.profile_name,
    "Language: " + (automation.language || "English"),
    "Tone: " + (automation.tone || "clear, engaging and factual"),
    "Audience: " + (automation.audience || "general social-media audience"),
    "",
    "BRAND MASTER PROMPT:",
    automation.master_prompt || "Create original, useful social media content in the brand voice.",
    "",
    "CONTENT TYPE INSTRUCTIONS:",
    automation.config_json?.prompt || "Create an original social post about the selected story.",
    "",
    "Never copy source sentences. Use only facts supported by the supplied story context.",
    "If a claim is a rumor or leak, clearly label it.",
    "Do not invent numbers, dates, quotes or details.",
    "Return JSON only with keys: post, headline, highlight, category, hashtags, image_prompt.",
    "headline must be no more than 9 words.",
    "highlight must contain 1 or 2 short phrases copied from the headline.",
    "hashtags must be an array of 5 to 7 strings."
  ].join("\n");

  const user = [
    "Story headline: " + story.title,
    "Story summary: " + story.summary,
    "Publisher/feed: " + (story.sourceName || story.sourceUrl),
    "Publication date: " + (story.publishedAt || "unknown"),
    "Article excerpt: " + (excerpt || "No article excerpt was available.")
  ].join("\n");

  const generated = await generateStructured({ system, user });

  const imageDirector = await generateStructured({
    system: [
      "You are a visual director for " + automation.profile_name + ".",
      "Create a concise image-generation prompt that visually represents the selected news story.",
      "Do not create text, UI screenshots or fake quotations in the image.",
      "Return JSON only with key image_prompt."
    ].join("\n"),
    user: [
      "Headline: " + (generated.headline || story.title),
      "Post: " + (generated.post || ""),
      "Brand master prompt: " + (automation.master_prompt || "")
    ].join("\n")
  });

  const imagePrompt = imageDirector.image_prompt || generated.image_prompt || "";
  let media = null;
  if (imagePrompt) {
    const image = await generateImage({ prompt: imagePrompt });
    media = await saveImage(automation.profile_id, image.base64);
  }

  const combinedPrompt =
    "MASTER:\n" + (automation.master_prompt || "") +
    "\n\nCONTENT TYPE:\n" + (automation.config_json?.prompt || "");
  const promptVersionId = await savePromptVersion(automation.profile_id, automation.content_type_id, combinedPrompt);
  const status =
    automation.approval_mode === "auto" ? "approved" :
    automation.approval_mode === "generate" ? "generated" : "needs_review";

  const inserted = await query(
    "INSERT INTO content_items (profile_id, content_type_id, automation_id, source_type, source_data_json, title, caption, structured_data_json, status, prompt_version_id) VALUES ($1,$2,$3,'rss',$4::jsonb,$5,$6,$7::jsonb,$8,$9) RETURNING id, status, created_at",
    [
      automation.profile_id,
      automation.content_type_id,
      automation.id,
      JSON.stringify({ title: story.title, url: story.link, summary: story.summary, sourceName: story.sourceName, publishedAt: story.publishedAt }),
      String(generated.headline || story.title),
      String(generated.post || ""),
      JSON.stringify({ ...generated, imagePrompt }),
      status,
      promptVersionId
    ]
  );

  if (media) {
    const mediaRow = await query(
      "INSERT INTO media_assets (workspace_id, profile_id, type, storage_key, local_path, mime_type, source, status) SELECT p.workspace_id, $1, 'image', $2, $3, 'image/png', 'ai', 'ready' FROM profiles p WHERE p.id = $1 RETURNING id",
      [automation.profile_id, media.storageKey, media.filePath]
    );
    if (mediaRow.rows[0]) await query(
      "INSERT INTO content_media (content_item_id, media_asset_id, role, sort_order) VALUES ($1,$2,'primary',0)",
      [inserted.rows[0].id, mediaRow.rows[0].id]
    );
  }

  return {
    automationId, contentId: inserted.rows[0].id, status: inserted.rows[0].status,
    title: generated.headline || story.title, caption: generated.post || "",
    hashtags: generated.hashtags || [], imagePrompt: imagePrompt || null,
    media: media ? { storageKey: media.storageKey, localPath: media.filePath } : null,
    source: { title: story.title, url: story.link, sourceName: story.sourceName, publishedAt: story.publishedAt }
  };
}

async function listLocalVideos(folder) {
  const allowed = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);
  const entries = [];
  async function walk(current) {
    const rows = await fs.readdir(current, { withFileTypes: true });
    for (const row of rows) {
      const full = path.join(current, row.name);
      if (row.isDirectory()) await walk(full);
      else if (allowed.has(path.extname(row.name).toLowerCase())) entries.push(full);
    }
  }
  await walk(folder);
  return entries;
}

async function checksum(filePath) {
  const crypto = await import("node:crypto");
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function runLocalVideoAutomation(automation) {
  const configured = automation.source_config_json || {};
  const root = process.env.MEDIA_ROOT || path.resolve("media");
  const requested = String(configured.localFolder || "");
  if (!requested) throw new Error("No local video folder configured for this automation.");

  const folder = path.resolve(requested.startsWith(path.sep) ? requested : path.join(root, requested));
  const relative = path.relative(root, folder);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Local media folder must be inside MEDIA_ROOT.");
  }

  const all = await listLocalVideos(folder);
  if (!all.length) throw new Error("No supported video files were found in the configured folder.");

  const usedResult = await query(
    "SELECT source_data_json->>'path' AS path FROM content_items WHERE profile_id = $1 AND content_type_id = $2 AND source_type = 'local_file'",
    [automation.profile_id, automation.content_type_id]
  );
  const used = new Set(usedResult.rows.map(x => x.path).filter(Boolean));
  const available = all.filter(x => !used.has(x));
  if (!available.length) throw new Error("All videos in this folder have already been used.");

  const rule = configured.selectionRule || "oldest";
  let selected = available[0];
  if (rule === "newest") {
    selected = (await Promise.all(available.map(async x => ({ path: x, mtime: (await fs.stat(x)).mtimeMs })))).sort((a,b)=>b.mtime-a.mtime)[0].path;
  } else if (rule === "random") {
    selected = available[Math.floor(Math.random() * available.length)];
  } else {
    selected = (await Promise.all(available.map(async x => ({ path: x, mtime: (await fs.stat(x)).mtimeMs })))).sort((a,b)=>a.mtime-b.mtime)[0].path;
  }

  const file = await fs.stat(selected);
  const fileHash = await checksum(selected);
  const prompt = [
    "You are creating a social-media caption for " + automation.profile_name + ".",
    "Brand master prompt:",
    automation.master_prompt || "",
    "",
    "Content type instructions:",
    automation.config_json?.prompt || "Write a natural caption for the supplied video.",
    "",
    "Return JSON only with keys: title, caption, hashtags.",
    "Do not claim facts that are not supported by the page instructions or filename.",
    "Keep the caption natural and suitable for social media."
  ].join("\n");

  const generated = await generateStructured({
    system: prompt,
    user: "Video filename: " + path.basename(selected)
  });
  const status = automation.approval_mode === "auto" ? "approved" : automation.approval_mode === "generate" ? "generated" : "needs_review";
  const promptVersionId = await savePromptVersion(automation.profile_id, automation.content_type_id, prompt);

  const inserted = await query(
    "INSERT INTO content_items (profile_id, content_type_id, automation_id, source_type, source_data_json, title, caption, structured_data_json, status, prompt_version_id) VALUES ($1,$2,$3,'local_file',$4::jsonb,$5,$6,$7::jsonb,$8,$9) RETURNING id,status,created_at",
    [
      automation.profile_id, automation.content_type_id, automation.id,
      JSON.stringify({ path: selected, fileName: path.basename(selected), size: file.size, checksum: fileHash }),
      String(generated.title || path.basename(selected)),
      String(generated.caption || ""),
      JSON.stringify(generated),
      status, promptVersionId
    ]
  );

  const mediaRow = await query(
    "INSERT INTO media_assets (workspace_id, profile_id, type, storage_key, local_path, mime_type, file_size, checksum, source, status) SELECT p.workspace_id, $1, 'video', $2, $3, $4, $5, $6, 'local', 'ready' FROM profiles p WHERE p.id = $1 RETURNING id",
    [automation.profile_id, path.relative(root, selected).replace(/\\/g, "/"), selected, "video/" + path.extname(selected).slice(1), file.size, fileHash]
  );
  if (mediaRow.rows[0]) await query(
    "INSERT INTO content_media (content_item_id, media_asset_id, role, sort_order) VALUES ($1,$2,'primary',0)",
    [inserted.rows[0].id, mediaRow.rows[0].id]
  );

  return {
    automationId: automation.id, contentId: inserted.rows[0].id, status: inserted.rows[0].status,
    title: generated.title || path.basename(selected), caption: generated.caption || "",
    hashtags: generated.hashtags || [],
    media: { storageKey: path.relative(root, selected).replace(/\\/g, "/"), localPath: selected },
    source: { type: "local_file", path: selected, fileName: path.basename(selected), checksum: fileHash }
  };
}
