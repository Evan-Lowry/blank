ALTER TABLE exam_bank ADD COLUMN content_hash TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX exam_bank_content_hash ON exam_bank (content_hash);
