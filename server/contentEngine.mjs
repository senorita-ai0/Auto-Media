import fs from "node:fs/promises";
import path from "node:path";
import { query } from "./db.mjs";
import { collectStories, selectFreshStory } from "./rss.mjs";
import { generateStructured, generateImage } from "./ai.mjs";
import { invokeN8nWorkflow } from "./n8nService.mjs";
import { assertStructuredOutput } from "./structuredValidation.mjs";
import { putBuffer, storageMode } from "./storage.mjs";

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
  const fileName = "generated/" + profileId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 9) + ".png";
  const stored = await putBuffer({ key: fileName, buffer: Buffer.from(base64, "base64"), contentType: "image/png" });
  return {
    filePath: stored.localPath,
    storageKey: stored.storageKey,
    publicUrl: stored.publicUrl
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

async function runGenericAiAutomation(automation) {
  const mode = automation.content_generation_mode;
  if (!["ai_text", "ai_image"].includes(mode)) {
    throw new Error("Unsupported native generation mode: " + mode);
  }

  const sourceConfig = automation.source_config_json || {};
  let source = null;
  const feeds = Array.isArray(sourceConfig.rssUrls)
    ? sourceConfig.rssUrls.filter(Boolean)
    : String(sourceConfig.rssUrls || "").split(",").map(x => x.trim()).filter(Boolean);

  if (feeds.length) {
    const stories = await collectStories(feeds, Number(sourceConfig.itemsPerFeed || 12));
    const used = await usedSourceUrls(automation.profile_id, automation.content_type_id);
    source = selectFreshStory(stories, used);
    if (source?.link) source.excerpt = await articleExcerpt(source.link);
  }

  const typePrompt = automation.config_json?.prompt || automation.config_json?.instructions || "Create original social media content.";
  const system = [
    "You are the content creator for the brand/page below.",
    "Brand name: " + automation.profile_name,
    "Language: " + (automation.language || "English"),
    "Tone: " + (automation.tone || "clear, useful and engaging"),
    "Audience: " + (automation.audience || "general social audience"),
    "",
    "BRAND MASTER PROMPT:",
    automation.master_prompt || "Create original useful content in the brand voice.",
    "",
    "HASHTAG RULES:",
    JSON.stringify(automation.hashtag_rules_json || {}),
    "BRAND ASSETS:",
    JSON.stringify(automation.brand_assets_json || []),
    "",
    "VISUAL IDENTITY:",
    JSON.stringify(automation.visual_identity_json || {}),
    "",
    "CONTENT TYPE INSTRUCTIONS:",
    typePrompt,
    "",
    "Return JSON only and follow the supplied output schema exactly.",
    "Do not invent factual claims not supported by the supplied source.",
    "Never copy source wording."
  ].join("\n");

  const sourceText = source
    ? [
        "Source title: " + source.title,
        "Source summary: " + source.summary,
        "Publisher: " + (source.sourceName || source.sourceUrl || "Unknown"),
        "Published: " + (source.publishedAt || "unknown"),
        "Article excerpt: " + (source.excerpt || "")
      ].join("\n")
    : String(sourceConfig.context || sourceConfig.prompt || "Create a new original piece of content.");

  let generated = await generateStructured({
    system,
    user: sourceText,
    automation,
  });
  assertStructuredOutput(generated, automation.schema_json, "AI content output");

  let media = null;
  let imagePrompt = String(generated.image_prompt || generated.imagePrompt || sourceConfig.imagePrompt || "").trim();
  if (mode === "ai_image" && !imagePrompt) {
    const visual = await generateStructured({
      system: "Create a concise image-generation prompt for the generated content. No text, watermarks or unsupported factual details. Return JSON only with key image_prompt.",
      user: JSON.stringify(generated),
      automation,
  });
    imagePrompt = String(visual.image_prompt || "").trim();
  }
  if (mode === "ai_image" && imagePrompt) {
    const image = await generateImage({ prompt: imagePrompt , automation });
    media = await saveImage(automation.profile_id, image.base64);
  }

  const title = String(generated.title || generated.headline || generated.name || source?.title || automation.content_type_name || "Generated content");
  const caption = String(generated.caption || generated.post || generated.text || generated.body || "");
  const prompt = "MASTER:\n" + (automation.master_prompt || "") + "\n\nCONTENT TYPE:\n" + typePrompt;
  const promptVersionId = await savePromptVersion(automation.profile_id, automation.content_type_id, prompt);
  const status =
    automation.approval_mode === "auto" ? "approved" :
    automation.approval_mode === "generate" ? "generated" : "needs_review";

  const sourcePayload = source
    ? { title: source.title, url: source.link, summary: source.summary, sourceName: source.sourceName, publishedAt: source.publishedAt }
    : { context: sourceConfig.context || sourceConfig.prompt || null };

  const inserted = await query(
    "INSERT INTO content_items (profile_id,content_type_id,automation_id,source_type,source_data_json,title,caption,structured_data_json,status,prompt_version_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10) RETURNING id,status,created_at",
    [
      automation.profile_id,
      automation.content_type_id,
      automation.id,
      source ? "rss" : "prompt",
      JSON.stringify(sourcePayload),
      title,
      caption,
      JSON.stringify({ ...generated, imagePrompt: imagePrompt || null }),
      status,
      promptVersionId
    ]
  );

  if (media) {
    const mediaRow = await query(
      "INSERT INTO media_assets (workspace_id,profile_id,type,storage_key,local_path,public_url,mime_type,source,status) SELECT p.workspace_id,$1,'image',$2,$3,$4,'image/png','ai','ready' FROM profiles p WHERE p.id=$1 RETURNING id",
      [automation.profile_id, media.storageKey, media.filePath, media.publicUrl || null]
    );
    if (mediaRow.rows[0]) await query(
      "INSERT INTO content_media (content_item_id,media_asset_id,role,sort_order) VALUES ($1,$2,'primary',0)",
      [inserted.rows[0].id, mediaRow.rows[0].id]
    );
  }

  return {
    automationId: automation.id,
    contentId: inserted.rows[0].id,
    status: inserted.rows[0].status,
    title,
    caption,
    hashtags: Array.isArray(generated.hashtags) ? generated.hashtags : [],
    imagePrompt: imagePrompt || null,
    media: media ? { storageKey: media.storageKey, localPath: media.filePath, url: media.publicUrl || null } : null,
    source: source ? { title: source.title, url: source.link, sourceName: source.sourceName, publishedAt: source.publishedAt } : null
  };
}

export async function runNativeAutomation(automationId, options = {}) {
  const result = await query(
    "SELECT a.*, p.name AS profile_name, p.master_prompt, p.language, p.tone, p.audience, ct.name AS content_type_name, ct.slug AS content_type_slug, ct.generation_mode AS content_generation_mode, ct.config_json, ct.schema_json FROM automations a JOIN profiles p ON p.id = a.profile_id JOIN content_types ct ON ct.id = a.content_type_id WHERE a.id = $1",
    [automationId]
  );
  const automation = result.rows[0];
  if (!automation) throw new Error("Automation not found.");
  if (!automation.enabled) throw new Error("Automation is paused.");

  if (automation.content_generation_mode === "external_workflow") return runExternalWorkflowAutomation(automation, options.generationJobId || null);
  if (automation.content_type_slug === "local-video") {
    return runLocalVideoAutomation(automation);
  }
  if (["ai_text", "ai_image"].includes(automation.content_generation_mode)) {
    return runGenericAiAutomation(automation);
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

  const generated = await generateStructured({ system, user, automation });
  assertStructuredOutput(generated, automation.schema_json, "AI content output");

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
      "Brand master prompt: " + (automation.master_prompt || ""),
      "Visual identity: " + JSON.stringify(automation.visual_identity_json || {})
    ].join("\n"),
    automation,
  });

  const imagePrompt = imageDirector.image_prompt || generated.image_prompt || "";
  let media = null;
  if (imagePrompt) {
    const image = await generateImage({ prompt: imagePrompt , automation });
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
      "INSERT INTO media_assets (workspace_id, profile_id, type, storage_key, local_path, public_url, mime_type, source, status) SELECT p.workspace_id, $1, 'image', $2, $3, $4, 'image/png', 'ai', 'ready' FROM profiles p WHERE p.id = $1 RETURNING id",
      [automation.profile_id, media.storageKey, media.filePath, media.publicUrl || null]
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

export async function regenerateContentItem(contentId) {
  const result = await query(
    `SELECT c.*, a.*, p.workspace_id, p.name AS profile_name, p.master_prompt, p.language, p.tone, p.audience, p.hashtag_rules_json, p.visual_identity_json,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('role',pba.role,'assetId',ma.id,'storageKey',ma.storage_key,'publicUrl',ma.public_url,'mimeType',ma.mime_type) ORDER BY pba.sort_order,pba.created_at DESC),'[]'::jsonb)
       FROM profile_brand_assets pba JOIN media_assets ma ON ma.id=pba.media_asset_id
       WHERE pba.profile_id=p.id AND pba.active) AS brand_assets_json, ct.name AS content_type_name, ct.slug AS content_type_slug, ct.generation_mode AS content_generation_mode, ct.config_json, ct.schema_json FROM content_items c JOIN automations a ON a.id=c.automation_id JOIN profiles p ON p.id=c.profile_id JOIN content_types ct ON ct.id=c.content_type_id WHERE c.id=$1`,
    [contentId]
  );
  const item = result.rows[0];
  if (!item) throw new Error("Content item not found.");
  if (!item.automation_id) throw new Error("This content item is not linked to an automation.");
  if (!["tech-news-image", "local-video"].includes(item.content_type_slug) && !["ai_text", "ai_image"].includes(item.content_generation_mode || "")) {
    throw new Error("This content type does not have a native regeneration path.");
  }

  const status = item.approval_mode === "auto" ? "approved" : item.approval_mode === "generate" ? "generated" : "needs_review";
  let title = item.title;
  let caption = item.caption;
  let structured = item.structured_data_json || {};
  let media = null;

  if (item.content_type_slug === "tech-news-image") {
    const source = item.source_data_json || {};
    const excerpt = source.url ? await articleExcerpt(source.url) : "";
    const system = [
      "You are regenerating a social post for " + item.profile_name + ".",
      "Create a fresh version using the exact same source story. Do not change the facts.",
      "Brand master prompt:", item.master_prompt || "",
      "Content type instructions:", item.config_json?.prompt || "",
      "Return JSON only with keys: post, headline, highlight, category, hashtags, image_prompt.",
      "headline must be no more than 9 words.",
      "hashtags must be an array."
    ].join("\n");
    const generated = await generateStructured({
      system,
      user: [
        "Original headline: " + (source.title || item.title),
        "Source summary: " + (source.summary || ""),
        "Publisher: " + (source.sourceName || ""),
        "Published: " + (source.publishedAt || ""),
        "Article excerpt: " + excerpt
      ].join("\n"),
      automation: item,
  });
    assertStructuredOutput(generated, item.schema_json, "Regenerated content output");
    const visual = await generateStructured({
      system: "Create a concise visual prompt for the same news story. Do not add text or unsupported facts. Return JSON only with key image_prompt.",
      user: "Headline: " + (generated.headline || source.title) + "\nPost: " + (generated.post || ""),
      automation: item,
  });
    title = String(generated.headline || source.title || item.title);
    caption = String(generated.post || "");
    structured = { ...generated, imagePrompt: visual.image_prompt || generated.image_prompt || "" };
    if (structured.imagePrompt) {
      const image = await generateImage({ prompt: structured.imagePrompt , automation });
      media = await saveImage(item.profile_id, image.base64);
    }
  } else {
    const source = item.source_data_json || {};
    const prompt = [
      "You are regenerating a social-media caption for " + item.profile_name + ".",
      "Use the same local video. Produce a fresh variation without inventing facts.",
      "Brand master prompt:", item.master_prompt || "",
      "Content type instructions:", item.config_json?.prompt || "",
      "Return JSON only with keys: title, caption, hashtags."
    ].join("\n");
    const generated = await generateStructured({
      system: prompt,
      user: "Video filename: " + (source.fileName || source.path || "local video"),
      automation: item,
  });
    assertStructuredOutput(generated, item.schema_json, "Regenerated content output");
    title = String(generated.title || item.title);
    caption = String(generated.caption || "");
    structured = generated;
  }

  const prompt = "MASTER:\n" + (item.master_prompt || "") + "\n\nCONTENT TYPE:\n" + (item.config_json?.prompt || "");
  const promptVersionId = await savePromptVersion(item.profile_id, item.content_type_id, prompt);
  const inserted = await query(
    "INSERT INTO content_items (profile_id,content_type_id,automation_id,source_type,source_data_json,title,caption,structured_data_json,status,prompt_version_id,revision_of) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11) RETURNING id,status,created_at",
    [item.profile_id,item.content_type_id,item.automation_id,item.source_type,JSON.stringify(item.source_data_json || {}),title,caption,JSON.stringify(structured),status,promptVersionId,contentId]
  );

  if (media) {
    const mediaRow = await query(
      "INSERT INTO media_assets (workspace_id,profile_id,type,storage_key,local_path,mime_type,source,status) SELECT p.workspace_id,$1,'image',$2,$3,'image/png','ai','ready' FROM profiles p WHERE p.id=$1 RETURNING id",
      [item.profile_id,media.storageKey,media.filePath]
    );
    if (mediaRow.rows[0]) await query(
      "INSERT INTO content_media (content_item_id,media_asset_id,role,sort_order) VALUES ($1,$2,'primary',0)",
      [inserted.rows[0].id,mediaRow.rows[0].id]
    );
  }

  return {
    contentId: inserted.rows[0].id,
    revisionOf: contentId,
    status: inserted.rows[0].status,
    title,
    caption,
    hashtags: Array.isArray(structured.hashtags) ? structured.hashtags : [],
    media: media ? { storageKey: media.storageKey, localPath: media.filePath } : null
  };
}

export async function ingestN8nResult({ executionId, automation, result }) {
  const existing = await query("SELECT status, output_json FROM n8n_executions WHERE id=$1", [executionId]);
  if (!existing.rows[0]) throw new Error("n8n execution not found.");
  if (existing.rows[0].status === "completed") {
    const previous = existing.rows[0].output_json || {};
    return { automationId: automation.id, contentId: previous.autoMediaContentId || null, status: previous.autoMediaStatus || "completed", title: previous.title || "", caption: previous.caption || "", hashtags: previous.hashtags || [], media: previous.media || [], source: previous.source || null, duplicate: true };
  }
  const output = result && typeof result === "object" ? result : {};
  const content = output.content && typeof output.content === "object" ? output.content : output;
  const title = String(content.title || content.headline || content.name || "Untitled");
  const caption = String(content.caption || content.post || content.text || "");
  const structured = content.structuredData || content.structured_data || { ...content, hashtags: Array.isArray(content.hashtags) ? content.hashtags : [] };
  assertStructuredOutput(structured, automation.schema_json, "n8n content output");
  const status = automation.approval_mode === "auto" ? "approved" : automation.approval_mode === "generate" ? "generated" : "needs_review";

  const inserted = await query(
    "INSERT INTO content_items (profile_id, content_type_id, automation_id, source_type, source_data_json, title, caption, structured_data_json, status) VALUES ($1,$2,$3,'n8n',$4::jsonb,$5,$6,$7::jsonb,$8) RETURNING id,status,created_at",
    [
      automation.profile_id, automation.content_type_id, automation.id,
      JSON.stringify({ executionId, workflowId: output.workflowId || null, source: output.source || null }),
      title, caption, JSON.stringify(structured || {}), status
    ]
  );

  const mediaEntries = Array.isArray(output.media) ? output.media : output.media ? [output.media] : [];
  for (let i = 0; i < mediaEntries.length; i++) {
    const item = mediaEntries[i] || {};
    const storageKey = String(item.storageKey || item.storage_key || "");
    const localPath = item.localPath || item.local_path || null;
    const publicUrl = item.publicUrl || item.public_url || null;
    if (!storageKey && !localPath && !publicUrl) continue;
    const type = String(item.type || (String(item.mimeType || item.mime_type || "").startsWith("image/") ? "image" : "video"));
    const asset = await query(
      "INSERT INTO media_assets (workspace_id, profile_id, type, storage_key, local_path, public_url, mime_type, source, status) SELECT p.workspace_id, $1, $2, $3, $4, $5, $6, 'n8n', 'ready' FROM profiles p WHERE p.id = $1 RETURNING id",
      [automation.profile_id, type, storageKey || (localPath ? String(localPath).split(/[\\/]/).pop() : "external-media"), localPath, publicUrl, item.mimeType || item.mime_type || null]
    );
    if (asset.rows[0]) await query(
      "INSERT INTO content_media (content_item_id, media_asset_id, role, sort_order) VALUES ($1,$2,'primary',$3) ON CONFLICT DO NOTHING",
      [inserted.rows[0].id, asset.rows[0].id, i]
    );
  }
  await query("UPDATE n8n_executions SET status='completed', completed_at=now(), output_json=$2::jsonb WHERE id=$1", [executionId, JSON.stringify({ ...output, autoMediaContentId: inserted.rows[0].id, autoMediaStatus: inserted.rows[0].status })]);
  return { automationId: automation.id, contentId: inserted.rows[0].id, status: inserted.rows[0].status, title, caption, hashtags: Array.isArray(content.hashtags) ? content.hashtags : [], media: mediaEntries, source: output.source || null };
}

async function runExternalWorkflowAutomation(automation, generationJobId = null) {
  const workflowId = automation.generation_config_json?.n8nWorkflowId || automation.config_json?.n8nWorkflowId;
  if (!workflowId) throw new Error("This automation uses n8n but has no n8n workflow selected.");
  const workflowResult = await query(
    "SELECT id,name,status,workflow_json,version FROM n8n_workflows WHERE id=$1 AND workspace_id=(SELECT workspace_id FROM profiles WHERE id=$2)",
    [workflowId, automation.profile_id]
  );
  const workflow = workflowResult.rows[0];
  if (!workflow) throw new Error("Selected n8n workflow was not found in this workspace.");
  if (workflow.status !== "active") throw new Error("Selected n8n workflow is not active.");

  const execution = await query(
    "INSERT INTO n8n_executions (workflow_id,job_id,status,input_json) VALUES ($1,$2,'running',$3::jsonb) RETURNING id",
    [workflow.id, generationJobId, JSON.stringify({ profileId: automation.profile_id, contentTypeId: automation.content_type_id, automationId: automation.id, generationJobId })]
  );
  const executionId = execution.rows[0].id;
  const usedResult = await query(
    "SELECT title,source_data_json->>'url' AS url FROM content_items WHERE profile_id=$1 AND content_type_id=$2 ORDER BY created_at DESC LIMIT 500",
    [automation.profile_id, automation.content_type_id]
  );
  const configuredSource = automation.source_config_json || {};
  const input = {
    profileId: automation.profile_id,
    contentTypeId: automation.content_type_id,
    automationId: automation.id,
    profile: { id: automation.profile_id, name: automation.profile_name, language: automation.language || "English", tone: automation.tone || "", audience: automation.audience || "", masterPrompt: automation.master_prompt || "", hashtagRules: automation.hashtag_rules_json || {}, visualIdentity: automation.visual_identity_json || {}, brandAssets: automation.brand_assets_json || [] },
    contentType: { id: automation.content_type_id, name: automation.content_type_name, slug: automation.content_type_slug, config: automation.config_json || {}, schema: automation.schema_json || {} },
    source: { ...configuredSource, usedUrls: usedResult.rows.map(x => x.url).filter(Boolean), usedTitles: usedResult.rows.map(x => x.title).filter(Boolean) },
    config: automation.generation_config_json || {},
    credentialMap: workflow.credential_map_json || {},
    generationJobId
  };
  try {
    const response = await invokeN8nWorkflow({ workflow: workflow.workflow_json, jobId: executionId, input });
    const rawBody = response?.response?.data || response?.response || {};
    const body = Array.isArray(rawBody) ? (rawBody[0]?.json || rawBody[0] || {}) : rawBody;
    await query("UPDATE n8n_executions SET status='triggered', external_execution_id=$2, output_json=$3::jsonb WHERE id=$1", [executionId, body?.executionId || body?.id || null, JSON.stringify(body)]);
    if (body?.content || body?.title || body?.post || body?.caption) return ingestN8nResult({ executionId, automation, result: body });
    return { automationId: automation.id, executionId, status: "external_pending", workflowId: workflow.id, workflowName: workflow.name };
  } catch (error) {
    await query("UPDATE n8n_executions SET status='failed', completed_at=now(), error_json=$2::jsonb WHERE id=$1", [executionId, JSON.stringify({ message: error.message })]);
    throw error;
  }
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
  const rule = configured.selectionRule || "oldest";
  const useLibrary = String(configured.mediaSource || "folder").toLowerCase() === "library";

  let selectedPath = null;
  let selectedAsset = null;
  let selectedFileSize = 0;
  let selectedName = "";

  if (useLibrary) {
    const library = await query(
      "SELECT ma.* FROM media_assets ma WHERE ma.workspace_id=(SELECT workspace_id FROM profiles WHERE id=$1) AND ma.type='video' AND ma.status='ready' AND (ma.profile_id=$1 OR ma.profile_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_media cm JOIN content_items ci ON ci.id=cm.content_item_id WHERE cm.media_asset_id=ma.id AND ci.profile_id=$1 AND ci.content_type_id=$2) ORDER BY ma.created_at",
      [automation.profile_id, automation.content_type_id]
    );
    if (!library.rows.length) throw new Error("No unused videos are available in the Media Library for this automation.");
    if (rule === "newest") library.rows.reverse();
    if (rule === "random") {
      const chosen = library.rows[Math.floor(Math.random() * library.rows.length)];
      library.rows.splice(0, library.rows.length, chosen);
    }
    selectedAsset = library.rows[0];
    selectedPath = selectedAsset.local_path || null;
    selectedName = path.basename(selectedAsset.storage_key || selectedAsset.local_path || "video");
    selectedFileSize = Number(selectedAsset.file_size || 0);
  } else {
    const root = process.env.MEDIA_ROOT || path.resolve("media");
    const requested = String(configured.localFolder || "");
    if (!requested) throw new Error("No local video folder configured for this automation.");
    const folder = path.resolve(requested.startsWith(path.sep) ? requested : path.join(root, requested));
    const relative = path.relative(root, folder);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Local media folder must be inside MEDIA_ROOT.");
    const all = await listLocalVideos(folder);
    if (!all.length) throw new Error("No supported video files were found in the configured folder.");
    const usedResult = await query(
      "SELECT source_data_json->>'path' AS path FROM content_items WHERE profile_id=$1 AND content_type_id=$2 AND source_type='local_file'",
      [automation.profile_id, automation.content_type_id]
    );
    const used = new Set(usedResult.rows.map(x => x.path).filter(Boolean));
    const available = all.filter(x => !used.has(x));
    if (!available.length) throw new Error("All videos in this folder have already been used.");
    if (rule === "newest") {
      selectedPath = (await Promise.all(available.map(async x => ({ path:x,mtime:(await fs.stat(x)).mtimeMs })))).sort((a,b)=>b.mtime-a.mtime)[0].path;
    } else if (rule === "random") {
      selectedPath = available[Math.floor(Math.random()*available.length)];
    } else {
      selectedPath = (await Promise.all(available.map(async x => ({ path:x,mtime:(await fs.stat(x)).mtimeMs })))).sort((a,b)=>a.mtime-b.mtime)[0].path;
    }
    const file = await fs.stat(selectedPath);
    selectedFileSize = file.size;
    selectedName = path.basename(selectedPath);
  }

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
    user: "Video filename: " + selectedName,
    automation,
  });
  assertStructuredOutput(generated, automation.schema_json, "AI video caption output");

  const status = automation.approval_mode === "auto" ? "approved" : automation.approval_mode === "generate" ? "generated" : "needs_review";
  const promptVersionId = await savePromptVersion(automation.profile_id, automation.content_type_id, prompt);
  const checksumValue = selectedAsset?.checksum || (selectedPath ? await checksum(selectedPath) : null);
  const sourcePayload = useLibrary
    ? { mediaAssetId: selectedAsset.id, storageKey: selectedAsset.storage_key, fileName: selectedName, size: selectedFileSize, checksum: checksumValue }
    : { path: selectedPath, fileName: selectedName, size: selectedFileSize, checksum: checksumValue };

  const inserted = await query(
    "INSERT INTO content_items (profile_id,content_type_id,automation_id,source_type,source_data_json,title,caption,structured_data_json,status,prompt_version_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10) RETURNING id,status,created_at",
    [automation.profile_id,automation.content_type_id,automation.id,useLibrary ? "media_asset" : "local_file",JSON.stringify(sourcePayload),String(generated.title || selectedName),String(generated.caption || ""),JSON.stringify(generated),status,promptVersionId]
  );

  let asset;
  if (selectedAsset) {
    asset = selectedAsset;
    await query(
      "INSERT INTO content_media (content_item_id,media_asset_id,role,sort_order) VALUES ($1,$2,'primary',0) ON CONFLICT DO NOTHING",
      [inserted.rows[0].id, selectedAsset.id]
    );
  } else {
    const root = process.env.MEDIA_ROOT || path.resolve("media");
    const localStorageKey = path.relative(root, selectedPath).replace(/\\/g, "/");
    const storedVideo = storageMode() === "s3"
      ? await putBuffer({ key:"local/" + automation.profile_id + "/" + checksumValue + path.extname(selectedPath).toLowerCase(), buffer:await fs.readFile(selectedPath), contentType:"video/" + path.extname(selectedPath).slice(1) })
      : { storageKey:localStorageKey, localPath:selectedPath, publicUrl:null };
    const mediaRow = await query(
      "INSERT INTO media_assets (workspace_id,profile_id,type,storage_key,local_path,public_url,mime_type,file_size,checksum,source,status) SELECT p.workspace_id,$1,'video',$2,$3,$4,$5,$6,$7,'local','ready' FROM profiles p WHERE p.id=$1 RETURNING id,storage_key,local_path,public_url,mime_type,file_size,checksum",
      [automation.profile_id,storedVideo.storageKey,storedVideo.localPath,storedVideo.publicUrl,"video/" + path.extname(selectedPath).slice(1),selectedFileSize,checksumValue]
    );
    asset = mediaRow.rows[0];
    if (asset) await query(
      "INSERT INTO content_media (content_item_id,media_asset_id,role,sort_order) VALUES ($1,$2,'primary',0)",
      [inserted.rows[0].id,asset.id]
    );
  }

  return {
    automationId: automation.id,
    contentId: inserted.rows[0].id,
    status: inserted.rows[0].status,
    title: generated.title || selectedName,
    caption: generated.caption || "",
    hashtags: generated.hashtags || [],
    media: { storageKey: asset?.storage_key || null, localPath: asset?.local_path || null, publicUrl: asset?.public_url || null },
    source: { type: useLibrary ? "media_asset" : "local_file", path: selectedPath, fileName: selectedName, checksum: checksumValue }
  };
}

