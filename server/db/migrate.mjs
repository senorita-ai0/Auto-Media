import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTransaction, databaseConfigured, closeDatabase } from "../db.mjs";

if (!databaseConfigured()) {
  console.error("DATABASE_URL (or DB_HOST + POSTGRES_PASSWORD) is required for migrations.");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = await fs.readFile(path.join(here, "schema.sql"), "utf8");

try {
  await withTransaction(async tx => {
    await tx("SELECT pg_advisory_xact_lock(731945219)");
    await tx(schema);

    await tx(`
      INSERT INTO content_types
      (workspace_id, name, slug, description, category, generation_mode, config_json, schema_json, built_in)
      SELECT NULL, v.name, v.slug, v.description, v.category, v.generation_mode, v.config_json::jsonb, v.schema_json::jsonb, TRUE
      FROM (VALUES
        ('Tech News Image','tech-news-image','Recent story + original post + AI image + branding.','news','ai_image',
          '{"prompt":"Create an original social post about the selected story."}',
          '{"type":"object","required":["post","headline","highlight","category","hashtags","image_prompt"],"properties":{"post":{"type":"string","minLength":20},"headline":{"type":"string","maxLength":80},"highlight":{"type":"string"},"category":{"type":"string"},"hashtags":{"type":"array","minItems":3,"maxItems":12,"items":{"type":"string"}},"image_prompt":{"type":"string","minLength":10}}}'),
        ('Local Video','local-video','Select an unused local video and optionally generate its caption.','video','local_media',
          '{"prompt":"Write a natural caption for the supplied video."}',
          '{"type":"object","required":["title","caption","hashtags"],"properties":{"title":{"type":"string","minLength":1,"maxLength":120},"caption":{"type":"string"},"hashtags":{"type":"array","minItems":0,"maxItems":20,"items":{"type":"string"}}}}'),
        ('Quote Image','quote-image','Generate a quote and a branded shareable image.','image','ai_image',
          '{"prompt":"Create an original quote suitable for a branded social image."}',
          '{"type":"object","required":["quote","author","image_prompt"],"properties":{"quote":{"type":"string","minLength":5},"author":{"type":"string"},"image_prompt":{"type":"string","minLength":10}}}'),
        ('Tech News Text','tech-news-text','Recent story + original text-only post (no image).','news','ai_text',
          '{"prompt":"Write an original, factual social post about the selected story. Label rumors clearly and never invent details."}',
          '{"type":"object","required":["headline","post","hashtags"],"properties":{"headline":{"type":"string","minLength":3,"maxLength":90},"post":{"type":"string","minLength":20},"hashtags":{"type":"array","minItems":1,"maxItems":12,"items":{"type":"string"}}}}'),
        ('Announcement','announcement','Short announcement post from the context you provide.','announcement','ai_text',
          '{"prompt":"Write a clear, upbeat announcement based only on the supplied context. Do not invent dates, prices or features."}',
          '{"type":"object","required":["title","caption","hashtags"],"properties":{"title":{"type":"string","minLength":3,"maxLength":120},"caption":{"type":"string","minLength":10},"hashtags":{"type":"array","minItems":0,"maxItems":12,"items":{"type":"string"}}}}'),
        ('Product Update','product-update','Release notes or product update turned into a social post, optionally with a branded image.','product','ai_image',
          '{"prompt":"Turn the supplied update notes into an engaging post that highlights what changed and why it matters. Use only the supplied facts."}',
          '{"type":"object","required":["title","caption","hashtags","image_prompt"],"properties":{"title":{"type":"string","minLength":3,"maxLength":120},"caption":{"type":"string","minLength":10},"highlights":{"type":"array","items":{"type":"string"}},"hashtags":{"type":"array","minItems":0,"maxItems":12,"items":{"type":"string"}},"image_prompt":{"type":"string","minLength":10}}}')
      ) AS v(name,slug,description,category,generation_mode,config_json,schema_json)
      WHERE NOT EXISTS (SELECT 1 FROM content_types ct WHERE ct.slug = v.slug);

      UPDATE content_types SET schema_json='{"type":"object","required":["post","headline","highlight","category","hashtags","image_prompt"],"properties":{"post":{"type":"string","minLength":20},"headline":{"type":"string","maxLength":80},"highlight":{"type":"string"},"category":{"type":"string"},"hashtags":{"type":"array","minItems":3,"maxItems":12,"items":{"type":"string"}},"image_prompt":{"type":"string","minLength":10}}}'::jsonb WHERE slug='tech-news-image' AND (schema_json='{}'::jsonb OR schema_json IS NULL);
      UPDATE content_types SET schema_json='{"type":"object","required":["title","caption","hashtags"],"properties":{"title":{"type":"string","minLength":1,"maxLength":120},"caption":{"type":"string"},"hashtags":{"type":"array","minItems":0,"maxItems":20,"items":{"type":"string"}}}}'::jsonb WHERE slug='local-video' AND (schema_json='{}'::jsonb OR schema_json IS NULL);
    `);

    await tx(
      "INSERT INTO workspaces (name) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM workspaces)",
      ["Default Workspace"]
    );
  });

  console.log("Auto-Media database migration completed.");
} catch (error) {
  console.error("Auto-Media database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}
