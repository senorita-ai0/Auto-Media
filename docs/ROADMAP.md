
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
- [ ] Social accounts CRUD
- [ ] Secure credential references
- [x] Content types CRUD foundation
- [x] Automations CRUD foundation
- [x] Schedules/configuration foundation
- [x] Profile master prompt editor

Acceptance: create Future Tech and Viral Videos with different prompts/content types without modifying code.

## Phase 2 — Content engine
- [ ] content_items
- [ ] media_assets
- [ ] local media scanner
- [ ] AI provider abstraction
- [ ] prompt composition
- [ ] structured output validation
- [ ] generation jobs
- [ ] review
- [ ] regeneration

Acceptance: Future Tech generates an AI image post while Viral Videos selects a local video through the same application.

## Phase 3 — n8n bridge
- [ ] n8n settings
- [ ] webhook
- [ ] callback
- [ ] execution tracking
- [ ] runtime payload
- [ ] migrate Future Tech workflow
- [ ] remove page hard-coding

Acceptance: one n8n workflow serves multiple profiles.

## Phase 4 — Publishing
- [ ] publishing_jobs
- [ ] publisher interface
- [ ] validation
- [ ] retries
- [ ] idempotency
- [ ] result tracking
- [ ] migrate current publishers

Acceptance: one content item can independently publish to Facebook, Instagram and TikTok.

## Phase 5 — Dashboard
- [ ] Profiles
- [ ] Accounts
- [ ] Content Types
- [ ] Automations
- [x] Content Library foundation
- [ ] Review queue
- [ ] Calendar
- [ ] Publishing queue
- [ ] Logs

## Phase 6 — AI workflow import
- [ ] n8n JSON import
- [ ] schema validation
- [ ] node/dependency detection
- [ ] credential mapping
- [ ] secret detection
- [ ] test execution
- [ ] versioning
- [ ] export

## Phase 7 — Production hardening
- [ ] encrypted secrets
- [ ] authentication
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
