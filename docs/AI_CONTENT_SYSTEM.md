
# Auto-Media — AI Content System

## Goal

Use shared AI infrastructure while allowing every profile to define its own content behavior.

## Prompt hierarchy

1. Global rules
2. Profile master/initial prompt
3. Content type prompt
4. Automation instructions
5. Source/context data
6. Platform adaptation rules

## Example

Profile: Future Tech

Master prompt:
Create original, easy-to-understand technology news content. Focus on useful facts and avoid copying source wording. Use a modern, engaging but factual tone.

Content type: Tech News Image

Content prompt:
Write a short social post about the selected story and create an image direction representing the story.

Automation:
Every 6 hours, configured technology sources, Facebook + Instagram.

The same content type can be reused by another profile with a different master prompt.

## Structured generation

Prefer validated structured output, for example:

~~~json
{
  "title": "...",
  "caption": "...",
  "hashtags": ["..."],
  "category": "AI",
  "image_prompt": "...",
  "source": {
    "title": "...",
    "url": "..."
  }
}
~~~

## AI provider abstraction

Expose:
- generateText
- generateStructured
- generateImage
- generateVideo

Provider/model selection must be configurable.

## Prompt UX

Every profile gets a prominent editable Initial / Master Prompt field. Users should not need to understand n8n.

## Versioning

Store prompt version and associate generated content with the exact version used.

## Regeneration

Allow regenerating caption, image prompt, image or the whole item. Keep generation history.

## Brand policy and branding

Every native generation applies the owning profile's policy after the model responds:

1. Hashtags are normalised and constrained by `hashtag_rules_json` (`count`/`min`/`max`/`required`/`avoid`).
2. The profile disclaimer is appended once.
3. The caption is compared (word 3-gram Jaccard similarity, threshold 0.6) with the 40 most recent captions of the same profile and content type; a near-duplicate or empty caption forces `needs_review` regardless of the automation's approval mode.
4. For image content the generated image is composited with the profile's logo/watermark brand asset and optional footer band (`visual_identity_json`).

Applied flags are stored in `structured_data_json.policyFlags` and shown on the review card. The same policy runs for first-time generation and regeneration.

## Secrets

Never put API keys, tokens, passwords or private keys into prompts, source code, Git or exported workflow JSON.

## Platform-aware formatting

Before a post is sent, `platformFormatter.mjs` adapts it to the destination: grapheme-aware length limits (X uses weighted length: URLs count 23, CJK and emoji count 2), per-platform hashtag caps, optional UTM tagging, Bluesky link/hashtag facets, and YouTube tags. Per-destination overrides live in `automation_destinations.platform_config_json`:

| key | meaning |
| --- | --- |
| `maxChars` / `limit` | override the platform character limit |
| `hashtags: false` / `maxHashtags` | drop hashtags or cap them |
| `mode` | `full`, `title` or `caption` |
| `utm` | UTM parameters appended to links (opt-in) |
| `link: false` | omit the source link |

## Quality gate and variants

`contentQuality.mjs` scores every generated post 0-100 with explainable issues (leaked AI boilerplate, template placeholders, shouting, clichés, repeated wording, figures not found in the source, ...). Critical issues cap the score at 40. Posts below `generation_config_json.minQualityScore` (default 55) or with a critical issue are held as `needs_review` even on auto-approve automations. The score and issues are stored in `structured_data_json.quality` and shown on the review card.

`generation_config_json.variants` (1-4, default 1) generates that many candidates, drops schema-invalid ones, and keeps the highest-scoring; the alternatives are stored in `structured_data_json.variants`.

## AI resilience and prompt-injection defence

- Failover: the automation's provider is tried first, then the workspace's other enabled providers, then the `AI_*` environment provider. Transient errors (timeouts, 408/429/5xx) are retried with exponential backoff and jitter (`AI_RETRIES`, default 1; `AI_RETRY_BASE_MS`, default 500) before moving on; auth and validation errors fail over immediately.
- Untrusted source text (RSS summaries, article excerpts) is wrapped in `<untrusted_source>` tags with an instruction that it is data, never commands. Instruction-like content ("ignore previous instructions", role tags, chat-template tokens) adds a `suspicious_source` flag and forces review. This reduces the risk; it cannot remove it, which is why detection forces a human look.

## Smart scheduling and account circuit breaker

- `GET /api/studio/insights/best-times?platform=&timeZone=` ranks (weekday, hour) slots from the engagement of your own published posts, with shrinkage so a single lucky post cannot win, and returns the next best slot. The Insights page shows it; fewer than 10 measured posts is flagged as a rough guide.
- After `ACCOUNT_BREAKER_THRESHOLD` (default 5) consecutive final publish failures an account is set to `error` and an `account.circuit_open` alert is sent, so publishing stops hammering the provider. Re-testing or reconnecting the account resumes it. `GET /api/studio/insights/account-health` summarises the last 30 days per account.
