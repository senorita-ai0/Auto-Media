
# Auto-Media — Product Requirements

## Vision

Auto-Media is a self-hosted multi-page social media content automation platform.

Core principle: **Page = configuration. Content Type = reusable logic. Automation = connection between them.**

A single installation must support brands/pages with completely different strategies without requiring a separate application or n8n workflow for each page.

## Supported content patterns

- AI-generated text posts
- AI-generated image posts
- AI-generated video workflows
- Local video selection and publishing
- Uploaded media
- Quote/fact image generation
- News/research content
- Product/announcement content
- Platform-specific adaptations

## Brand/Page Profile

A profile represents a content identity such as Future Tech or Viral Videos.

Fields:
- name, slug, description
- niche/topic
- language
- timezone
- tone
- audience
- master/initial prompt
- disclaimer
- hashtag rules
- visual identity
- logo/brand assets
- enabled content types
- destinations
- schedules

The master prompt is user-editable natural language and controls the profile's style and behavior.

## Social Accounts

Support connected destinations such as Facebook Pages, Instagram, YouTube, TikTok, X, Threads, LinkedIn, Pinterest, Reddit, Telegram and Discord.

Credentials must be stored securely and referenced by ID. Never hard-code tokens into source code, prompts, or imported workflow JSON.

## Content Types

Reusable recipes such as:
- Tech News Image
- Tech News Text
- Local Video
- AI Video
- Quote Image
- Product Update
- News Reel
- Carousel
- Announcement

A content type defines source, inputs, generation steps, AI settings, prompts, media requirements, validation, and publishing compatibility.

## Automations

An automation connects a profile to a content type.

Example:
Future Tech -> Tech News Image -> every 6 hours

It owns schedule, source configuration, generation configuration, destinations, approval mode, retries and limits.

## AI

Use one shared AI abstraction for many pages.

Configuration must support:
- provider and model
- global rules
- profile master prompt
- content-type prompt
- automation instructions
- structured JSON output
- fallback model/provider
- output limits
- retries/timeouts

Prompt composition:
Global Rules + Profile Prompt + Content Type Prompt + Automation Instructions + Source Data + Platform Rules.

## Content lifecycle

draft -> generating -> generated -> needs_review -> approved -> scheduled -> publishing -> published

Also support partially_published, failed, cancelled and archived.

## Media

Support:
- local images/videos
- generated images/videos
- remote URLs
- uploaded media
- logos
- thumbnails/posters
- captions/subtitles

Track path/storage key, URL, MIME type, dimensions, duration, size, checksum, source and processing state.

## Local video

A profile can point to one or more local folders.

The system must scan supported files, ignore already-used files, select according to rules, optionally generate captions with AI, create destination jobs, publish, record results and apply the configured reuse policy.

Selection rules should support oldest, newest, random, filename pattern, category/subfolder, unused-only, duration, aspect ratio and size.

## Image automation

Support recurring AI/template image posts with:
- AI image generation
- templates
- brand overlays
- logo
- footer
- text overlays
- platform-specific resizing

## n8n

n8n is the AI/automation execution engine, not the primary database.

Support:
- webhook/API invocation
- job IDs
- profile/content type/automation IDs
- callbacks
- execution tracking
- retries
- idempotency
- failures

Prefer a small number of reusable workflows over one workflow per page.

## ChatGPT-generated n8n JSON

Advanced users may ask ChatGPT to create an n8n workflow JSON, then import it.

Import flow:
1. Paste/upload JSON.
2. Validate structure.
3. Detect nodes and dependencies.
4. Detect credential requirements.
5. Detect embedded secrets.
6. Map credentials securely.
7. Test.
8. Save version.
9. Activate.

Never silently execute imported workflows.

## Publishing

A content item may publish to many destinations. Create one publishing job per destination and track each result independently.

Different platforms may need different captions, media formats, dimensions, limits, authentication, URL access or privacy settings.

## Scheduling

Support one-time, interval, daily, weekly, multiple daily times, timezone, quotas, quiet hours, manual run and approval queues.

## Approval

Modes:
- Auto Publish
- Review Required
- Generate Only

Review must show generated text, media, source, destinations and validation warnings with edit, approve, reject and regenerate actions.

## Logging

Track generation attempts, AI provider/model, duration, publishing attempts, destination, external post ID/URL, errors, retries and timestamps.

Google Sheets may remain an optional integration/export, not the source of truth.

## Security

- PostgreSQL as durable state
- encrypted/server-side credential storage
- environment secrets
- authenticated n8n callbacks
- file path validation
- audit logging
- no secrets in Git, prompts or workflow JSON

## Success criterion

A new page can be created by configuration only:
Create profile -> enter master prompt -> choose content types -> connect destinations -> configure schedule -> activate.
