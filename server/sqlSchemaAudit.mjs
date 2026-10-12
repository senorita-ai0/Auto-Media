// Schema/code drift guard.
//
// Extracts every static SQL statement from the server source and asks PostgreSQL to PREPARE it against the
// migrated schema (nothing is executed). A statement that references a column or table that does not exist,
// or uses an ambiguous column, fails here instead of failing in production the first time that code path runs.
//
// Several real bugs of this kind existed (missing publishing_jobs.max_attempts, content_items.workspace_id,
// pj.credential_ref, ambiguous "status" in overview queries) and were invisible because no test touched them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseConfigured, query, closeDatabase } from "./db.mjs";

const strict = String(process.env.SQL_AUDIT_STRICT || "").toLowerCase() === "true";
if (!databaseConfigured()) {
  if (strict) throw new Error("SQL schema audit requires a migrated database.");
  console.log("SQL schema audit skipped: no database configured.");
  process.exit(0);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && !/Test|Audit/.test(f));
const startsLikeSql = /^\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM|WITH)\s/i;
const looksComplete = /\b(FROM|INTO|UPDATE|SET|VALUES)\b/i;

function statementsIn(source) {
  // Re-join "a" + "b" (and `a` + "b") so statements built across several lines are audited whole.
  const joined = source.replace(/(["`])\s*\+\s*(?:\r?\n\s*)?(["`])/g, "");
  const literals = [...joined.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g)].map(m => m[1] ?? m[2]);
  return literals
    .map(text => text.replace(/\\"/g, '"').replace(/\\n/g, "\n"))
    .filter(text => text.length >= 20 && startsLikeSql.test(text) && looksComplete.test(text));
}

let checked = 0;
let fragments = 0;
const failures = [];
for (const file of files) {
  for (const sql of statementsIn(fs.readFileSync(path.join(dir, file), "utf8"))) {
    checked += 1;
    try {
      await query("BEGIN");
      await query("PREPARE audit_stmt AS " + sql);
      await query("DEALLOCATE audit_stmt");
    } catch (error) {
      // Pure syntax errors mean the literal is a fragment of a dynamically built statement, not a schema problem.
      if (/syntax error/.test(error.message)) fragments += 1;
      else failures.push({ file, message: error.message, sql: sql.replace(/\s+/g, " ").slice(0, 200) });
    } finally {
      await query("ROLLBACK").catch(() => {});
    }
  }
}
await closeDatabase().catch(() => {});

if (failures.length) {
  console.error("SQL schema audit found " + failures.length + " statement(s) that do not match the schema:");
  for (const f of failures) console.error("\n  " + f.file + ": " + f.message + "\n    " + f.sql);
  process.exit(1);
}
console.log("SQL schema audit passed: " + checked + " statements checked (" + fragments + " dynamic fragments skipped).");
