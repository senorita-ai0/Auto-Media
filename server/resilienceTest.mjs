import assert from "node:assert/strict";
import { consecutiveFailures, shouldTrip } from "./circuitBreaker.mjs";
import { engagementScore, localSlot, bestPostingTimes, nextSlotAfter } from "./smartSchedule.mjs";

// ---- circuit breaker ----
const f = { status: "failed", error_code: "X" };
const ok = { status: "published" };
assert.equal(consecutiveFailures([f, f, f, ok, f, f]), 3, "a publish ends the streak");
assert.equal(consecutiveFailures([f, { status: "failed", error_code: "ACCOUNT_DISCONNECTED" }, f]), 2, "disconnected failures are ignored");
assert.equal(consecutiveFailures([]), 0);
assert.equal(shouldTrip([f, f, f], 3), true);
assert.equal(shouldTrip([f, f, ok, f], 3), false);

// ---- scoring ----
assert.equal(engagementScore({ likes: 10, comments: 2, shares: 1, impressions: 100 }), 17);
assert.equal(engagementScore({ engagement: 5, reach: 50 }), 10);
assert.equal(engagementScore({ likes: 4 }), 4, "raw count when reach unknown");
assert.equal(engagementScore({}), 0);

// ---- timezone-aware slots ----
assert.deepEqual(localSlot(new Date("2026-10-12T16:00:00Z"), "UTC"), { weekday: 1, hour: 16 });
assert.deepEqual(localSlot(new Date("2026-10-12T16:00:00Z"), "Asia/Karachi"), { weekday: 1, hour: 21 });
assert.deepEqual(localSlot(new Date("2026-10-12T20:00:00Z"), "Asia/Karachi"), { weekday: 2, hour: 1 }, "crosses midnight");

// ---- ranking: a consistently good slot beats one lucky post ----
const posts = [];
for (let week = 0; week < 6; week++) posts.push({ publishedAt: new Date(Date.UTC(2026, 8, 7 + week * 7, 18)).toISOString(), score: 8 }); // Mondays 18:00Z
posts.push({ publishedAt: "2026-09-09T03:00:00Z", score: 11 });                                                                      // one lucky Wed 03:00Z
for (let i = 0; i < 6; i++) posts.push({ publishedAt: new Date(Date.UTC(2026, 8, 10 + i * 7, 9)).toISOString(), score: 2 });         // Thursdays 09:00Z, weak
const result = bestPostingTimes(posts, { timeZone: "UTC" });
assert.equal(result.confident, true);
assert.equal(result.slots[0].day, "Mon");
assert.equal(result.slots[0].hour, 18);
assert.equal(result.slots[0].rank, 1);
assert.ok(result.slots.findIndex(s => s.day === "Wed") > 0, "single lucky post does not win");
assert.deepEqual(bestPostingTimes([]), { slots: [], sampleSize: 0, confident: false });
assert.equal(bestPostingTimes(posts.slice(0, 3)).confident, false);
assert.equal(bestPostingTimes([{ publishedAt: "garbage", score: 1 }, { publishedAt: "2026-09-07T18:00:00Z", score: NaN }]).sampleSize, 0);

// ---- next slot ----
const slot = nextSlotAfter([{ weekday: 1, hour: 18 }], new Date("2026-10-12T17:30:00Z"), "UTC");
assert.equal(slot.toISOString(), "2026-10-12T18:00:00.000Z");
const next = nextSlotAfter([{ weekday: 1, hour: 18 }], new Date("2026-10-12T18:00:00Z"), "UTC");
assert.equal(next.toISOString(), "2026-10-19T18:00:00.000Z", "strictly after the current instant");
assert.equal(nextSlotAfter([], new Date()), null);

console.log("Circuit breaker and smart scheduling tests passed.");
