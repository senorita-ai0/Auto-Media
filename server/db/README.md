# Database Foundation

PostgreSQL is the target source of truth for the new Auto-Media architecture.

The schema in schema.sql contains the first version of:
- workspaces
- profiles
- prompt versions
- social accounts
- content types
- automations
- automation destinations
- media assets
- content items
- publishing jobs
- n8n workflows/executions
- audit logs

The current UI foundation still uses browser storage so the existing application remains backward-compatible during migration. The next backend milestone is replacing that temporary storage with these tables and API endpoints.

Do not put credentials or access tokens into any JSON configuration column.
