# Auto-Media

Auto-Media is a self-hosted, configuration-driven social media content automation platform.

The system is designed around one application managing many brands/pages/accounts without duplicating page-specific code or n8n workflows.

## Current status

**Engineering implementation is complete for the current roadmap.**

The repository now contains the multi-brand Content Studio, durable generation and publishing workers, profile-driven AI content generation, optional n8n integration, encrypted credentials, OAuth connections, workspace authorization, analytics, media storage, recovery tooling, and provider sandbox/contract tests.

The only roadmap item intentionally left for operator action is the final **real-provider sandbox CI publish gate**. That requires disposable production-like provider credentials owned by the operator and should not be hard-coded into the repository.

Latest completed GitHub CI runs are green. The final real-provider publish workflow is opt-in and remains disabled unless the required sandbox credentials are supplied.

## Architecture

The core data flow is:

**Workspace → Profile → Content Type → Automation → Generation → Review/Schedule → Publishing → Analytics**

A **Workspace** isolates a brand/operator team.

A **Profile** represents a page/brand and stores its master prompt, tone, audience, language, timezone, hashtag rules and visual identity.

A **Content Type** is reusable generation logic such as:

- Tech News Image
- Local Video
- AI Video
- Quote Image
- Product Update
- Custom Workflow / n8n

An **Automation** connects a profile to a content type and defines:

- source
- generation settings
- schedule
- approval mode
- destination accounts
- batch behavior
- optional n8n workflow

The same AI engine and application services can therefore power many brands with different behavior.

## What is implemented

### Content Studio

- Multi-workspace creation, switching and invitation links
- Workspace roles: owner, admin, editor, member
- Workspace-scoped authorization
- Profiles CRUD
- Profile master/initial prompts
- Profile hashtag rules
- Profile visual identity
- Reusable brand assets and logo assignment
- Content Types CRUD
- JSON output schemas for content recipes
- Automations CRUD
- Interval/daily/weekly/manual scheduling
- Timezone-aware calendar
- Drag/drop calendar editing
- Content Library
- Review Queue
- Regeneration with revision lineage
- Scheduled publishing controls
- Publishing queue
- Audit log
- System Health / observability dashboard

### AI and generation

- Shared AI provider configuration
- Encrypted workspace AI API keys
- Automation-level model overrides
- OpenAI-compatible text generation
- OpenAI-compatible image generation
- Structured JSON generation
- Schema validation before generated content becomes publishable
- Native Tech News Image generation
- Native Local Video selection and caption generation
- Automation batch generation
- Durable generation-job queue
- Retry worker with bounded backoff
- Restart-safe job claiming
- Duplicate/used-source avoidance
- Prompt versioning
- Source/history passed into n8n workflows

### n8n

n8n is **optional**.

Auto-Media works without n8n for native automations. When n8n is enabled it runs as a separate Docker service.

Implemented n8n capabilities:

- Connection/status detection
- JSON import
- Syntax/structure validation
- node and dependency detection
- embedded-secret detection
- credential mapping
- workflow activation/deactivation
- duplication/versioning
- test execution
- execution tracking
- profile-driven runtime payloads
- per-execution callback tokens
- callback ingestion
- automatic publishing of approved callback results
- JSON export

The migrated Future Tech template is:

`examples/n8n/future-tech-profile-driven.json`

It is intentionally free of:

- Facebook Page IDs
- Google Sheet IDs
- access tokens
- passwords
- the old hard-coded image API bearer token

The template receives the profile master prompt, content-type configuration, source settings and callback information at runtime.

### Publishing

Publishing is separated from content generation.

Implemented durable publishing features include:

- destination-specific publishing jobs
- idempotency keys
- retry/backoff
- scheduled publishing worker
- atomic job claiming
- job attempt tracking
- per-destination status
- partial-failure tracking
- publish result tracking
- account health checks
- safe disconnect lifecycle
- encrypted credential storage
- legacy connector credential migration

Implemented/current provider adapters include:

- Facebook
- Instagram
- YouTube
- TikTok
- LinkedIn
- Threads
- Pinterest
- X
- Mastodon
- Reddit
- Bluesky
- Telegram
- Discord

Provider authentication and refresh handling are implemented where supported by the provider flow.

### Media and storage

- Local media scanning
- Media Library uploads
- Profile-scoped reusable media
- Shared Docker media volume
- S3/MinIO-compatible object-storage adapter
- public media URL support
- signed media URL support
- remote media ingestion
- SSRF/private-network protection for remote media fetches
- retention/cleanup worker

URL-fetching providers require a publicly reachable HTTPS media URL in production.

### Analytics

- Per-platform analytics dashboards
- normalized account engagement snapshots
- post-level engagement metrics
- historical/provider backfill support
- reusable analytics storage

### Reliability and operations

- PostgreSQL canonical state
- durable generation jobs
- durable publishing jobs
- restart-safe native scheduler
- distributed-safe job claiming
- worker locking for horizontal scaling
- liveness/readiness endpoints
- graceful shutdown
- transactional/advisory-lock protected migrations
- API rate limiting
- trusted-proxy-aware client IP handling
- optional failure alert webhook
- notification routing
- automated backup restore verification
- publisher adapter contract tests
- provider sandbox harness
- multi-provider sandbox loop
- strict all-account sandbox CI gate

## Docker

Core stack:

```bash
docker compose up -d --build
```

Core stack with optional n8n:

```bash
docker compose --profile n8n up -d --build
```

Services:

- `automedia`
- `postgres`
- optional `n8n`

Auto-Media and n8n share the media volume when the n8n profile is enabled.

## Required production configuration

At minimum configure:

- `POSTGRES_PASSWORD`
- `CREDENTIALS_MASTER_KEY`
- `PUBLIC_BASE_URL` as a public HTTPS URL
- AI provider settings
- Firebase Admin settings when Studio authentication is enabled

For social OAuth connections, configure the provider application credentials in server-side environment variables. Do not put client secrets or access tokens in frontend code.

The exact environment variables are documented in:

- `.env.example`
- `server/.env.example`

## Firebase authentication

When production authentication is enabled:

```env
STUDIO_AUTH_REQUIRED=true
```

also configure:

```env
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
```

The frontend sends Firebase ID tokens and the backend verifies them with Firebase Admin.

Workspace roles are enforced server-side.

## OAuth callback setup

Each provider app must register its Auto-Media callback URL.

The callback pattern is:

```
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/<provider>/callback
```

Examples:

```
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/google/callback
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/facebook/callback
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/tiktok/callback
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/linkedin/callback
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/threads/callback
https://YOUR_AUTOMEDIA_HOST/api/studio/oauth/pinterest/callback
```

Provider-side products, scopes and approval requirements are controlled by the provider. Auto-Media does not bypass provider review or app restrictions.

## Future Tech setup

The original Future Tech workflow can now be used in two ways.

### Native path

Recommended for the normal use case:

**RSS → AI post → AI image → review/schedule → Facebook/Instagram**

Configure a Future Tech profile, attach its master prompt, create a Tech News Image content type, then create an automation with the desired RSS feeds, schedule and destination accounts.

### n8n path

Use the migrated template:

`examples/n8n/future-tech-profile-driven.json`

Import it into the n8n instance, map the required AI credential, create an Auto-Media automation using that workflow, and configure the generation settings.

The n8n workflow is intentionally generic. The profile name, master prompt, content-type instructions, source configuration and callback token are supplied by Auto-Media at runtime.

## Viral Videos setup

The intended second milestone is:

**Local Video → AI caption → review/schedule → Facebook + Instagram + TikTok**

Place supported video files under the configured `MEDIA_ROOT`, create a Local Video automation, set its selection rule and connect the destination accounts.

The same publishing queue, retry system, scheduling worker and analytics layer are reused.

## Legacy system

The original Google Sheet-driven posting system remains available during migration.

It is intentionally kept separate so the new PostgreSQL Content Studio can be adopted incrementally.

Google Sheets can continue to be used for legacy operations or optional integration, but PostgreSQL is the canonical state for the new architecture.

## Testing

Local build:

```bash
npm install
npm run build
```

Core tests:

```npm test```

Integration tests:

```bash
npm run test:integration
```

Provider sandbox suite:

```bash
npm run test:provider-sandbox
```

The normal CI pipeline validates:

- web build
- Docker Compose configuration
- backup/restore validation
- core self-tests
- provider sandbox suite in non-publishing mode
- publisher adapter contracts
- server module syntax

Real provider sandbox publishing is intentionally opt-in.

## Documentation

Detailed engineering documentation is under `docs/`:

- `PRODUCT_REQUIREMENTS.md`
- `ARCHITECTURE.md`
- `AI_CONTENT_SYSTEM.md`
- `DATA_MODEL.md`
- `N8N_INTEGRATION.md`
- `PUBLISHING.md`
- `CHATGPT_N8N_WORKFLOW_IMPORT.md`
- `AI_AGENT_DEVELOPMENT_GUIDE.md`
- `ROADMAP.md`

The PostgreSQL schema is in:

`server/db/schema.sql`

## Handoff: what is left for the operator

The coding/architecture work for the current roadmap is complete. The remaining work is deployment and real-account setup:

1. Fill production `.env` values and generate strong secrets.
2. Set up Firebase Authentication/Admin credentials if production Studio auth is enabled.
3. Create/configure the required provider developer apps and OAuth callback URLs.
4. Connect real Facebook/Instagram, YouTube, TikTok, LinkedIn and other publishing accounts.
5. Decide whether each automation uses native execution or n8n.
6. Import/activate the Future Tech n8n template only when n8n is needed.
7. Create the Future Tech and Viral Videos profiles, prompts, content types, schedules and destinations.
8. Test one real post per destination before enabling automatic schedules.
9. Configure S3/MinIO when external object storage is preferred over local media.
10. Optionally supply disposable provider sandbox credentials and enable the final real-publish CI gate.

## Security checklist before production

- Rotate any credential that was previously exposed in an exported workflow or repository file.
- Set a strong random `CREDENTIALS_MASTER_KEY`.
- Enable Firebase authentication.
- Use HTTPS for `PUBLIC_BASE_URL`.
- Use least-privilege provider scopes.
- Keep provider client secrets server-side.
- Keep n8n bridge secrets server-side.
- Back up PostgreSQL and verify restore regularly.
- Do not commit `.env` files or real tokens.
- Review provider app approval/audit requirements before automatic publishing.

## Project direction

The intended end state is one Auto-Media installation managing many brands and many publishing destinations:

**one dashboard · many profiles · many content recipes · many automations · many accounts**

without maintaining separate page-specific application code or separate n8n workflows for common content patterns.
