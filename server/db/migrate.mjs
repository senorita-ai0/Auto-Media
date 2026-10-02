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

await query(
  "INSERT INTO workspaces (name) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM workspaces)",
  ["Default Workspace"]
);

console.log("Auto-Media database migration completed.");
