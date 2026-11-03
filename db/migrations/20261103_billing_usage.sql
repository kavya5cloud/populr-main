-- The free plan's monthly allowance, and the one-time emails about a trial ending.

CREATE TABLE IF NOT EXISTS ai_usage (
  subject TEXT NOT NULL,
  period TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (subject, period)
);

CREATE TABLE IF NOT EXISTS billing_notices (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
