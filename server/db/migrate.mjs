import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, databaseConfigured } from "./db.mjs";

if (!databaseConfigured()) {
  console.error("DATABASE_URL is required for migrations.");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = await fs.readFile(path.join(here, "schema.sql"), "utf8");
await query(schema);

await query(`
  INSERT INTO content_types
  (workspace_id, name, slug, description, category, generation_mode, built_in)
  SELECT NULL, v.name, v.slug, v.description, v.category, v.generation_mode, TRUE
  FROM (VALUES
    ('Tech News Image','tech-news-image','Recent story + original post + AI image + branding.','news','ai_image'),
    ('Local Video','local-video','Select an unused local video and optionally generate its caption.','video','local_media'),
    ('Quote Image','quote-image','Generate a quote and a branded shareable image.','image','ai_image')
  ) AS v(name,slug,description,category,generation_mode)
  WHERE NOT EXISTS (SELECT 1 FROM content_types ct WHERE ct.slug = v.slug);
`);

await query(
  "INSERT INTO workspaces (name) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM workspaces)",
  ["Default Workspace"]
);

console.log("Auto-Media database migration completed.");
