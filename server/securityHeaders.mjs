// Dependency-free security headers plus an origin allow-list for CORS.

export function securityHeaders() {
  const behindHttps = String(process.env.PUBLIC_BASE_URL || "").startsWith("https://");
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.removeHeader("X-Powered-By");
    if (behindHttps) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
  };
}

/**
 * CORS_ORIGINS is a comma-separated allow-list. Empty/unset keeps the previous permissive behaviour
 * (suitable for local development); set it in production, e.g. CORS_ORIGINS=https://studio.example.com
 */
export function corsOptions() {
  const allowed = String(process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!allowed.length) return {};
  return {
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) return callback(null, true);
      callback(null, false);
    }
  };
}
