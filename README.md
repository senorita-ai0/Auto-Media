# Auto-Media

Auto-Media is evolving from a local multi-platform video poster into a self-hosted, configuration-driven social media content automation platform.

## New architecture

The target model is:

**Profile -> Content Type -> Automation -> Content -> Publishing**

A profile represents a page/brand and owns its content identity and master prompt.

A content type is reusable logic such as:
- Tech News Image
- Local Video
- AI Video
- Quote Image
- Product Update
- Custom Workflow

An automation connects one profile to one content type and defines its source, generation settings, schedule, approval mode and destinations.

### n8n is optional

Auto-Media can generate and publish normal content without n8n.

n8n is an optional extension for advanced/custom automations. When enabled, it runs as a separate service in the same Docker Compose network.

## Current implementation

The first Content Studio foundation is now available in the dashboard:

- Profiles
- Profile master/initial prompts
- Content Types
- Automations
- Schedule configuration
- Approval mode
- Source configuration
- Destination configuration

The current UI foundation stores this new configuration locally while the existing Google Sheets/Firebase workflow remains compatible. PostgreSQL schema and Docker deployment are being added incrementally so the migration can happen without breaking existing posting.

## Run locally

Requires Node 22+.

```bash
npm install
npm run dev
npm run server
```

The current server serves the built frontend after `npm run build`.

## Docker

The repository now includes:
- `Dockerfile`
- `docker-compose.yml`
- PostgreSQL service
- optional n8n service

Start the core stack:

```bash
docker compose up -d --build
```

Start with optional n8n:

```bash
docker compose --profile n8n up -d --build
```

The Docker network lets Auto-Media and n8n communicate using service names. Auto-Media must remain functional when n8n is disabled.

## Documentation

Implementation specifications live under `docs/`:

- `PRODUCT_REQUIREMENTS.md`
- `ARCHITECTURE.md`
- `AI_CONTENT_SYSTEM.md`
- `DATA_MODEL.md`
- `N8N_INTEGRATION.md`
- `PUBLISHING.md`
- `CHATGPT_N8N_WORKFLOW_IMPORT.md`
- `AI_AGENT_DEVELOPMENT_GUIDE.md`
- `ROADMAP.md`

The PostgreSQL foundation is in `server/db/schema.sql`.

## Existing posting system

The original project still supports its existing Google Sheet driven video workflow and multi-platform publishers. That functionality is intentionally being migrated incrementally rather than replaced in one large rewrite.

The long-term source of truth will move from browser storage/Google Sheets toward PostgreSQL. Google Sheets can remain an optional import/export/integration.

## Security

Do not commit real API keys, access tokens, private keys, passwords or service-account credentials.

The new architecture uses credential references and environment/server-side secrets.

If a secret has previously been exposed in repository code or an exported workflow, rotate it before production use.
