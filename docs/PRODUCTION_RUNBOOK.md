# Auto-Media — Production Runbook

## Services

The recommended Docker deployment contains:
- `automedia`: the user-facing Studio API + frontend + background workers
- `postgres`: durable configuration, jobs, credentials metadata, audits and analytics
- `n8n`: optional custom workflow engine under the `n8n` Compose profile
- `automedia-backup`: optional scheduled PostgreSQL/media/n8n backup under the `backup` profile

Auto-Media remains usable without n8n. n8n is an execution option for advanced/custom recipes.

## Required production settings

Set at minimum:
- `POSTGRES_PASSWORD`
- `CREDENTIALS_MASTER_KEY`
- `PUBLIC_BASE_URL` to the public HTTPS origin
- `STUDIO_AUTH_REQUIRED=true`
- Firebase Admin credentials: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

For AI generation, configure either the workspace AI Providers page or the legacy `AI_BASE_URL` / `AI_TEXT_MODEL` / `AI_API_KEY` fallback.

For n8n, configure `N8N_ENABLED=true`, `N8N_BASE_URL`, `N8N_WEBHOOK_BASE_URL`, and `N8N_SHARED_SECRET`.

For S3/MinIO, set `STORAGE_MODE=s3` and the S3 credentials/settings.

## OAuth callback URLs

Every provider app must register the matching callback under:
`PUBLIC_BASE_URL/api/studio/oauth/<provider>/callback`

The provider-specific setup is intentionally server-side. Client secrets are never stored in the browser.

## Health

- `GET /api/live` checks only process liveness.
- `GET /api/ready` checks database connectivity and required deployment configuration.
- `GET /api/health` is kept as a backwards-compatible liveness endpoint.

Use `/api/ready` for an external load balancer or container readiness probe.

## Operational model

Profiles define brand identity and master prompts.
Content Types define reusable recipes and output schemas.
Automations define schedules, sources, AI/n8n selection, approval mode and publishing destinations.
Generation jobs provide durable execution and retry state.
Content Library stores generated content and media.
Publishing jobs independently deliver one content item to each selected account.
The scheduler/worker processes continue when the browser is closed.

## n8n workflow rule

Imported workflows must accept the Auto-Media runtime payload and call the Auto-Media callback using the per-execution `callbackToken`.

Do not embed:
- social page/account IDs
- social access tokens
- Google Sheets row IDs
- passwords
- the long-lived `N8N_SHARED_SECRET`

Use credential mappings for reusable secret references.

## Backup

Run the optional backup profile for scheduled PostgreSQL, media and n8n-volume backups. Test restores periodically; a backup that has never been restored is not considered a validated recovery path.

## Upgrade procedure

1. Back up PostgreSQL and media.
2. Pull the new image/source.
3. Recreate the `automedia` service.
4. The container runs `npm run db:migrate` before starting the server.
5. Check `/api/ready`.
6. Open System Health and confirm background workers are running.
7. Run a small approved test publication before enabling a large batch.

## Incident handling

For a failed generation job, inspect the generation queue first. Retryable jobs show `retry_wait` and the next retry time.
For publishing failures, inspect the destination-specific publishing job and account health state.
For n8n issues, inspect n8n execution history plus Auto-Media's n8n execution row and callback status.
For OAuth failures, verify the provider redirect URI, server-side client credentials, workspace admin authorization, and current account permissions.


## Integration test

With PostgreSQL available at `DATABASE_URL`, run:

```bash
npm run db:migrate
npm run test:integration
```

The integration suite uses isolated, uniquely named fixtures and stubs provider network calls. It verifies publishing idempotency, scheduled-job behavior, encrypted credential persistence, and PostgreSQL advisory-lock exclusion without posting to real social accounts.

## Workspace configuration export

Team → Export config downloads a JSON snapshot of workspace configuration: profiles, content types, automations, account metadata, destinations, and n8n workflow definitions/mappings. Credential payloads, access tokens, secrets, and encrypted vault contents are intentionally excluded.