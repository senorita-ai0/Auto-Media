// Best-time-to-post from the account's own engagement history. Pure functions over plain rows so they are
// testable; the route in studioRoutes loads the rows.
//
// Each post contributes its engagement score to the (weekday, hour) bucket it was published in, in the
// workspace's timezone. Buckets are ranked by a shrunk mean — (sum + prior*k) / (n + k) — so one lucky post in an
// otherwise empty slot cannot outrank a slot with many consistently good posts.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function engagementScore(metrics = {}) {
  const n = key => Number(metrics?.[key]) || 0;
  const interactions = n("engagement") || (n("likes") || n("reactions")) + n("comments") * 2 + n("shares") * 3 + n("saves") * 2 + n("clicks");
  const reach = n("impressions") || n("reach") || n("views");
  return reach > 0 ? (interactions / reach) * 100 : interactions; // rate when reach is known, raw count otherwise
}

export function localSlot(date, timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  const weekday = DAYS.indexOf(parts.find(p => p.type === "weekday")?.value);
  const hour = Number(parts.find(p => p.type === "hour")?.value);
  return { weekday, hour: hour === 24 ? 0 : hour };
}

/**
 * @param {Array<{publishedAt: string|Date, score: number}>} posts
 * @returns {{slots: Array<{weekday:number, day:string, hour:number, posts:number, meanScore:number, rank:number}>, sampleSize:number, confident:boolean}}
 */
export function bestPostingTimes(posts, { timeZone = "UTC", priorWeight = 2, minPosts = 10, top = 5 } = {}) {
  const valid = posts.filter(p => p && p.publishedAt && Number.isFinite(Number(p.score)) && !Number.isNaN(new Date(p.publishedAt).getTime()));
  if (!valid.length) return { slots: [], sampleSize: 0, confident: false };
  const overall = valid.reduce((sum, p) => sum + Number(p.score), 0) / valid.length;
  const buckets = new Map();
  for (const post of valid) {
    const { weekday, hour } = localSlot(new Date(post.publishedAt), timeZone);
    const key = weekday + ":" + hour;
    const bucket = buckets.get(key) || { weekday, hour, sum: 0, posts: 0 };
    bucket.sum += Number(post.score);
    bucket.posts += 1;
    buckets.set(key, bucket);
  }
  const slots = [...buckets.values()]
    .map(b => ({ weekday: b.weekday, day: DAYS[b.weekday], hour: b.hour, posts: b.posts, meanScore: Math.round(((b.sum + overall * priorWeight) / (b.posts + priorWeight)) * 100) / 100 }))
    .sort((a, b) => b.meanScore - a.meanScore || b.posts - a.posts || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, top)
    .map((slot, index) => ({ ...slot, rank: index + 1 }));
  return { slots, sampleSize: valid.length, confident: valid.length >= minPosts };
}

/** Next occurrence (strictly after `from`) of any of the given slots, in the given timezone. */
export function nextSlotAfter(slots, from = new Date(), timeZone = "UTC") {
  if (!slots.length) return null;
  const start = new Date(Math.ceil(from.getTime() / 3600000) * 3600000 + (from.getTime() % 3600000 === 0 ? 3600000 : 0));
  for (let h = 0; h < 24 * 7 + 1; h++) {
    const candidate = new Date(start.getTime() + h * 3600000);
    const { weekday, hour } = localSlot(candidate, timeZone);
    if (slots.some(s => s.weekday === weekday && s.hour === hour)) return candidate;
  }
  return null;
}
