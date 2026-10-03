import assert from "node:assert/strict";
import crypto from "node:crypto";

const LIVE = String(process.env.AUTO_MEDIA_RUN_PROVIDER_E2E || "").toLowerCase() === "true";
const CONFIRM = String(process.env.AUTO_MEDIA_E2E_CONFIRM || "");
const RUN = LIVE && CONFIRM === "POST_LIVE_TESTS";

const required = {
  youtube: ["AM_E2E_YOUTUBE_CLIENT_ID","AM_E2E_YOUTUBE_CLIENT_SECRET","AM_E2E_YOUTUBE_REFRESH_TOKEN"],
  facebook: ["AM_E2E_FB_PAGE_ID","AM_E2E_FB_PAGE_ACCESS_TOKEN"],
  instagram: ["AM_E2E_IG_USER_ID","AM_E2E_IG_ACCESS_TOKEN"],
  tiktok: ["AM_E2E_TIKTOK_ACCESS_TOKEN"],
  x: ["AM_E2E_X_ACCESS_TOKEN"],
  mastodon: ["AM_E2E_MASTODON_INSTANCE","AM_E2E_MASTODON_ACCESS_TOKEN"],
  linkedin: ["AM_E2E_LINKEDIN_ACCESS_TOKEN","AM_E2E_LINKEDIN_AUTHOR_URN"],
  pinterest: ["AM_E2E_PINTEREST_ACCESS_TOKEN","AM_E2E_PINTEREST_BOARD_ID"],
  reddit: ["AM_E2E_REDDIT_ACCESS_TOKEN","AM_E2E_REDDIT_SUBREDDIT","AM_E2E_REDDIT_THUMBNAIL_URL"],
  telegram: ["AM_E2E_TELEGRAM_BOT_TOKEN","AM_E2E_TELEGRAM_CHAT_ID"],
  discord: ["AM_E2E_DISCORD_WEBHOOK_URL"],
  threads: ["AM_E2E_THREADS_USER_ID","AM_E2E_THREADS_ACCESS_TOKEN"],
  bluesky: ["AM_E2E_BLUESKY_DID"],
  "x-oauth2": ["AM_E2E_X_ACCESS_TOKEN"],
  "reddit-oauth2": ["AM_E2E_REDDIT_ACCESS_TOKEN","AM_E2E_REDDIT_SUBREDDIT","AM_E2E_REDDIT_THUMBNAIL_URL"]
};

function available(name) {
  return (required[name] || []).every(key => String(process.env[key] || "").trim());
}

function reportHeader() {
  console.log("Auto-Media live provider E2E harness");
  console.log(RUN ? "LIVE TESTS ENABLED" : "DRY / SKIPPED");
  console.log("Set AUTO_MEDIA_RUN_PROVIDER_E2E=true and AUTO_MEDIA_E2E_CONFIRM=POST_LIVE_TESTS to allow external posts.");
}

async function run() {
  reportHeader();
  if (!RUN) {
    console.log("No provider APIs were called.");
    return;
  }

  const { getPlatformCapabilities } = await import("./platformCapabilities.mjs");
  const { postVideoToFacebook } = await import("./facebook.mjs");
  const { postVideoToInstagram } = await import("./instagram.mjs");
  const { postVideoToTikTok } = await import("./tiktok.mjs");
  const { postVideoToXOAuth2 } = await import("./xOAuth2.mjs");
  const { postVideoToMastodon } = await import("./mastodon.mjs");
  const { postVideoToLinkedIn } = await import("./linkedin.mjs");
  const { postVideoToPinterest } = await import("./pinterest.mjs");
  const { postVideoToRedditOAuth } = await import("./reddit.mjs");
  const { postVideoToTelegram } = await import("./telegram.mjs");
  const { postVideoToDiscord } = await import("./discord.mjs");
  const { postVideoToThreads } = await import("./threads.mjs");

  const buffer = Buffer.from("Auto-Media E2E fixture " + crypto.randomBytes(8).toString("hex"));
  const title = "[Auto-Media E2E] " + new Date().toISOString();
  const results = [];

  const tests = [
    ["facebook", () => postVideoToFacebook({ pageId:process.env.AM_E2E_FB_PAGE_ID,pageAccessToken:process.env.AM_E2E_FB_PAGE_ACCESS_TOKEN,buffer,filename:"automedia-e2e.mp4",title,description:"Automated integration test. Please delete this test post." })],
    ["instagram", () => postVideoToInstagram({ igUserId:process.env.AM_E2E_IG_USER_ID,accessToken:process.env.AM_E2E_IG_ACCESS_TOKEN,videoUrl:process.env.AM_E2E_PUBLIC_VIDEO_URL,caption:title })],
    ["tiktok", () => postVideoToTikTok({ accessToken:process.env.AM_E2E_TIKTOK_ACCESS_TOKEN,buffer,title })],
    ["x-oauth2", () => postVideoToXOAuth2({ accessToken:process.env.AM_E2E_X_ACCESS_TOKEN,buffer,text:title,mimeType:"video/mp4" })],
    ["mastodon", () => postVideoToMastodon({ instance:process.env.AM_E2E_MASTODON_INSTANCE,accessToken:process.env.AM_E2E_MASTODON_ACCESS_TOKEN,buffer,filename:"automedia-e2e.mp4",mimeType:"video/mp4",text:title })],
    ["linkedin", () => postVideoToLinkedIn({ accessToken:process.env.AM_E2E_LINKEDIN_ACCESS_TOKEN,authorUrn:process.env.AM_E2E_LINKEDIN_AUTHOR_URN,buffer,title,description:"Automated integration test." })],
    ["pinterest", () => postVideoToPinterest({ accessToken:process.env.AM_E2E_PINTEREST_ACCESS_TOKEN,boardId:process.env.AM_E2E_PINTEREST_BOARD_ID,buffer,filename:"automedia-e2e.mp4",title,description:"Automated integration test." })],
    ["reddit-oauth2", () => postVideoToRedditOAuth({ accessToken:process.env.AM_E2E_REDDIT_ACCESS_TOKEN,subreddit:process.env.AM_E2E_REDDIT_SUBREDDIT,buffer,filename:"automedia-e2e.mp4",title,thumbnailUrl:process.env.AM_E2E_REDDIT_THUMBNAIL_URL })],
    ["telegram", () => postVideoToTelegram({ botToken:process.env.AM_E2E_TELEGRAM_BOT_TOKEN,chatId:process.env.AM_E2E_TELEGRAM_CHAT_ID,buffer,filename:"automedia-e2e.mp4",caption:title })],
    ["discord", () => postVideoToDiscord({ webhookUrl:process.env.AM_E2E_DISCORD_WEBHOOK_URL,buffer,filename:"automedia-e2e.mp4",content:title })],
    ["threads", () => postVideoToThreads({ threadsUserId:process.env.AM_E2E_THREADS_USER_ID,accessToken:process.env.AM_E2E_THREADS_ACCESS_TOKEN,videoUrl:process.env.AM_E2E_PUBLIC_VIDEO_URL,text:title })]
  ];

  for (const [platform, fn] of tests) {
    if (!available(platform)) {
      results.push({ platform, status:"skipped", reason:"missing E2E environment configuration" });
      continue;
    }
    try {
      const result = await fn();
      results.push({ platform, status:"passed", result });
      console.log("PASS", platform);
    } catch (error) {
      results.push({ platform, status:"failed", error:error.message });
      console.error("FAIL", platform, error.message);
      if (String(process.env.AUTO_MEDIA_E2E_FAIL_FAST || "").toLowerCase() === "true") break;
    }
  }

  const failed = results.filter(x => x.status === "failed");
  console.log(JSON.stringify({ results }, null, 2));
  assert.equal(failed.length, 0, failed.length + " provider integration test(s) failed.");
}

await run();
