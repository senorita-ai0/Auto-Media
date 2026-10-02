
# Auto-Media — Data Model

PostgreSQL is the source of truth.

## Core tables

### workspaces
id, name, created_at, updated_at

### profiles
id, workspace_id, name, slug, description, niche, language, timezone, tone, audience, master_prompt, disclaimer, status, created_at, updated_at

### prompt_versions
id, profile_id, content_type_id nullable, version, prompt, active, created_at

### social_accounts
id, workspace_id, platform, name, external_account_id, credential_ref, metadata_json, status, created_at, updated_at

### content_types
id, workspace_id nullable, name, slug, description, category, generation_mode, config_json, schema_json, active, created_at, updated_at

### automations
id, profile_id, content_type_id, name, enabled, schedule_type, schedule_config_json, source_config_json, generation_config_json, approval_mode, max_items_per_run, timezone, created_at, updated_at

### automation_destinations
id, automation_id, social_account_id, enabled, platform_config_json

### media_assets
id, workspace_id, profile_id nullable, type, storage_key, local_path nullable, public_url nullable, mime_type, file_size, width, height, duration, checksum, source, status, created_at, updated_at

### content_items
id, profile_id, content_type_id, automation_id nullable, source_type, source_data_json, title, caption, structured_data_json, status, prompt_version_id, created_at, updated_at

### content_media
id, content_item_id, media_asset_id, role, sort_order

### publishing_jobs
id, content_item_id, social_account_id, status, scheduled_at, started_at, completed_at, external_post_id, external_url, error_code, error_message, attempts, idempotency_key

### n8n_workflows
id, workspace_id, name, description, workflow_json, n8n_workflow_id nullable, version, status, imported_from, created_at, updated_at

### n8n_executions
id, workflow_id, job_id, external_execution_id, status, started_at, completed_at, input_json, output_json, error_json

### audit_logs
id, workspace_id, actor, action, entity_type, entity_id, before_json, after_json, created_at

## Relationships

~~~text
workspace
  -> profiles
  -> social_accounts
  -> media_assets
  -> n8n_workflows

profile
  -> prompt_versions
  -> automations
  -> content_items

content_type
  -> automations
  -> content_items

content_item
  -> content_media
  -> publishing_jobs

n8n_workflow
  -> n8n_executions
~~~

## Invariants

- Publishing jobs are destination-specific.
- Credentials are references, never embedded secrets.
- Generated content records its prompt version.
- Media reuse follows an explicit policy.
- Publishing is idempotent.
