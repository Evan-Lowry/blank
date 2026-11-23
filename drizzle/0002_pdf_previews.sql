CREATE TABLE pdf_previews (
  token TEXT PRIMARY KEY NOT NULL,
  exam_id TEXT NOT NULL REFERENCES exam_bank(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX pdf_previews_expiry ON pdf_previews (expires_at);
