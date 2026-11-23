CREATE TABLE exam_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id TEXT NOT NULL REFERENCES exam_bank(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('student-work', 'wrong-details', 'other')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX exam_reports_exam ON exam_reports (exam_id);
