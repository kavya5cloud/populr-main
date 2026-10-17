-- Tables, columns and indexes the app created at runtime (ensure() in lib/) with no migration.
-- Copied from the code as of 2026-10-17. Idempotent, so running it against a database the app
-- already set up changes nothing. tests/schema-migrations.test.ts keeps the two in step.

-- Tables
-- from lib/agents/pass-log.ts
CREATE TABLE IF NOT EXISTS agent_pass_log (
    workspace_key TEXT PRIMARY KEY,
    last_run_at BIGINT NOT NULL
);

-- from lib/assistant/store.ts
CREATE TABLE IF NOT EXISTS assistant_settings (
    tenant TEXT PRIMARY KEY,
    settings JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- from lib/autopilot/heartbeat.ts
CREATE TABLE IF NOT EXISTS publisher_heartbeat (
    id BOOLEAN PRIMARY KEY DEFAULT true,
    at BIGINT NOT NULL,
    dispatched INT NOT NULL DEFAULT 0,
    tenants INT NOT NULL DEFAULT 0,
    CONSTRAINT one_row CHECK (id)
);

-- from lib/billing/store.ts
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_period_end BIGINT,
    product_id TEXT,
    updated_at BIGINT NOT NULL
);

-- from lib/creative/jobs.ts
CREATE TABLE IF NOT EXISTS creative_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    job_id TEXT,
    spec_id TEXT,
    provider TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    brief JSONB,
    storyboard JSONB,
    asset_id UUID,
    error TEXT,
    cost_estimate REAL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- from lib/db.ts
CREATE TABLE IF NOT EXISTS referrals (
    referred_user_id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    qualified_at TIMESTAMPTZ
);

-- from lib/geo/store.ts
CREATE TABLE IF NOT EXISTS geo_citation_reports (
    id BIGSERIAL PRIMARY KEY,
    tenant TEXT NOT NULL,
    brand TEXT NOT NULL,
    host TEXT NOT NULL,
    engine TEXT NOT NULL,
    checked_at BIGINT NOT NULL,
    checks JSONB NOT NULL
);

-- from lib/intelligence/store.ts
CREATE TABLE IF NOT EXISTS intel_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,
    workspace_key TEXT,
    pattern TEXT NOT NULL,
    evidence TEXT NOT NULL,
    excerpt TEXT,
    metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
    source JSONB NOT NULL,
    channel TEXT,
    industry TEXT,
    audience TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- from lib/mcp/keys.ts
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL, hint TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL, last_used_at BIGINT);

-- from lib/refusals/store.ts
CREATE TABLE IF NOT EXISTS refusals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    proposed TEXT NOT NULL,
    channel TEXT NOT NULL,
    reason TEXT NOT NULL,
    explanation TEXT NOT NULL,
    instead_did TEXT,
    instead_channel TEXT,
    checkable_at TIMESTAMPTZ,
    verdict TEXT NOT NULL DEFAULT 'unknown',
    evidence TEXT,
    instead_outcome TEXT NOT NULL DEFAULT 'unknown',
    instead_evidence TEXT,
    instead_resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- from lib/seo/autopilot-store.ts
CREATE TABLE IF NOT EXISTS seo_autopilot (
  workspace TEXT PRIMARY KEY, site_key TEXT NOT NULL UNIQUE, config JSONB NOT NULL,
  seen_count BIGINT NOT NULL DEFAULT 0, last_seen_at BIGINT, last_seen_path TEXT, seen_paths JSONB NOT NULL DEFAULT '[]');

-- from lib/whatsapp/business/store.ts
CREATE TABLE IF NOT EXISTS whatsapp_business (
  id TEXT PRIMARY KEY, workspace TEXT NOT NULL UNIQUE, phone_number_id TEXT NOT NULL, display_number TEXT NOT NULL,
  verify_token TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false, knowledge TEXT NOT NULL DEFAULT '',
  sealed JSONB NOT NULL, created_at BIGINT NOT NULL);

-- from lib/whatsapp/business/store.ts
CREATE TABLE IF NOT EXISTS whatsapp_escalations (
  id TEXT PRIMARY KEY, ref INT NOT NULL, connection_id TEXT NOT NULL, workspace TEXT NOT NULL,
  customer TEXT NOT NULL, question TEXT NOT NULL, asked_at BIGINT NOT NULL, answered_at BIGINT);

-- from lib/whatsapp/business/store.ts
CREATE TABLE IF NOT EXISTS whatsapp_learned (workspace TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, at BIGINT NOT NULL);

-- from lib/whatsapp/business/store.ts
CREATE TABLE IF NOT EXISTS whatsapp_business_seen (message_id TEXT PRIMARY KEY, seen_at BIGINT NOT NULL);

-- from lib/whatsapp/business/store.ts
CREATE TABLE IF NOT EXISTS whatsapp_customer_hits (connection_id TEXT NOT NULL, customer TEXT NOT NULL, at BIGINT NOT NULL);

-- from lib/whatsapp/links.ts
CREATE TABLE IF NOT EXISTS whatsapp_link_codes (code TEXT PRIMARY KEY, workspace TEXT NOT NULL, expires_at BIGINT NOT NULL);

-- from lib/whatsapp/links.ts
CREATE TABLE IF NOT EXISTS whatsapp_links (wa_id TEXT PRIMARY KEY, workspace TEXT NOT NULL UNIQUE, linked_at BIGINT NOT NULL);

-- from lib/whatsapp/links.ts
CREATE TABLE IF NOT EXISTS whatsapp_seen (message_id TEXT PRIMARY KEY, seen_at BIGINT NOT NULL);

-- from lib/whatsapp/links.ts
CREATE TABLE IF NOT EXISTS whatsapp_digest_log (workspace TEXT PRIMARY KEY, sent_at BIGINT NOT NULL);

-- Columns added after a table first shipped (CREATE TABLE IF NOT EXISTS can't add them)
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;
ALTER TABLE learn_patterns ADD COLUMN IF NOT EXISTS workspace_key TEXT NOT NULL DEFAULT '__unattributed__';
ALTER TABLE refusals ADD COLUMN IF NOT EXISTS instead_channel TEXT;
ALTER TABLE refusals ADD COLUMN IF NOT EXISTS instead_outcome TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE refusals ADD COLUMN IF NOT EXISTS instead_evidence TEXT;
ALTER TABLE refusals ADD COLUMN IF NOT EXISTS instead_resolved_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS subscriptions_external ON subscriptions (external_id);
CREATE INDEX IF NOT EXISTS idx_creative_ws ON creative_jobs (workspace_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_stale ON creative_jobs (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_creative_task ON creative_jobs (provider_task_id);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS geo_reports_tenant_time ON geo_citation_reports (tenant, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_ref_ws ON intel_references (workspace_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_ref_channel ON intel_references (channel, kind);
CREATE INDEX IF NOT EXISTS idx_learn_pat_ws ON learn_patterns (workspace_key, performance DESC);
CREATE INDEX IF NOT EXISTS api_keys_workspace ON api_keys (workspace);
CREATE INDEX IF NOT EXISTS idx_refusals_ws ON refusals (workspace_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refusals_due ON refusals (workspace_key, verdict, checkable_at);
CREATE INDEX IF NOT EXISTS idx_refusals_due_any_ws ON refusals (verdict, checkable_at);
