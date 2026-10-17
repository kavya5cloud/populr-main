-- The free public SEO & AI-readiness check (/check): the latest result per domain.
CREATE TABLE IF NOT EXISTS site_checks (
  domain TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  score INT NOT NULL,
  result JSONB NOT NULL,
  checked_at BIGINT NOT NULL,
  times_checked INT NOT NULL DEFAULT 1
);
