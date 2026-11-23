CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, key_hash, window_start)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX rate_limits_window ON rate_limits (window_start);
