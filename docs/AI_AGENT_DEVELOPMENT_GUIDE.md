
# Auto-Media — AI Agent Development Guide

This is the implementation contract for coding agents.

## Product rule

Build a configuration-driven multi-page platform. Never create page-specific code when a reusable abstraction can solve the requirement.

## Architecture rules

1. PostgreSQL is canonical state.
2. n8n is an execution engine.
3. Do not hard-code page IDs, prompts, tokens or credentials.
4. Prefer reusable services.
5. Every long-running operation is a job.
6. Publishing is idempotent.
7. Publishers, AI providers and storage are modular.

## Existing code

Before changing anything:
- inspect React UI
- inspect Node server
- inspect publishers
- inspect Google Sheets integration
- preserve working functionality
- migrate incrementally
- avoid unrelated rewrites

## Implementation order

### Phase 1
Database, migrations, profiles, accounts, credentials abstraction, content types, automations, schedules.

### Phase 2
Content items, media assets, local scanner, AI abstraction, prompt composition, structured validation, generation jobs, review.

### Phase 3
n8n settings, webhook, callback, execution tracking, universal runtime contract, Future Tech migration.

### Phase 4
Publishing jobs, publisher interface, validation, retries, idempotency, existing publisher migration.

### Phase 5
Dashboard pages: Profiles, Accounts, Content Types, Automations, Content Library, Review, Calendar, Publishing Queue, Logs.

### Phase 6
n8n JSON import, schema validation, credential mapping, secret detection, testing, versioning, export.

### Phase 7
Authentication, authorization, encrypted secrets, audit logs, backups, queue workers and object storage.

## API conventions

Use resource-oriented endpoints such as:
GET/POST /api/profiles
GET/PATCH /api/profiles/:id
GET/POST /api/content-types
GET/POST /api/automations
POST /api/automation-jobs
GET /api/jobs/:id
GET/POST /api/content
POST /api/content/:id/approve
POST /api/content/:id/regenerate
GET /api/publishing-jobs
POST /api/n8n/callback
POST /api/n8n/workflows/import
POST /api/n8n/workflows/:id/test

## Errors

Return structured errors with stable codes.

## Database

Use migrations, foreign keys, indexes for job/status queries and timestamps. Use JSON for flexible configuration, not for core relational relationships.

## Security

Never commit API tokens, OAuth secrets, private keys, passwords or production DB credentials.

If an existing file contains a real secret, remove it from code/config and rotate it if exposed.

## Testing

Critical tests:
- duplicate prevention
- retries
- profile-specific prompt resolution
- destination-specific publishing
- workflow secret detection
- local media selection
- schedules
- n8n callbacks

## Definition of done

Code works, errors are handled, data persists correctly, UI is usable, tests/build pass, documentation is updated and secrets are not exposed.
