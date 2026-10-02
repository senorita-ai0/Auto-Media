
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

Acceptance: create Future Tech and Viral Videos with different prompts/content types without modifying code.

## Phase 2 — Content engine
- [x] content_items
- [x] media_assets
- [x] local media scanner
- [x] AI provider abstraction
- [x] prompt composition
- [x] structured output validation
- [ ] generation jobs
- [ ] review
- [ ] regeneration

Acceptance: Future Tech generates an AI image post while Viral Videos selects a local video through the same application.

## Phase 3 — n8n bridge
- [x] n8n settings/status
- [x] webhook invocation
- [x] callback
- [x] execution tracking
- [x] runtime payload
- [ ] migrate Future Tech workflow
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
- [x] legacy credential migration from Connectors into encrypted Studio vault
- [x] OAuth connection flows for YouTube/Google, LinkedIn, TikTok, Facebook/Instagram, Threads and Pinterest
- [x] TikTok token refresh lifecycle
- [ ] remaining platform-specific OAuth flows (X, Bluesky, Mastodon, Reddit/Telegram/Discord where applicable)

Acceptance: one content item can independently publish to Facebook, Instagram and TikTok.

## Phase 5 — Dashboard
- [x] Profiles foundation
- [x] Accounts foundation
- [x] Content Types foundation
- [x] Automations foundation
- [x] Content Library foundation
- [x] Review queue
- [ ] Calendar
- [x] Publishing queue foundation
- [x] Logs

## Phase 6 — AI workflow import
- [x] n8n JSON import
- [x] schema/structure validation
- [x] node/dependency detection
- [ ] credential mapping UI
- [x] secret detection
- [x] test execution
- [x] versioning via duplicate/imported versions
- [ ] export

## Phase 7 — Production hardening
- [x] encrypted secrets
- [x] authentication foundation via Firebase ID tokens
- [ ] authorization
- [ ] audit logs
- [ ] backups
- [ ] observability
- [ ] worker queue
- [ ] object storage
- [ ] signed/public media URLs

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
