import { databaseHealth, query } from "./db.mjs";
import { runNativeAutomation, ingestN8nResult, regenerateContentItem } from "./contentEngine.mjs";
import { saveCredential, listCredentialNames } from "./credentialVault.mjs";
import { createPublishingJobs, publishPublishingJob } from "./studioPublishing.mjs";
import { expandAutomationCalendar, nextAutomationRun, localDateKey } from "./calendar.mjs";
import { n8nHealth, validateN8nWorkflow, verifyCallbackSignature, invokeN8nWorkflow } from "./n8nService.mjs";
import { listOAuthProviders, startOAuth, finishOAuth } from "./oauth.mjs";
import { listUserWorkspaces } from "./studioAuth.mjs";
import crypto from "node:crypto";

async function ensureWorkspace(req = null) {
  if (req?.workspace) return req.workspace;
  const result = await query("SELECT id, name FROM workspaces ORDER BY created_at LIMIT 1");
  if (result.rows[0]) return result.rows[0];
  const created = await query("INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name", ["Default Workspace"]);
  return created.rows[0];
}

async function syncAutomationDestinations(automationId, accountIds, workspaceId = null) {
  const ids = Array.isArray(accountIds) ? [...new Set(accountIds.filter(Boolean))] : [];
  if (workspaceId && ids.length) {
    const allowed = await query("SELECT id FROM social_accounts WHERE workspace_id=$1 AND id = ANY($2::uuid[])", [workspaceId, ids]);
    const allowedIds = new Set(allowed.rows.map(x => x.id));
    if (allowedIds.size !== ids.length) throw new Error("One or more destination accounts do not belong to this workspace.");
  }
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

async function audit(workspaceId, action, entityType = null, entityId = null, before = {}, after = {}) {
  try {
    await query(
      "INSERT INTO audit_logs (workspace_id, actor, action, entity_type, entity_id, before_json, after_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [workspaceId, "system", action, entityType, entityId || null, JSON.stringify(before || {}), JSON.stringify(after || {})]
    );
  } catch (error) {
    console.warn("[studio-audit]", error.message);
  }
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function registerStudioRoutes(app) {
  app.get("/api/studio/oauth/providers", async (_req, res) => {
    res.json({ providers: listOAuthProviders() });
  });

  app.post("/api/studio/oauth/:provider/start", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      if (!req.user || !workspace.userId) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in before connecting a social account." } });
      const result = await startOAuth({ provider: String(req.params.provider).toLowerCase(), workspaceId: workspace.id, userId: workspace.userId });
      res.json(result);
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/oauth/:provider/callback", async (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    try {
      const result = await finishOAuth({
        provider,
        state: req.query.state,
        code: req.query.code,
        error: req.query.error,
        errorDescription: req.query.error_description
      });
      const redirectPath = "/#/accounts?oauth=complete&provider=" + encodeURIComponent(provider) + "&accounts=" + encodeURIComponent(String(result.accounts?.length || 0));
      return res.redirect(302, base + redirectPath);
    } catch (error) {
      const message = encodeURIComponent(error?.message || "OAuth connection failed.");
      return res.redirect(302, base + "/#/accounts?oauth=error&provider=" + encodeURIComponent(provider) + "&message=" + message);
    }
  });

  app.get("/api/studio/calendar", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const start = req.query.start ? new Date(req.query.start) : new Date();
      const end = req.query.end ? new Date(req.query.end) : new Date(start.getTime() + 31 * 86400000);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Valid start/end dates are required." } });
      }
      const result = await query(
        "SELECT a.*, p.name AS profile_name, ct.name AS content_type_name FROM automations a JOIN profiles p ON p.id=a.profile_id JOIN content_types ct ON ct.id=a.content_type_id WHERE p.workspace_id=$1 ORDER BY a.created_at",
        [workspace.id]
      );
      const events = expandAutomationCalendar(result.rows, start, end);
      const enriched = events.map((event) => {
        const automation = result.rows.find(x => x.id === event.automationId);
        return { ...event, calendarDate: localDateKey(new Date(event.start), event.timezone), nextRunAt: nextAutomationRun(automation, new Date(event.start)).toISOString() };
      });
      res.json({ start: start.toISOString(), end: end.toISOString(), events: enriched });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/health", async (req, res) => {
    res.json(await databaseHealth());
  });

  app.post("/api/studio/automations/:id/run", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const owned = await query("SELECT a.id FROM automations a JOIN profiles p ON p.id=a.profile_id WHERE a.id=$1 AND p.workspace_id=$2", [req.params.id, workspace.id]);
      if (!owned.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation not found." } });
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

  app.post("/api/studio/content/:id/regenerate", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const owned = await query("SELECT c.id FROM content_items c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1 AND p.workspace_id=$2", [req.params.id, workspace.id]);
      if (!owned.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content item not found." } });
      const result = await regenerateContentItem(req.params.id);
      if (result.status === "approved") {
        const jobs = await createPublishingJobs(result.contentId);
        const publishResults = [];
        for (const job of jobs) publishResults.push(await publishPublishingJob(job.id));
        const failed = publishResults.filter(x => x.status === "failed").length;
        result.publishResults = publishResults;
        result.status = failed === jobs.length ? "failed" : failed ? "partially_published" : "published";
        await query("UPDATE content_items SET status=$2,updated_at=now() WHERE id=$1", [result.contentId, result.status]);
      }
      res.status(201).json(result);
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/content/:id/schedule", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const when = new Date(req.body?.scheduledAt || "");
      if (Number.isNaN(when.getTime()) || when <= new Date()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "scheduledAt must be a valid future time." } });
      }
      const owned = await query("SELECT c.id,c.status FROM content_items c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1 AND p.workspace_id=$2", [req.params.id, workspace.id]);
      if (!owned.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content item not found." } });
      if (!["approved","scheduled"].includes(owned.rows[0].status)) return res.status(400).json({ error: { code: "INVALID_STATUS", message: "Content must be approved before it can be scheduled." } });
      if (["published","publishing"].includes(owned.rows[0].status)) return res.status(400).json({ error: { code: "INVALID_STATUS", message: "Published content cannot be rescheduled." } });

      await query("UPDATE content_items SET status='scheduled',updated_at=now() WHERE id=$1", [req.params.id]);
      const existing = await query(
        "UPDATE publishing_jobs SET status='scheduled',scheduled_at=$2,updated_at=now() WHERE content_item_id=$1 AND status IN ('queued','scheduled') RETURNING id,scheduled_at,status",
        [req.params.id, when.toISOString()]
      );
      const jobs = existing.rows.length ? existing.rows : await createPublishingJobs(req.params.id, when.toISOString());
      res.json({ contentId: req.params.id, scheduledAt: when.toISOString(), jobs });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/content/:id/cancel-schedule", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const owned = await query("SELECT c.id,c.status FROM content_items c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1 AND p.workspace_id=$2", [req.params.id, workspace.id]);
      if (!owned.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content item not found." } });
      if (owned.rows[0].status !== "scheduled") return res.status(400).json({ error: { code: "INVALID_STATUS", message: "This content item is not scheduled." } });
      await query("UPDATE publishing_jobs SET status='cancelled',updated_at=now() WHERE content_item_id=$1 AND status IN ('queued','scheduled')", [req.params.id]);
      const updated = await query("UPDATE content_items SET status='approved',updated_at=now() WHERE id=$1 RETURNING id,status", [req.params.id]);
      res.json({ content: updated.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/content/:id/approve", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query("UPDATE content_items SET status = 'approved', updated_at = now() WHERE id = $1 AND status IN ('needs_review','generated','draft') AND profile_id IN (SELECT id FROM profiles WHERE workspace_id=$2) RETURNING id,status", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content is not awaiting approval." } });
      const jobs = await createPublishingJobs(req.params.id);
      res.json({ content: result.rows[0], publishingJobs: jobs });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/content/:id/publish", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const state = await query("SELECT c.status FROM content_items c JOIN profiles p ON p.id=c.profile_id WHERE c.id = $1 AND p.workspace_id=$2", [req.params.id, workspace.id]);
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

  app.get("/api/studio/publishing-scheduler/status", async (req, res) => {
    const { getPublishingSchedulerStatus } = await import("./publishingScheduler.mjs");
    res.json(getPublishingSchedulerStatus());
  });

  app.get("/api/studio/publishing-jobs", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query(
        "SELECT pj.*, sa.name AS account_name, sa.platform, c.title, c.profile_id FROM publishing_jobs pj JOIN social_accounts sa ON sa.id = pj.social_account_id JOIN content_items c ON c.id = pj.content_item_id JOIN profiles p ON p.id = c.profile_id WHERE p.workspace_id = $1 ORDER BY pj.scheduled_at DESC NULLS LAST, pj.id DESC LIMIT 200",
        [workspace.id]
      );
      res.json({ jobs: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/publishing-jobs/:id/run", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const owned = await query("SELECT pj.id FROM publishing_jobs pj JOIN content_items c ON c.id=pj.content_item_id JOIN profiles p ON p.id=c.profile_id WHERE pj.id=$1 AND p.workspace_id=$2", [req.params.id, workspace.id]);
      if (!owned.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Publishing job not found." } });
      const result = await publishPublishingJob(req.params.id);
      res.json(result);
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/content", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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

  app.get("/api/studio/bootstrap", async (req, res) => {
    try {
      res.json({ workspace: await ensureWorkspace(req) });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get("/api/studio/profiles", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      const workspace = await ensureWorkspace(req);
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
      await audit(workspace.id, "profile.created", "profile", result.rows[0].id, {}, { id: result.rows[0].id, name: result.rows[0].name, slug: result.rows[0].slug });
      res.status(201).json({ profile: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.patch("/api/studio/profiles/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      values.push(workspace.id);
      const workspaceParam = values.length;
      const idParam = workspaceParam - 1;
      const result = await query("UPDATE profiles SET " + sets.join(", ") + " WHERE id = $" + idParam + " AND workspace_id = $" + workspaceParam + " RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found." } });
      await audit(result.rows[0].workspace_id, "profile.updated", "profile", result.rows[0].id, {}, { id: result.rows[0].id });
      res.json({ profile: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.delete("/api/studio/profiles/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query("DELETE FROM profiles WHERE id = $1 AND workspace_id = $2 RETURNING id", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found." } });
      res.status(204).end();
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get("/api/studio/workspaces", async (req, res) => {
    try {
      const workspaces = await listUserWorkspaces(req.user);
      res.json({ workspaces, currentWorkspace: req.workspace });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/members/invite", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      if (!["owner","admin"].includes(workspace.role)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Owner or admin permission is required to invite members." } });
      const email = String(req.body?.email || "").trim().toLowerCase();
      const role = String(req.body?.role || "member").trim().toLowerCase();
      if (!email || !email.includes("@")) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid email address is required." } });
      if (!["admin","editor","member"].includes(role)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unsupported invitation role." } });
      const studioUser = await query("SELECT id FROM studio_users WHERE id=$1", [workspace.userId]);
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const created = await query(
        "INSERT INTO workspace_invitations (workspace_id,email,role,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING id,email,role,expires_at",
        [workspace.id, email, role, tokenHash, studioUser.rows[0]?.id || null]
      );
      const inviteUrl = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") + "/#/team?invite=" + encodeURIComponent(rawToken) + "&workspace=" + encodeURIComponent(workspace.id);
      await audit(workspace.id, "workspace.member.invited", "workspace_invitation", created.rows[0].id, {}, { email, role, expiresAt: created.rows[0].expires_at });
      res.status(201).json({ invitation: created.rows[0], inviteUrl });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/invitations/:token/accept", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in before accepting a workspace invitation." } });
      const tokenHash = crypto.createHash("sha256").update(String(req.params.token || "")).digest("hex");
      const invitationResult = await query("SELECT * FROM workspace_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() LIMIT 1", [tokenHash]);
      if (!invitationResult.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invitation is invalid, expired, or already used." } });
      const invitation = invitationResult.rows[0];
      const email = String(req.user.email || "").trim().toLowerCase();
      if (!email || email !== String(invitation.email || "").toLowerCase()) {
        return res.status(403).json({ error: { code: "INVITEE_EMAIL_MISMATCH", message: "Sign in with the email address that received this invitation." } });
      }
      const userResult = await query(
        "INSERT INTO studio_users (firebase_uid,email,display_name) VALUES ($1,$2,$3) ON CONFLICT (firebase_uid) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,updated_at=now() RETURNING id",
        [req.user.uid, email, String(req.user.name || email)]
      );
      const userId = userResult.rows[0].id;
      await query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,updated_at=now()", [invitation.workspace_id, userId, invitation.role]);
      await query("UPDATE workspace_invitations SET accepted_by_user_id=$2,accepted_at=now() WHERE id=$1", [invitation.id, userId]);
      await audit(invitation.workspace_id, "workspace.member.invitation_accepted", "studio_user", userId, {}, { workspaceId: invitation.workspace_id, role: invitation.role });
      res.json({ ok: true, workspaceId: invitation.workspace_id, role: invitation.role });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/members", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query(
        "SELECT su.id,su.email,su.display_name,wm.role,wm.created_at FROM workspace_members wm JOIN studio_users su ON su.id=wm.user_id WHERE wm.workspace_id=$1 ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, su.email",
        [workspace.id]
      );
      res.json({ members: result.rows, currentRole: workspace.role, currentUserId: workspace.userId });
    } catch (error) { errorResponse(res, error); }
  });

  app.patch("/api/studio/members/:userId/role", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const role = String(req.body?.role || "").trim().toLowerCase();
      if (role === "owner" && workspace.role !== "owner") {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the workspace owner can assign the owner role." } });
      }
      if (!["owner","admin","editor","member"].includes(role)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unsupported workspace role." } });
      }
      const current = await query("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [workspace.id, req.params.userId]);
      if (current.rows[0]?.role === "owner" && workspace.role !== "owner") {
        return res.status(403).json({ error: { code: "OWNER_PROTECTED", message: "Only the workspace owner can change an owner role." } });
      }
      if (role === "owner" && workspace.role !== "owner") {
        return res.status(403).json({ error: { code: "OWNER_PROTECTED", message: "Only the workspace owner can assign the owner role." } });
      }
      if (!current.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workspace member not found." } });
      if (current.rows[0].role === "owner" && role !== "owner") {
        const owners = await query("SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id=$1 AND role='owner'", [workspace.id]);
        if (Number(owners.rows[0]?.count || 0) <= 1) {
          return res.status(400).json({ error: { code: "LAST_OWNER", message: "The workspace must keep at least one owner." } });
        }
      }
      const updated = await query(
        "UPDATE workspace_members SET role=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2 RETURNING workspace_id,user_id,role,updated_at",
        [workspace.id, req.params.userId, role]
      );
      await audit(workspace.id, "workspace.member.role_changed", "studio_user", req.params.userId, { role: current.rows[0].role }, { role });
      res.json({ member: updated.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/audit-logs", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
      const result = await query(
        "SELECT id,actor,action,entity_type,entity_id,before_json,after_json,created_at FROM audit_logs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2",
        [workspace.id, limit]
      );
      res.json({ logs: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/credentials", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      res.json({ credentials: await listCredentialNames(workspace.id) });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/accounts", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query(
        "SELECT * FROM social_accounts WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspace.id]
      );
      res.json({ accounts: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/accounts", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      await audit(workspace.id, "account.created", "social_account", result.rows[0].id, {}, { id: result.rows[0].id, platform: result.rows[0].platform, name: result.rows[0].name, status: result.rows[0].status });
      res.status(201).json({ account: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/accounts/import-legacy", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const raw = Array.isArray(req.body?.connectors)
        ? req.body.connectors
        : Object.entries(req.body?.connectors || {}).map(([platform, value]) => ({ platform, ...value }));
      const imported = [];
      for (const item of raw) {
        const platform = String(item?.platform || item?.id || "").trim().toLowerCase();
        if (!platform) continue;
        const payload = { ...item };
        delete payload.platform; delete payload.status; delete payload.updatedAt; delete payload.name; delete payload.id;
        const externalAccountId = item.pageId || item.igUserId || item.threadsUserId || item.channelId || item.boardId || item.chatId || item.authorUrn || null;
        const name = String(item.name || (platform + (externalAccountId ? " · " + externalAccountId : " · legacy"))).trim();
        const credentialName = "legacy:" + platform + ":" + (externalAccountId || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        await saveCredential(workspace.id, credentialName, payload);
        const existing = await query("SELECT id FROM social_accounts WHERE workspace_id=$1 AND platform=$2 AND name=$3", [workspace.id, platform, name]);
        let account;
        if (existing.rows[0]) {
          const updated = await query(
            "UPDATE social_accounts SET external_account_id=$2, credential_ref=$3, metadata_json=$4::jsonb, status='connected', updated_at=now() WHERE id=$1 RETURNING id,name,platform,status,credential_ref,external_account_id,metadata_json",
            [existing.rows[0].id, externalAccountId, credentialName, JSON.stringify({ migratedFrom: "legacy-connectors" })]
          );
          account = updated.rows[0];
        } else {
          const created = await query(
            "INSERT INTO social_accounts (workspace_id,platform,name,external_account_id,credential_ref,metadata_json,status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'connected') RETURNING id,name,platform,status,credential_ref,external_account_id,metadata_json",
            [workspace.id, platform, name, externalAccountId, credentialName, JSON.stringify({ migratedFrom: "legacy-connectors" })]
          );
          account = created.rows[0];
        }
        imported.push(account);
      }
      for (const account of imported) await audit(workspace.id, "account.migrated", "social_account", account.id, {}, { id: account.id, platform: account.platform, migratedFrom: "legacy-connectors" });
      res.status(201).json({ imported });
    } catch (error) { errorResponse(res, error); }
  });

  app.patch("/api/studio/accounts/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      values.push(workspace.id);
      const workspaceParam = values.length;
      const idParam = workspaceParam - 1;
      const result = await query("UPDATE social_accounts SET " + sets.join(", ") + " WHERE id = $" + idParam + " AND workspace_id = $" + workspaceParam + " RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Social account not found." } });
      res.json({ account: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/accounts/:id/credential", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const accountResult = await query("SELECT workspace_id, credential_ref FROM social_accounts WHERE id = $1 AND workspace_id = $2", [req.params.id, workspace.id]);
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
      const workspace = await ensureWorkspace(req);
      const result = await query("DELETE FROM social_accounts WHERE id = $1 AND workspace_id = $2 RETURNING id", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Social account not found." } });
      res.status(204).end();
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/content-types", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      const workspace = await ensureWorkspace(req);
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
      await audit(workspace.id, "content_type.created", "content_type", result.rows[0].id, {}, { id: result.rows[0].id, name: result.rows[0].name });
      res.status(201).json({ contentType: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.patch("/api/studio/content-types/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      values.push(workspace.id);
      const workspaceParam = values.length;
      const idParam = workspaceParam - 1;
      const result = await query("UPDATE content_types SET " + sets.join(", ") + " WHERE id = $" + idParam + " AND (workspace_id = $" + workspaceParam + " OR workspace_id IS NULL) RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Content type not found." } });
      res.json({ contentType: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.delete("/api/studio/content-types/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query("DELETE FROM content_types WHERE id = $1 AND workspace_id = $2 AND built_in = FALSE RETURNING id", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Custom content type not found or is built-in." } });
      res.status(204).end();
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/automations", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      const workspace = await ensureWorkspace(req);
      const body = req.body || {};
      if (body.profileId) {
        const checkProfile = await query("SELECT id FROM profiles WHERE id=$1 AND workspace_id=$2", [body.profileId, workspace.id]);
        if (!checkProfile.rows[0]) return res.status(400).json({ error: { code: "OWNERSHIP_ERROR", message: "Profile must belong to this workspace." } });
      }
      if (body.contentTypeId) {
        const checkType = await query("SELECT id FROM content_types WHERE id=$1 AND (workspace_id=$2 OR workspace_id IS NULL)", [body.contentTypeId, workspace.id]);
        if (!checkType.rows[0]) return res.status(400).json({ error: { code: "OWNERSHIP_ERROR", message: "Content type must belong to this workspace." } });
      }
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
      values.push(workspace.id);
      const workspaceParam = values.length;
      const idParam = workspaceParam - 1;
      const result = await query("UPDATE automations SET " + sets.join(", ") + " WHERE id = $" + idParam + " AND profile_id IN (SELECT id FROM profiles WHERE workspace_id = $" + workspaceParam + ") RETURNING *", values);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation not found." } });
      if (body.destinationAccountIds !== undefined) await syncAutomationDestinations(result.rows[0].id, body.destinationAccountIds, workspace.id);
      const nextRun = result.rows[0].enabled && result.rows[0].schedule_type !== "manual" ? nextAutomationRun(result.rows[0], new Date()) : null;
      await query("UPDATE automations SET next_run_at=$2, updated_at=now() WHERE id=$1", [result.rows[0].id, nextRun ? nextRun.toISOString() : null]);
      result.rows[0].next_run_at = nextRun ? nextRun.toISOString() : null;
      res.json({ automation: result.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.delete("/api/studio/automations/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query("DELETE FROM automations WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE workspace_id = $2) RETURNING id", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation not found." } });
      res.status(204).end();
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/n8n/status", async (req, res) => {
    res.json(await n8nHealth());
  });

  app.get("/api/studio/n8n/workflows", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query(
        "SELECT id,name,description,n8n_workflow_id,version,status,imported_from,credential_map_json,created_at,updated_at FROM n8n_workflows WHERE workspace_id=$1 ORDER BY updated_at DESC",
        [workspace.id]
      );
      res.json({ workflows: result.rows });
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/n8n/workflows/:id", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const result = await query("SELECT * FROM n8n_workflows WHERE id=$1 AND workspace_id=$2", [req.params.id, workspace.id]);
      if (!result.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const workflow = result.rows[0];
      const validation = validateN8nWorkflow(workflow.workflow_json);
      res.json({ workflow: { ...workflow, validation: validation.report, validationErrors: validation.errors, validationWarnings: validation.warnings } });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/import", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const validation = validateN8nWorkflow(req.body?.workflow ?? req.body?.json);
      if (!validation.workflow || !validation.valid) {
        return res.status(400).json({ error: { code: "N8N_WORKFLOW_INVALID", message: validation.errors.join(" ") || "n8n workflow failed validation.", details: validation.report, warnings: validation.warnings } });
      }
      const name = String(req.body?.name || validation.report.name || "Imported n8n workflow").trim();
      const externalId = validation.workflow.id || null;
      const latest = await query(
        "SELECT COALESCE(MAX(version),0) AS version FROM n8n_workflows WHERE workspace_id=$1 AND ((n8n_workflow_id IS NOT NULL AND n8n_workflow_id=$2) OR (n8n_workflow_id IS NULL AND name=$3))",
        [workspace.id, externalId, name]
      );
      const nextVersion = Number(latest.rows[0]?.version || 0) + 1;
      const result = await query(
        "INSERT INTO n8n_workflows (workspace_id,name,description,workflow_json,n8n_workflow_id,version,status,imported_from) VALUES ($1,$2,$3,$4::jsonb,$5,$6,'draft',$7) RETURNING id,name,description,n8n_workflow_id,version,status,imported_from,created_at,updated_at",
        [workspace.id, name, String(req.body?.description || ""), JSON.stringify(validation.workflow), externalId, nextVersion, String(req.body?.importedFrom || "chatgpt")]
      );
      await audit(workspace.id, "n8n.workflow.imported", "n8n_workflow", result.rows[0].id, {}, { id: result.rows[0].id, name: result.rows[0].name, version: result.rows[0].version, importedFrom: result.rows[0].imported_from });
      res.status(201).json({ workflow: result.rows[0], validation: validation.report, warnings: validation.warnings });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/duplicate", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      const workspace = await ensureWorkspace(req);
      const current = await query("SELECT id,workflow_json FROM n8n_workflows WHERE id=$1 AND workspace_id=$2", [req.params.id, workspace.id]);
      if (!current.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const validation = validateN8nWorkflow(current.rows[0].workflow_json);
      if (!validation.valid) return res.status(400).json({ error: { code: "N8N_WORKFLOW_INVALID", message: validation.errors.join(" "), details: validation.report } });
      const updated = await query("UPDATE n8n_workflows SET status='active', updated_at=now() WHERE id=$1 RETURNING id,name,status,version,updated_at", [req.params.id]);
      await audit(workspace.id, "n8n.workflow.activated", "n8n_workflow", updated.rows[0].id, {}, { status: "active", version: updated.rows[0].version });
      res.json({ workflow: updated.rows[0], validation: validation.report });
    } catch (error) { errorResponse(res, error); }
  });

  app.patch("/api/studio/n8n/workflows/:id/credentials", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const current = await query("SELECT id FROM n8n_workflows WHERE id=$1 AND workspace_id=$2", [req.params.id, workspace.id]);
      if (!current.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      const mapping = req.body?.mapping && typeof req.body.mapping === "object" && !Array.isArray(req.body.mapping) ? req.body.mapping : {};
      const clean = Object.fromEntries(Object.entries(mapping).filter(([key, value]) => String(key).trim() && String(value || "").trim()).map(([key, value]) => [String(key).trim(), String(value).trim()]));
      const updated = await query("UPDATE n8n_workflows SET credential_map_json=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING id,name,credential_map_json,version,status,updated_at", [req.params.id, JSON.stringify(clean)]);
      await audit(workspace.id, "n8n.workflow.credentials_mapped", "n8n_workflow", updated.rows[0].id, {}, { credentialMap: clean });
      res.json({ workflow: updated.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/deactivate", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
      const updated = await query("UPDATE n8n_workflows SET status='inactive',updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id,name,status,version,updated_at", [req.params.id, workspace.id]);
      if (!updated.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "n8n workflow not found." } });
      await audit(workspace.id, "n8n.workflow.deactivated", "n8n_workflow", updated.rows[0].id, {}, { status: "inactive" });
      res.json({ workflow: updated.rows[0] });
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/studio/n8n/workflows/:id/test", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
        const rawBody = invoked?.response?.data || invoked?.response || {};
        const body = Array.isArray(rawBody) ? (rawBody[0]?.json || rawBody[0] || {}) : rawBody;
        await query("UPDATE n8n_executions SET status='triggered',external_execution_id=$2,output_json=$3::jsonb WHERE id=$1", [executionId, body?.executionId || body?.id || null, JSON.stringify(body)]);
        res.json({ executionId, status: "triggered", response: body });
      } catch (error) {
        await query("UPDATE n8n_executions SET status='failed',completed_at=now(),error_json=$2::jsonb WHERE id=$1", [executionId, JSON.stringify({ message: error.message })]);
        throw error;
      }
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/studio/n8n/executions", async (req, res) => {
    try {
      const workspace = await ensureWorkspace(req);
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
      const workspace = await ensureWorkspace(req);
      const check = await query(
        "SELECT p.id AS profile_id, ct.id AS content_type_id FROM profiles p JOIN content_types ct ON ct.id=$2 WHERE p.id=$1 AND p.workspace_id=$3 AND (ct.workspace_id=$3 OR ct.workspace_id IS NULL)",
        [body.profileId, body.contentTypeId, workspace.id]
      );
      if (!check.rows[0]) return res.status(400).json({ error: { code: "OWNERSHIP_ERROR", message: "Profile and content type must belong to this workspace." } });
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
      await syncAutomationDestinations(result.rows[0].id, body.destinationAccountIds, workspace.id);
      const nextRun = result.rows[0].enabled && result.rows[0].schedule_type !== "manual" ? nextAutomationRun(result.rows[0], new Date()) : null;
      await query("UPDATE automations SET next_run_at=$2, updated_at=now() WHERE id=$1", [result.rows[0].id, nextRun ? nextRun.toISOString() : null]);
      result.rows[0].next_run_at = nextRun ? nextRun.toISOString() : null;
      await audit(workspace.id, "automation.created", "automation", result.rows[0].id, {}, { id: result.rows[0].id, name: result.rows[0].name });
      res.status(201).json({ automation: result.rows[0] });
    } catch (error) {
      errorResponse(res, error);
    }
  });
}
