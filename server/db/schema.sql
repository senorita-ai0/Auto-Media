-- Auto-Media PostgreSQL foundation
-- This schema is intentionally configuration-first. Publishing/generation
-- records can be added without changing the profile/content-type contract.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','editor','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  niche TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'English',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  tone TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  master_prompt TEXT NOT NULL DEFAULT '',
  disclaimer TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS content_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom',
  generation_mode TEXT NOT NULL DEFAULT 'ai_text',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  built_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type_id UUID REFERENCES content_types(id) ON DELETE SET NULL,
  version INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, content_type_id, version)
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  external_account_id TEXT,
  credential_ref TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'disconnected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type_id UUID NOT NULL REFERENCES content_types(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  schedule_type TEXT NOT NULL DEFAULT 'interval',
  schedule_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_mode TEXT NOT NULL DEFAULT 'review',
  max_items_per_run INTEGER NOT NULL DEFAULT 1 CHECK (max_items_per_run > 0),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  platform_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(automation_id, social_account_id)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  local_path TEXT,
  public_url TEXT,
  mime_type TEXT,
  file_size BIGINT,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC,
  checksum TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type_id UUID NOT NULL REFERENCES content_types(id) ON DELETE RESTRICT,
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  source_type TEXT,
  source_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  structured_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS profile_brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'reference' CHECK (role IN ('logo','watermark','cover','background','reference')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, media_asset_id, role)
);

CREATE INDEX IF NOT EXISTS idx_profile_brand_assets_profile ON profile_brand_assets(profile_id, role, active);

CREATE TABLE IF NOT EXISTS content_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'primary',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(content_item_id, media_asset_id, role)
);

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  external_post_id TEXT,
  external_url TEXT,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS n8n_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  workflow_json JSONB NOT NULL,
  n8n_workflow_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  imported_from TEXT,
  credential_map_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS n8n_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES n8n_workflows(id) ON DELETE SET NULL,
  job_id UUID,
  external_execution_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hashtag_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS visual_identity_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_profiles_workspace ON profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_automations_profile ON automations(profile_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled);
ALTER TABLE automations ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_automations_due ON automations(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_items_profile ON content_items(profile_id);
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS revision_of UUID REFERENCES content_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_content_items_revision ON content_items(revision_of);
ALTER TABLE publishing_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE publishing_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_due ON publishing_jobs(status, scheduled_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_n8n_executions_job ON n8n_executions(job_id);
ALTER TABLE n8n_workflows ADD COLUMN IF NOT EXISTS credential_map_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Secure credential storage for Studio accounts.
-- Values are encrypted application-side before insertion.
CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_credentials_workspace ON credentials(workspace_id);

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'native',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  content_id UUID REFERENCES content_items(id) ON DELETE SET NULL,
  error_message TEXT
);


CREATE TABLE IF NOT EXISTS ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL DEFAULT 'openai_compatible',
  base_url TEXT NOT NULL,
  text_model TEXT NOT NULL,
  image_model TEXT,
  image_base_url TEXT,
  temperature NUMERIC(4,3) NOT NULL DEFAULT 0.7,
  json_mode BOOLEAN NOT NULL DEFAULT TRUE,
  credential_ref TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_workspace ON ai_providers(workspace_id);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'native',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  content_id UUID REFERENCES content_items(id) ON DELETE SET NULL,
  automation_run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_started
  ON automation_runs(automation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  code_verifier TEXT,
  redirect_path TEXT,
  provider_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS provider_config_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','editor','member')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES studio_users(id) ON DELETE SET NULL,
  accepted_by_user_id UUID REFERENCES studio_users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace ON workspace_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_expires ON workspace_invitations(expires_at);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_due ON generation_jobs(status, scheduled_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_workspace ON generation_jobs(workspace_id, created_at DESC);
