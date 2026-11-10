-- Payment simulations never represented real settlements. Keep their bill amounts
-- and return them to pending when moving to manager-handled payments.
CREATE TABLE bills_pending (
  student_id TEXT NOT NULL REFERENCES students(id),
  month TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 100000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status = 'pending'),
  PRIMARY KEY(student_id, month)
);
--> statement-breakpoint
INSERT INTO bills_pending (student_id,month,amount,status)
SELECT student_id,month,amount,'pending' FROM bills;
--> statement-breakpoint
DROP TABLE bills;
--> statement-breakpoint
ALTER TABLE bills_pending RENAME TO bills;
--> statement-breakpoint
DELETE FROM activity WHERE title = 'Simulated payment recorded';
--> statement-breakpoint
ALTER TABLE students DROP COLUMN hostel;
