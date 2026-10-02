import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { query } from "./db.mjs";

function configured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

let initialized = false;

function ensureFirebaseAdmin() {
  if (!configured()) return false;
  if (!initialized) {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n")
        })
      });
    }
    initialized = true;
  }
  return true;
}

async function ensureStudioUser(user) {
  const uid = String(user?.uid || "");
  if (!uid) throw new Error("Firebase token has no user ID.");
  const email = String(user?.email || "").trim().toLowerCase();
  const displayName = String(user?.name || email || "Studio User").trim();
  const result = await query(
    "INSERT INTO studio_users (firebase_uid,email,display_name) VALUES ($1,$2,$3) ON CONFLICT (firebase_uid) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,updated_at=now() RETURNING id",
    [uid, email, displayName]
  );
  return { id: result.rows[0].id, uid, email, displayName };
}

async function resolveStudioWorkspace(user, requestedWorkspaceId = null) {
  const studioUser = await ensureStudioUser(user);
  const params = [studioUser.id];
  let sql = "SELECT w.id,w.name,wm.role,wm.user_id FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=$1";
  if (requestedWorkspaceId) {
    params.push(requestedWorkspaceId);
    sql += " AND w.id=$2";
  }
  sql += " ORDER BY wm.created_at LIMIT 1";
  const existing = await query(sql, params);
  if (existing.rows[0]) return { id: existing.rows[0].id, name: existing.rows[0].name, role: existing.rows[0].role, userId: existing.rows[0].user_id };

  if (requestedWorkspaceId) throw new Error("You do not belong to the selected Studio workspace.");

  const workspace = await query("INSERT INTO workspaces (name) VALUES ($1) RETURNING id,name", [studioUser.displayName + " Workspace"]);
  await query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING", [workspace.rows[0].id, studioUser.id]);
  return { id: workspace.rows[0].id, name: workspace.rows[0].name, role: "owner", userId: studioUser.id };
}

export async function listUserWorkspaces(user) {
  const studioUser = await ensureStudioUser(user);
  const result = await query(
    "SELECT w.id,w.name,wm.role FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=$1 ORDER BY w.created_at",
    [studioUser.id]
  );
  return result.rows;
}

export function studioAuthRequired() {
  return String(process.env.STUDIO_AUTH_REQUIRED || "false").toLowerCase() === "true";
}

export async function verifyStudioToken(token) {
  if (!ensureFirebaseAdmin()) return null;
  return getAuth().verifyIdToken(token);
}

export async function studioAuthMiddleware(req, res, next) {
  if (!studioAuthRequired()) return next();
  if (!configured()) return res.status(503).json({ error: { code: "AUTH_MISCONFIGURED", message: "Studio authentication is required but Firebase Admin is not configured." } });

  if (req.path === "/health" || req.path === "/n8n/callback" || /\/oauth\/[^/]+\/callback$/.test(req.path) || /\/oauth\/bluesky\/client-metadata\.json$/.test(req.path)) return next();

  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in is required to access Studio." } });

  try {
    req.user = await verifyStudioToken(token);
    if (!req.user) return res.status(401).json({ error: { code: "AUTH_INVALID", message: "Studio authentication is not configured." } });
    req.actor = { uid: req.user.uid, email: req.user.email || "", name: req.user.name || "" };
    if (/\/invitations\/[^/]+\/accept$/.test(req.path)) return next();
    const requestedWorkspace = String(req.headers["x-auto-media-workspace"] || "").trim() || null;
    req.workspace = await resolveStudioWorkspace(req.user, requestedWorkspace);
    const method = String(req.method || "GET").toUpperCase();
    const role = req.workspace.role || "member";
    const adminPath = /\/accounts(?:\/|$)|\/credentials(?:\/|$)|\/n8n(?:\/|$)|\/members(?:\/|$)|\/oauth\/[^/]+\/start$|\/ai\/providers(?:\/|$)/.test(req.path);
    const mutation = method !== "GET";
    if (adminPath && mutation && !["owner","admin"].includes(role)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Owner or admin permission is required for this operation." } });
    }
    if (mutation && role === "member") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Editor permission or higher is required for this operation." } });
    }
    next();
  } catch (error) {
    res.status(401).json({ error: { code: "AUTH_INVALID", message: "Studio authentication token is invalid or expired." } });
  }
}
