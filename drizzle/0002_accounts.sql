CREATE TABLE auth_credentials (
  student_id TEXT PRIMARY KEY NOT NULL REFERENCES students(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id),
  expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_session_expiry ON auth_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE auth_attempts (
  attempt_key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
