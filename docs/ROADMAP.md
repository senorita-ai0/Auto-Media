
# Auto-Media — Implementation Roadmap

## Phase 0 — Specification
- [x] Product requirements
- [x] Architecture
- [x] AI content system
- [x] Data model
- [x] n8n contract
- [x] Publishing architecture
- [x] ChatGPT/n8n import design
- [x] AI agent guide

## Phase 1 — Multi-profile foundation
- [x] PostgreSQL and migrations foundation
- [x] Profiles CRUD foundation
- [x] Social accounts CRUD foundation
- [x] Secure credential references
- [x] Content types CRUD foundation
- [x] Automations CRUD foundation
- [x] Schedules/configuration foundation
- [x] restart-safe persisted scheduler
- [x] Profile master prompt editor
- [x] workspace creation, selection and invitations
- [x] automation duplication across profiles

Acceptance: create Future Tech and Viral Videos with different prompts/content types without modifying code.

## Phase 2 — Content engine
- [x] content_items
- [x] media_assets
- [x] Media Library uploads and profile-scoped reusable video assets
- [x] local media scanner
- [x] AI provider abstraction
- [x] prompt composition
- [x] structured output validation
- [x] generation execution records
- [x] shared workspace AI providers and encrypted API keys
- [x] durable generation job queue with retry worker
- [x] automation batch generation
- [x] review
- [x] regeneration

Acceptance: Future Tech generates an AI image post while Viral Videos selects a local video through the same application.

## Phase 3 — n8n bridge
- [x] n8n settings/status
- [x] webhook invocation
- [x] callback
- [x] execution tracking
- [x] runtime payload
- [x] migrate Future Tech workflow
- [x] remove page hard-coding

Acceptance: one n8n workflow serves multiple profiles.

## Phase 4 — Publishing
- [x] publishing_jobs
- [x] publisher interface foundation
- [x] encrypted credential vault foundation
- [x] native Facebook/Instagram image publishing
- [x] native local-video publishing adapters using existing platform modules
- [x] idempotency
- [x] result tracking
- [x] bounded automatic publishing retries with backoff
- [x] scheduled publishing worker and UI
- [x] legacy credential migration from Connectors into encrypted Studio vault
- [x] OAuth connection flows for YouTube/Google, LinkedIn, TikTok, Facebook/Instagram, Threads and Pinterest
- [x] account health checks and safe disconnect lifecycle
- [x] TikTok token refresh lifecycle
- [x] X OAuth2 PKCE + v2 media publishing
- [x] Mastodon instance OAuth2 + video publishing
- [x] Reddit OAuth2 + subreddit-bound video publishing
- [x] Bluesky OAuth + session refresh + text/image publishing
- [x] Telegram bot destination credentials
- [x] Discord webhook destination credentials
- [x] Bluesky video publishing (platform-specific processing adapter)

Acceptance: one content item can independently publish to Facebook, Instagram and TikTok.

## Phase 5 — Dashboard
- [x] Profiles foundation
- [x] Accounts foundation
- [x] Content Types foundation
- [x] Automations foundation
- [x] Content Library foundation
- [x] Review queue
- [x] Calendar
- [x] Publishing queue foundation
- [x] Logs

## Phase 6 — AI workflow import
- [x] n8n JSON import
- [x] schema/structure validation
- [x] node/dependency detection
- [x] credential mapping UI
- [x] secret detection
- [x] test execution
- [x] versioning via duplicate/imported versions
- [x] export

## Phase 7 — Production hardening
- [x] encrypted secrets
- [x] authentication foundation via Firebase ID tokens
- [x] authorization and workspace role enforcement
- [x] audit logs with authenticated actor identity
- [x] backups (optional Docker backup profile)
- [x] observability (workspace metrics/overview)
- [x] worker queue foundations (native + publishing schedulers)
- [x] object storage adapter (S3/MinIO compatible)
- [x] signed/public media URL support
- [x] retention / cleanup worker

## First real milestone

Future Tech:
- Tech News Image
- RSS source
- AI text + image
- Future Tech master prompt
- Facebook + Instagram
- every 6 hours

Viral Videos:
- Local Video
- local folder
- AI caption
- Viral Videos master prompt
- Facebook + Instagram + TikTok
- 3 times/day

Both must run without separate page-specific n8n workflows.


## Phase 8 — Multi-brand operator UX
- [x] global workspace switcher
- [x] shared AI provider management
- [x] Quick Setup blueprints
- [x] Media Library uploads
- [x] profile hashtag rules
- [x] profile visual identity
- [x] reusable brand asset/logo assignment
- [x] content calendar drag/drop editing
- [x] publishing analytics dashboards per platform
- [x] normalized external engagement snapshots for supported platforms
- [x] post-level engagement analytics for supported adapters
- [x] provider-specific historical backfill and deeper post metrics

Acceptance: one workspace can manage many brands with distinct prompts, hashtag rules, visual identity, media libraries, schedules and AI configuration without duplicating server code.


## Phase 9 — Production reliability
- [x] liveness/readiness runtime endpoints
- [x] graceful worker/database shutdown
- [x] transactional, advisory-lock protected migrations
- [x] dependency-free Studio API rate limiting
- [x] trusted-proxy-aware client IP handling
- [x] production deployment/upgrade runbook
- [x] durable generation queue and retry worker
- [x] durable scheduled publishing worker
- [x] distributed-safe row claiming for generation/publishing/native scheduler workers
- [x] distributed worker locking for multi-container horizontal scaling
- [x] optional external failure alert webhook
- [x] richer notification routing (Slack/email/etc.)
- [x] automated restore verification
- [x] publisher adapter dispatch contract suite
- [x] end-to-end provider sandbox harness (opt-in real publish)
- [ ] full end-to-end platform integration coverage across every provider sandbox account

Acceptance: a production container can restart safely, report readiness accurately, preserve queued work, throttle sensitive API surfaces, and provide a documented recovery path.
