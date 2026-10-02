import { databaseHealth, query } from "./db.mjs";

async function ensureWorkspace() {
  const result = await query("SELECT id, name FROM workspaces ORDER BY created_at LIMIT 1");
  if (result.rows[0]) return result.rows[0];
  const created = await query("INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name", ["Default Workspace"]);
  return created.rows[0];
}

function errorResponse(res, error) {
  const message = error?.message || "Studio request failed.";
  const missingDb = message.includes("PostgreSQL is not configured");
  res.status(missingDb ? 503 : 400).json({
    error: { code: missingDb ? "DATABASE_NOT_CONFIGURED" : "STUDIO_REQUEST_FAILED", message }
  });
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function registerStudioRoutes(app) {
  app.get("/api/studio/health", async (_req, res) => {
    res.json(await databaseHealth());
  });

  app.get("/api/studio/bootstrap", async (_req, res) => {
    try {
      res.json({ workspace: await ensureWorkspace() });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get("/api/studio/profiles", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        "SELECT * FROM profiles WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspace.id]
      );
      res.json({ profiles: result.rows });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.post("/api/studio/profiles", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const body = req.body || {};
      if (!String(body.name || "").trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Profile name is required." } });
      const result = await query(
        `INSERT INTO profiles
        (workspace_id, name, slug, description, niche, language, timezone, tone, audience, master_prompt, disclaimer)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *`,
        [
          workspace.id,
          String(body.name).trim(),
          String(body.slug || body.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          String(body.description || ""),
          String(body.niche || ""),
          String(body.language || "English"),
          String(body.timezone || "UTC"),
          String(body.tone || ""),
          String(body.audience || ""),
          String(body.masterPrompt || ""),
          String(body.disclaimer || ""),
        ]
      );
      res.status(201).json({ profile: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.patch("/api/studio/profiles/:id", async (req, res) => {
    try {
      const body = req.body || {};
      const allowed = ["name","slug","description","niche","language","timezone","tone","audience","master_prompt","disclaimer","enabled"];
      const keyMap = { masterPrompt: "master_prompt" };
      const sets = []; const values = [];
      for (const key of allowed) {
        const inputKey = key === "master_prompt" ? "masterPrompt" : key;
        if (body[inputKey] !== undefined || body[key] !== undefined) {
          values.push(body[inputKey] !== undefined ? body[inputKey] : body[key]);
          sets.push(key + " = $" + values.length);
        }
      }
      if (!sets.length) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No profile fields supplied." } });
      values.push(new Date().toISOString(), req.params.id);
      sets.push("updated_at = $" + (values.length - 1));
      const result = await query("UPDATE profiles SET " + sets.join(", ") + " WHERE id = $" + values.length + " RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found." } });
      res.json({ profile: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.delete("/api/studio/profiles/:id", async (req, res) => {
    try {
      const result = await query("DELETE FROM profiles WHERE id = $1 RETURNING id", [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found." } });
      res.status(204).end();
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get("/api/studio/content-types", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        "SELECT * FROM content_types WHERE workspace_id = $1 OR workspace_id IS NULL ORDER BY built_in DESC, created_at DESC",
        [workspace.id]
      );
      res.json({ contentTypes: result.rows });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.post("/api/studio/content-types", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const body = req.body || {};
      if (!String(body.name || "").trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Content type name is required." } });
      const result = await query(
        `INSERT INTO content_types
        (workspace_id, name, slug, description, category, generation_mode, config_json, schema_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
        RETURNING *`,
        [
          workspace.id,
          String(body.name).trim(),
          String(body.slug || body.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          String(body.description || ""),
          String(body.category || "custom"),
          String(body.generationMode || "ai_text"),
          JSON.stringify(body.config || {}),
          JSON.stringify(body.schema || {}),
        ]
      );
      res.status(201).json({ contentType: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.patch("/api/studio/content-types/:id", async (req, res) => {
    try {
      const body = req.body || {};
      const fields = {
        name: body.name,
        slug: body.slug,
        description: body.description,
        category: body.category,
        generation_mode: body.generationMode,
        config_json: body.config,
        schema_json: body.schema,
        active: body.active,
      };
      const sets = []; const values = [];
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        values.push(key.endsWith("_json") ? JSON.stringify(value || {}) : value);
        sets.push(key + " = $" + values.length + (key.endsWith("_json") ? "::jsonb" : ""));
      }
      if (!sets.length) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No content type fields supplied." } });
      values.push(new Date().toISOString(), req.params.id);
      sets.push("updated_at = $" + (values.length - 1));
      const result = await query("UPDATE content_types SET " + sets.join(", ") + " WHERE id = $" + values.length + " AND built_in = FALSE RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Custom content type not found or is built-in." } });
      res.json({ contentType: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.delete("/api/studio/content-types/:id", async (req, res) => {
    try {
      const result = await query("DELETE FROM content_types WHERE id = $1 AND built_in = FALSE RETURNING id", [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Custom content type not found or is built-in." } });
      res.status(204).end();
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/automations", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        `SELECT a.*, p.name AS profile_name, p.master_prompt, ct.name AS content_type_name
         FROM automations a
         JOIN profiles p ON p.id = a.profile_id
         JOIN content_types ct ON ct.id = a.content_type_id
         WHERE p.workspace_id = $1
         ORDER BY a.created_at DESC`,
        [workspace.id]
      );
      res.json({ automations: result.rows.map((row) => ({ ...row, destinations: row.destination_labels || [] })) });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.patch("/api/studio/automations/:id", async (req, res) => {
    try {
      const body = req.body || {};
      const fields = {
        profile_id: body.profileId,
        content_type_id: body.contentTypeId,
        name: body.name,
        enabled: body.enabled,
        schedule_type: body.scheduleType,
        schedule_config_json: body.scheduleConfig,
        source_config_json: body.sourceConfig,
        generation_config_json: body.generationConfig === undefined ? undefined : { ...(body.generationConfig || {}), destinationLabels: Array.isArray(body.destinations) ? body.destinations : (body.generationConfig?.destinationLabels || []) },
        approval_mode: body.approvalMode,
        max_items_per_run: body.maxItemsPerRun,
        timezone: body.timezone,
      };
      const sets = []; const values = [];
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        values.push(key.endsWith("_json") ? JSON.stringify(value || {}) : value);
        sets.push(key + " = $" + values.length + (key.endsWith("_json") ? "::jsonb" : ""));
      }
      if (!sets.length) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No automation fields supplied." } });
      values.push(new Date().toISOString(), req.params.id);
      sets.push("updated_at = $" + (values.length - 1));
      const result = await query("UPDATE automations SET " + sets.join(", ") + " WHERE id = $" + values.length + " RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation not found." } });
      res.json({ automation: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.delete("/api/studio/automations/:id", async (req, res) => {
    try {
      const result = await query("DELETE FROM automations WHERE id = $1 RETURNING id", [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation not found." } });
      res.status(204).end();
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/automations", async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.profileId || !body.contentTypeId) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "profileId and contentTypeId are required." } });
      const result = await query(
        `INSERT INTO automations
        (profile_id, content_type_id, name, enabled, schedule_type, schedule_config_json, source_config_json, generation_config_json, approval_mode, max_items_per_run, timezone)
        VALUES ($1,$2,$3,TRUE,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)
        RETURNING *`,
        [
          body.profileId,
          body.contentTypeId,
          String(body.name || "Untitled automation"),
          String(body.scheduleType || "interval"),
          JSON.stringify(body.scheduleConfig || {}),
          JSON.stringify(body.sourceConfig || {}),
          JSON.stringify({ ...(body.generationConfig || {}), destinationLabels: Array.isArray(body.destinations) ? body.destinations : [] }),
          String(body.approvalMode || "review"),
          Number(body.maxItemsPerRun) > 0 ? Number(body.maxItemsPerRun) : 1,
          String(body.timezone || "UTC"),
        ]
      );
      res.status(201).json({ automation: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });
}
