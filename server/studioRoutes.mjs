import { databaseHealth, query } from "./db.mjs";
import { runNativeAutomation } from "./contentEngine.mjs";
import { saveCredential, listCredentialNames } from "./credentialVault.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";
import { n8nHealth, validateN8nWorkflow, verifyCallbackSignature, invokeN8nWorkflow } from "./n8nService.mjs";
import { ingestN8nResult } from "./contentEngine.mjs";

async function ensureWorkspace() {
  const result = await query("SELECT id, name FROM workspaces ORDER BY created_at LIMIT 1");
  if (result.rows[0]) return result.rows[0];
  const created = await query("INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name", ["Default Workspace"]);
  return created.rows[0];
}

async function syncAutomationDestinations(automationId, accountIds) {
  const ids = Array.isArray(accountIds) ? [...new Set(accountIds.filter(Boolean))] : [];
  await query("DELETE FROM automation_destinations WHERE automation_id = $1", [automationId]);
  for (const accountId of ids) {
    await query(
      "INSERT INTO automation_destinations (automation_id, social_account_id) VALUES ($1,$2) ON CONFLICT (automation_id, social_account_id) DO NOTHING",
      [automationId, accountId]
    );
  }
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

  app.post("/api/studio/automations/:id/run", async (req, res) => {
    try {
      const result = await runNativeAutomation(req.params.id);
      if (result.status === "approved") {
        const jobs = await createPublishingJobs(result.contentId);
        result.publishResults = [];
        for (const job of jobs) result.publishResults.push(await publishPublishingJob(job.id));
        const failed = result.publishResults.filter(x => x.status === "failed").length;
        await query("UPDATE content_items SET status = $2, updated_at = now() WHERE id = $1", [result.contentId, failed === jobs.length ? "failed" : failed ? "partially_published" : "published"]);
        result.status = failed === jobs.length ? "failed" : failed ? "partially_published" : "published";
      }
      if (result.media?.storageKey) result.media.url = "/media/" + result.media.storageKey.split("/").map(encodeURIComponent).join("/");
      res.status(201).json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.post("/api/studio/content/:id/approve", async (req, res) => {
    try {
      const result = await query("UPDATE content_items SET status = 'approved', updated_at = now() WHERE id = $1 AND status IN ('needs_review','generated','draft') RETURNING id,status", [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content is not awaiting approval." } });
      const jobs = await createPublishingJobs(req.params.id);
      res.json({ content: result.rows[0], publishingJobs: jobs });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/content/:id/publish", async (req, res) => {
    try {
      const state = await query("SELECT status FROM content_items WHERE id = $1", [req.params.id]);
      if (!state.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content item not found." } });
      if (!["approved","scheduled","generated","needs_review"].includes(state.rows[0].status)) return res.status(400).json({ error: { code: "INVALID_STATUS", message: "This content item cannot be published in its current state." } });
      await query("UPDATE content_items SET status = 'publishing', updated_at = now() WHERE id = $1", [req.params.id]);
      const jobs = await createPublishingJobs(req.params.id);
      const results = [];
      for (const job of jobs) results.push(await publishPublishingJob(job.id));
      const failed = results.filter(x => x.status === "failed");
      await query("UPDATE content_items SET status = $2, updated_at = now() WHERE id = $1", [req.params.id, failed.length === results.length ? "failed" : failed.length ? "partially_published" : "published"]);
      res.json({ contentId: req.params.id, jobs: results });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/publishing-jobs", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        "SELECT pj.*, sa.name AS account_name, sa.platform, c.title, c.profile_id FROM publishing_jobs pj JOIN social_accounts sa ON sa.id = pj.social_account_id JOIN content_items c ON c.id = pj.content_item_id JOIN profiles p ON p.id = c.profile_id WHERE p.workspace_id = $1 ORDER BY pj.scheduled_at DESC NULLS LAST, pj.id DESC LIMIT 200",
        [workspace.id]
      );
      res.json({ jobs: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/publishing-jobs/:id/run", async (req, res) => {
    try {
      const result = await publishPublishingJob(req.params.id);
      res.json(result);
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/content", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const params = [workspace.id];
      let where = "p.workspace_id = $1";
      if (req.query.profileId) {
        params.push(req.query.profileId);
        where += " AND c.profile_id = $" + params.length;
      }
      const result = await query(
        "SELECT c.id, c.profile_id, c.content_type_id, c.automation_id, c.title, c.caption, c.structured_data_json, c.status, c.source_data_json, c.created_at, p.name AS profile_name, ct.name AS content_type_name, ma.storage_key, ma.local_path, ma.mime_type FROM content_items c JOIN profiles p ON p.id = c.profile_id JOIN content_types ct ON ct.id = c.content_type_id LEFT JOIN content_media cm ON cm.content_item_id = c.id LEFT JOIN media_assets ma ON ma.id = cm.media_asset_id WHERE " + where + " ORDER BY c.created_at DESC LIMIT 100",
        params
      );
      res.json({ content: result.rows });
    } catch (error) {
      errorResponse(res, error);
    }
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

  app.get("/api/studio/credentials", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      res.json({ credentials: await listCredentialNames(workspace.id) });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/accounts", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        "SELECT * FROM social_accounts WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspace.id]
      );
      res.json({ accounts: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/accounts", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const body = req.body || {};
      if (!String(body.platform || "").trim() || !String(body.name || "").trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Platform and account name are required." } });
      }
      const result = await query(
        "INSERT INTO social_accounts (workspace_id, platform, name, external_account_id, credential_ref, metadata_json, status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *",
        [
          workspace.id,
          String(body.platform).trim().toLowerCase(),
          String(body.name).trim(),
          body.externalAccountId ? String(body.externalAccountId).trim() : null,
          body.credentialRef ? String(body.credentialRef).trim() : null,
          JSON.stringify(body.metadata || {}),
          String(body.status || "disconnected")
        ]
      );
      res.status(201).json({ account: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.patch("/api/studio/accounts/:id", async (req, res) => {
    try {
      const body = req.body || {};
      const fields = { platform: body.platform, name: body.name, external_account_id: body.externalAccountId, credential_ref: body.credentialRef, metadata_json: body.metadata, status: body.status };
      const sets = []; const values = [];
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        values.push(key === "metadata_json" ? JSON.stringify(value || {}) : value);
        sets.push(key + " = $" + values.length + (key === "metadata_json" ? "::jsonb" : ""));
      }
      if (!sets.length) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No account fields supplied." } });
      values.push(new Date().toISOString(), req.params.id);
      sets.push("updated_at = $" + (values.length - 1));
      const result = await query("UPDATE social_accounts SET " + sets.join(", ") + " WHERE id = $" + values.length + " RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Social account not found." } });
      res.json({ account: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/accounts/:id/credential", async (req, res) => {
    try {
      const accountResult = await query("SELECT workspace_id, credential_ref FROM social_accounts WHERE id = $1", [req.params.id]);
      const account = accountResult.rows[0];
      if (!account) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Social account not found." } });
      const name = String(req.body?.name || account.credential_ref || ("account-" + req.params.id)).trim();
      if (!req.body?.payload || typeof req.body.payload !== "object") return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Credential payload is required." } });
      const credential = await saveCredential(account.workspace_id, name, req.body.payload);
      await query("UPDATE social_accounts SET credential_ref = $2, status = 'connected', updated_at = now() WHERE id = $1", [req.params.id, name]);
      res.status(201).json({ credential: { id: credential.id, name: credential.name, createdAt: credential.created_at, updatedAt: credential.updated_at } });
    } catch (error) { errorResponse(res, error); }
  });

  app.delete("/api/studio/accounts/:id", async (req, res) => {
    try {
      const result = await query("DELETE FROM social_accounts WHERE id = $1 RETURNING id", [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Social account not found." } });
      res.status(204).end();
    } catch (error) { errorResponse(res, error); }
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
      const result = await query("UPDATE content_types SET " + sets.join(", ") + " WHERE id = $" + values.length + " RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content type not found." } });
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
      res.json({ automations: result.rows.map((row) => ({ ...row, destinations: (row.destination_accounts || []).map((x) => x.name), destinationAccountIds: (row.destination_accounts || []).map((x) => x.id) })) });
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
      if (body.destinationAccountIds !== undefined) await syncAutomationDestinations(result.rows[0].id, body.destinationAccountIds);
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

  app.get("/api/studio/n8n/status", async (_req, res) => {
    res.json(await n8nHealth());
  });

  app.get("/api/studio/n8n/workflows", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        "SELECT id,name,description,n8n_workflow_id,version,status,imported_from,created_at,updated_at FROM n8n_workflows WHERE workspace_id=$1 ORDER BY updated_at DESC",
        [workspace.id]
      );
      res.json({ workflows: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/n8n/workflows/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query("SELECT * FROM n8n_workflows WHERE id=$1 AND workspace_id=$2", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const workflow = result.rows[0];
      const validation = validateN8nWorkflow(workflow.workflow_json);
      res.json({ workflow: { ...workflow, validation: validation.report, validationErrors: validation.errors, validationWarnings: validation.warnings } });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/import", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const validation = validateN8nWorkflow(req.body?.workflow ?? req.body?.json);
      if (!validation.workflow || !validation.valid) {
        return res.status(400).json({ error: { code: "N8N_WORKFLOW_INVALID", message: validation.errors.join(" ") || "n8n workflow failed validation.", details: validation.report, warnings: validation.warnings } });
      }
      const name = String(req.body?.name || validation.report.name || "Imported n8n workflow").trim();
      const result = await query(
        "INSERT INTO n8n_workflows (workspace_id,name,description,workflow_json,n8n_workflow_id,version,status,imported_from) VALUES ($1,$2,$3,$4::jsonb,$5,1,'draft',$6) RETURNING id,name,description,n8n_workflow_id,version,status,imported_from,created_at,updated_at",
        [workspace.id, name, String(req.body?.description || ""), JSON.stringify(validation.workflow), validation.workflow.id || null, String(req.body?.importedFrom || "chatgpt")]
      );
      res.status(201).json({ workflow: result.rows[0], validation: validation.report, warnings: validation.warnings });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/duplicate", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const current = await query("SELECT * FROM n8n_workflows WHERE id=$1 AND workspace_id=$2", [req.params.id, workspace.id]);
      if (!current.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const source = current.rows[0];
      const result = await query(
        "INSERT INTO n8n_workflows (workspace_id,name,description,workflow_json,n8n_workflow_id,version,status,imported_from) VALUES ($1,$2,$3,$4::jsonb,$5,1,'draft',$6) RETURNING id,name,description,n8n_workflow_id,version,status,imported_from,created_at,updated_at",
        [workspace.id, String(req.body?.name || source.name + " copy"), source.description, JSON.stringify(source.workflow_json), source.n8n_workflow_id, "duplicate:" + source.id]
      );
      res.status(201).json({ workflow: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/activate", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const current = await query("SELECT id,workflow_json FROM n8n_workflows WHERE id=$1 AND workspace_id=$2", [req.params.id, workspace.id]);
      if (!current.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const validation = validateN8nWorkflow(current.rows[0].workflow_json);
      if (!validation.valid) return res.status(400).json({ error: { code: "N8N_WORKFLOW_INVALID", message: validation.errors.join(" "), details: validation.report } });
      const updated = await query("UPDATE n8n_workflows SET status='active', updated_at=now() WHERE id=$1 RETURNING id,name,status,version,updated_at", [req.params.id]);
      res.json({ workflow: updated.rows[0], validation: validation.report });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/deactivate", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const updated = await query("UPDATE n8n_workflows SET status='inactive',updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id,name,status,version,updated_at", [req.params.id, workspace.id]);
      if (!updated.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      res.json({ workflow: updated.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/test", async (req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const current = await query(
        "SELECT w.*, a.id AS automation_id, a.profile_id, a.content_type_id FROM n8n_workflows w LEFT JOIN automations a ON a.id=$2 WHERE w.id=$1 AND w.workspace_id=$3",
        [req.params.id, req.body?.automationId || null, workspace.id]
      );
      const workflow = current.rows[0];
      if (!workflow) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const validation = validateN8nWorkflow(workflow.workflow_json);
      if (!validation.valid) return res.status(400).json({ error: { code: "N8N_WORKFLOW_INVALID", message: validation.errors.join(" "), details: validation.report } });
      const execution = await query("INSERT INTO n8n_executions (workflow_id,status,input_json) VALUES ($1,'running',$2::jsonb) RETURNING id", [workflow.id, JSON.stringify(req.body?.input || { jobId: null, profileId: null, contentTypeId: null, automationId: req.body?.automationId || null })]);
      const executionId = execution.rows[0].id;
      const input = {
        profileId: req.body?.input?.profileId || null,
        contentTypeId: req.body?.input?.contentTypeId || null,
        automationId: req.body?.input?.automationId || null,
        profile: req.body?.input?.profile || null,
        contentType: req.body?.input?.contentType || null,
        source: req.body?.input?.source || {},
        config: req.body?.input?.config || {}
      };
      try {
        const invoked = await invokeN8nWorkflow({ workflow: workflow.workflow_json, jobId: executionId, input, test: true });
        const body = invoked?.response?.data || invoked?.response || {};
        await query("UPDATE n8n_executions SET status='triggered',external_execution_id=$2,output_json=$3::jsonb WHERE id=$1", [executionId, body?.executionId || body?.id || null, JSON.stringify(body)]);
        res.json({ executionId, status: "triggered", response: body });
      } catch (error) {
        await query("UPDATE n8n_executions SET status='failed',completed_at=now(),error_json=$2::jsonb WHERE id=$1", [executionId, JSON.stringify({ message: error.message })]);
        throw error;
      }
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/n8n/executions", async (_req, res) => {
    try {
      const workspace = await ensureWorkspace();
      const result = await query(
        "SELECT e.*, w.name AS workflow_name FROM n8n_executions e LEFT JOIN n8n_workflows w ON w.id=e.workflow_id WHERE w.workspace_id=$1 OR w.workspace_id IS NULL ORDER BY e.started_at DESC LIMIT 200",
        [workspace.id]
      );
      res.json({ executions: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/callback", async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.jobId || !verifyCallbackSignature({ jobId: body.jobId }, body.callbackToken)) {
        return res.status(401).json({ error: { code: "N8N_CALLBACK_UNAUTHORIZED", message: "Invalid n8n callback token." } });
      }
      const execution = await query(
        "SELECT e.*, a.*, p.name AS profile_name, p.master_prompt, p.language, p.tone, p.audience, ct.name AS content_type_name, ct.slug AS content_type_slug, ct.generation_mode AS content_generation_mode, ct.config_json, ct.schema_json FROM n8n_executions e JOIN n8n_workflows w ON w.id=e.workflow_id JOIN automations a ON a.id=(e.input_json->>'automationId')::uuid JOIN profiles p ON p.id=a.profile_id JOIN content_types ct ON ct.id=a.content_type_id WHERE e.id=$1",
        [body.jobId]
      );
      if (!execution.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n execution not found." } });
      if (body.status === "failed" || body.error) {
        await query("UPDATE n8n_executions SET status='failed',completed_at=now(),error_json=$2::jsonb WHERE id=$1", [body.jobId, JSON.stringify(body.error || { message: "n8n workflow reported failure." })]);
        return res.json({ ok: true, status: "failed" });
      }
      const ingested = await ingestN8nResult({ executionId: body.jobId, automation: execution.rows[0], result: body });
      if (ingested.status === "approved") {
        const jobs = await createPublishingJobs(ingested.contentId);
        const publishResults = [];
        for (const job of jobs) publishResults.push(await publishPublishingJob(job.id));
        return res.json({ ok: true, status: "published", contentId: ingested.contentId, jobs: publishResults });
      }
      res.json({ ok: true, status: ingested.status, contentId: ingested.contentId });
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
      await syncAutomationDestinations(result.rows[0].id, body.destinationAccountIds);
      res.status(201).json({ automation: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });
}
