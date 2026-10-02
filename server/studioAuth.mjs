import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

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

export function studioAuthEnabled() {
  if (String(process.env.STUDIO_AUTH_REQUIRED || "false").toLowerCase() !== "true") return false;
  return configured();
}

export async function verifyStudioToken(token) {
  if (!ensureFirebaseAdmin()) return null;
  return getAuth().verifyIdToken(token);
}

export async function studioAuthMiddleware(req, res, next) {
  if (!studioAuthEnabled()) return next();

  if (req.path === "/health" || req.path === "/n8n/callback") return next();

  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in is required to access Studio." } });

  try {
    req.user = await verifyStudioToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: { code: "AUTH_INVALID", message: "Studio authentication token is invalid or expired." } });
  }
}
