-- Empty, additive security storage. Keys are domain-separated HMAC digests;
-- the application reserves attempts using database time in a transaction.
CREATE TABLE auth_login_buckets (
  bucket_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT auth_login_buckets_key_check CHECK (
    char_length(bucket_key) = 64 AND bucket_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT auth_login_buckets_attempts_check CHECK (attempts BETWEEN 1 AND 121),
  CONSTRAINT auth_login_buckets_expiry_check CHECK (expires_at > window_started_at)
);
CREATE INDEX auth_login_buckets_expiry_idx ON auth_login_buckets(expires_at);
