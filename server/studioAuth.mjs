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

async function resolveStudioWorkspace(user) {
  const uid = String(user?.uid || "");
  if (!uid) throw new Error("Firebase token has no user ID.");
  const email = String(user?.email || "").trim().toLowerCase();
  const displayName = String(user?.name || email || "Studio User").trim();

  const existing = await query(
    "SELECT w.id,w.name,wm.role,su.id AS user_id FROM studio_users su JOIN workspace_members wm ON wm.user_id=su.id JOIN workspaces w ON w.id=wm.workspace_id WHERE su.firebase_uid=$1 ORDER BY wm.created_at LIMIT 1",
    [uid]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, name: existing.rows[0].name, role: existing.rows[0].role, userId: existing.rows[0].user_id };

  const createdUser = await query(
    "INSERT INTO studio_users (firebase_uid,email,display_name) VALUES ($1,$2,$3) RETURNING id",
    [uid, email, displayName]
  );
  const workspace = await query(
    "INSERT INTO workspaces (name) VALUES ($1) RETURNING id,name",
    [displayName + " Workspace"]
  );
  await query(
    "INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')",
    [workspace.rows[0].id, createdUser.rows[0].id]
  );
  return { id: workspace.rows[0].id, name: workspace.rows[0].name, role: "owner", userId: createdUser.rows[0].id };
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

  if (req.path === "/health" || req.path === "/n8n/callback" || /\/oauth\/[^/]+\/callback$/.test(req.path)) return next();

  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in is required to access Studio." } });

  try {
    req.user = await verifyStudioToken(token);
    if (!req.user) return res.status(401).json({ error: { code: "AUTH_INVALID", message: "Studio authentication is not configured." } });
    req.workspace = await resolveStudioWorkspace(req.user);
    req.actor = { uid: req.user.uid, email: req.user.email || "", name: req.user.name || "" };
    const method = String(req.method || "GET").toUpperCase();
    const role = req.workspace.role || "member";
    const adminPath = /\/accounts(?:\/|$)|\/credentials(?:\/|$)|\/n8n(?:\/|$)|\/members(?:\/|$)/.test(req.path);
    const mutation = method !== "GET";
    if (adminPath && !["owner","admin"].includes(role)) {
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
