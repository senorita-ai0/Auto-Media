// Firebase web configuration, supplied through Vite environment variables.
// Firebase web keys are identifiers rather than secrets, but they still should not be hard-coded:
// each deployment (dev / staging / production) uses its own project.
//
// Set these at build time (see .env.example; Docker passes them as build args):
//   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
//   VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID
const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: env.VITE_FIREBASE_APP_ID || "",
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

if (!firebaseConfigured && typeof console !== "undefined") {
  console.warn("[Auto-Media] Firebase is not configured. Set the VITE_FIREBASE_* variables and rebuild to enable sign-in.");
}

// Optional Google Sheets API key for the legacy Sheet page (restrict it by HTTP referrer + API scope).
// Use a dedicated key; do not reuse the Firebase key.
export const googleSheetsApiKey = env.VITE_GOOGLE_SHEETS_API_KEY || "";
