import assert from "node:assert/strict";
import { scoreContent, significantNumbers } from "./contentQuality.mjs";
import { generateVariants, clampVariantCount } from "./variants.mjs";

const codes = r => r.issues.map(i => i.code);

// ---- a normal, good post is not penalised (false positives matter: a noisy gate gets switched off) ----
const good = scoreContent({
  title: "Chipmakers race to 2nm",
  caption: "Three of the biggest foundries have confirmed 2nm production plans for 2026.\nThe shift promises lower power draw for phones and data centres, though early yields remain the open question. What would you want from the next generation of chips?",
  hashtags: ["#chips", "#tech"],
  sourceText: "Three foundries confirmed 2nm plans for 2026, citing lower power draw."
});
assert.deepEqual(codes(good), [], "good post has no issues: " + JSON.stringify(good.issues));
assert.equal(good.score, 100);
assert.equal(good.grade, "A");

// ---- critical issues ----
const refusal = scoreContent({ caption: "As an AI language model, I cannot write promotional content about that." });
assert.equal(refusal.critical, true);
assert.ok(codes(refusal).includes("ai_boilerplate"));
assert.ok(refusal.score <= 40);

assert.ok(codes(scoreContent({ caption: "Here is the post you asked for: great launch today everyone, come and see what we built." })).includes("ai_boilerplate"));
assert.ok(codes(scoreContent({ caption: "Hello [Your Name], we are excited to announce our new product line this autumn season." })).includes("placeholder_text"));
assert.ok(codes(scoreContent({ caption: "Welcome to {{brand}} where everything is possible for our customers today." })).includes("placeholder_text"));
assert.ok(codes(scoreContent({ caption: "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor." })).includes("placeholder_text"));
const empty = scoreContent({ caption: "   " });
assert.ok(codes(empty).includes("empty_caption") && empty.critical && empty.score <= 40);

// a link with brackets or "[1]" style citations is NOT a placeholder
assert.ok(!codes(scoreContent({ caption: "The study found a clear effect [1] across all of the groups tested in the trial this year." })).includes("placeholder_text"));

// ---- warnings ----
assert.ok(codes(scoreContent({ caption: "Short one." })).includes("too_short"));
assert.ok(codes(scoreContent({ caption: "x ".repeat(900) })).includes("too_long"));
assert.ok(codes(scoreContent({ caption: "THIS IS AN ABSOLUTELY HUGE ANNOUNCEMENT FOR EVERYBODY WHO FOLLOWS OUR PAGE TODAY" })).includes("shouting"));
assert.ok(codes(scoreContent({ caption: "Wow! Amazing! Incredible! Unreal! This is a long enough caption for the test to run." })).includes("exclamation_overload"));
assert.ok(codes(scoreContent({ caption: "Party time 🎉🎉🎉🎉🎉🎉🎉🎉🎉 and more fun things to say about it." })).includes("emoji_overload"));
assert.ok(codes(scoreContent({ caption: "chips chips chips chips chips chips chips chips are great for chips and more chips chips chips today" })).includes("repetitive_wording"));
assert.ok(codes(scoreContent({ caption: "Follow us for daily updates and news.\nFollow us for daily updates and news.\nThanks for reading along today." })).includes("repeated_lines"));
const cliche = scoreContent({ caption: "This game-changer will unlock the power of your workflow and delve into the details of everything." });
assert.ok(codes(cliche).includes("cliches"));
assert.ok(cliche.issues.find(i => i.code === "cliches").penalty <= 12);
assert.ok(codes(scoreContent({ caption: "A solid post about something genuinely interesting happening in the tech world right now.", hashtags: [], profile: { hashtag_rules_json: { count: 5 } } })).includes("no_hashtags"));
assert.ok(!codes(scoreContent({ caption: "A solid post about something genuinely interesting happening in the tech world right now.", hashtags: [], profile: {} })).includes("no_hashtags"), "no hashtag rules means no complaint");

// ---- unsupported numbers (the "do not invent numbers" rule) ----
const invented = scoreContent({ caption: "Sales jumped 47% to $3.2 billion as the company shipped 12 million units this quarter.", sourceText: "Sales rose strongly this quarter as shipments grew." });
assert.ok(codes(invented).includes("unsupported_numbers"));
const supported = scoreContent({ caption: "Sales jumped 47% to $3.2 billion this quarter as shipments grew steadily across regions.", sourceText: "Revenue rose 47% to $3.2 billion in the quarter." });
assert.ok(!codes(supported).includes("unsupported_numbers"), JSON.stringify(supported.issues));
assert.deepEqual(significantNumbers("In 2026 we ship 3 items, 5% more, and 1,200 units"), ["5%", "1200"], "years and tiny list numbers are ignored");
assert.ok(!codes(scoreContent({ caption: "Without a source text nothing is checked here, so 99% is fine for this caption to claim." })).includes("unsupported_numbers"));

// ---- score is explainable and bounded ----
const bad = scoreContent({ caption: "As an AI I cannot. [Your Name] THIS IS ALL CAPS AND LOUD!!!! WOW!!!! 🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉" });
assert.ok(bad.score >= 0 && bad.score <= 40);
assert.ok(["D", "F"].includes(bad.grade));
for (const issue of bad.issues) assert.ok(issue.penalty > 0 && issue.message && issue.severity);

// ---- variants ----
assert.equal(clampVariantCount(undefined), 1);
assert.equal(clampVariantCount("3"), 3);
assert.equal(clampVariantCount(99), 4);
assert.equal(clampVariantCount(-2), 1);

// count = 1 behaves like a plain call (and surfaces validation errors)
let calls = 0;
const single = await generateVariants({ count: 1, generate: async () => { calls += 1; return { v: 1 }; }, validate: () => {}, score: () => 0 });
assert.equal(calls, 1);
assert.deepEqual(single.alternatives, []);
await assert.rejects(generateVariants({ count: 1, generate: async () => ({}), validate: () => { throw new Error("bad schema"); }, score: () => 0 }), /bad schema/);

// best-of-N picks the highest score, drops invalid candidates, keeps the earliest on ties
const pool = [{ id: "a", s: 50 }, { id: "bad", s: 99, invalid: true }, { id: "c", s: 80 }, { id: "d", s: 80 }];
const picked = await generateVariants({
  count: 4,
  generate: async i => pool[i],
  validate: c => { if (c.invalid) throw new Error("invalid"); },
  score: c => c.s,
  summarize: c => ({ id: c.id })
});
assert.equal(picked.generated.id, "c", "highest score wins, earliest on a tie");
assert.equal(picked.chosenIndex, 2);
assert.equal(picked.alternatives.length, 3, "invalid candidates are dropped");
assert.deepEqual(picked.alternatives.filter(a => a.chosen).map(a => a.id), ["c"]);

// some generations throw (provider error) -> the rest still compete
const flaky = await generateVariants({ count: 3, generate: async i => { if (i === 0) throw new Error("timeout"); return { s: i }; }, score: c => c.s });
assert.equal(flaky.generated.s, 2);

// every candidate fails -> the last error is reported
await assert.rejects(generateVariants({ count: 2, generate: async () => { throw new Error("provider down"); }, score: () => 0 }), /provider down/);

console.log("Content quality and variant tests passed.");
