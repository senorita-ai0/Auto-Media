const buckets = new Map();

function clientKey(req, prefix) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return prefix + ":" + (forwarded || req.ip || req.socket?.remoteAddress || "unknown");
}

export function rateLimit({ windowMs = 60_000, max = 120, prefix = "api" } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req, prefix);
    const current = buckets.get(key);
    if (!current || now >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - 1)));
      return next();
    }
    if (current.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Retry after " + retryAfter + " seconds." } });
    }
    current.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - current.count)));
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
}, 5 * 60_000).unref?.();
