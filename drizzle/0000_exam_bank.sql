CREATE TABLE exam_bank (
  id TEXT PRIMARY KEY NOT NULL,
  course TEXT NOT NULL,
  term TEXT NOT NULL,
  assessment TEXT NOT NULL,
  assessment_number INTEGER,
  page_count INTEGER NOT NULL,
  page_images TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX exam_bank_status_course_term ON exam_bank (status, course, term);
