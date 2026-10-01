PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('user','support','manager','admin')) DEFAULT 'user',
 avatar_type TEXT NOT NULL CHECK(avatar_type IN ('image','initials')) DEFAULT 'initials',
 avatar_value TEXT NOT NULL DEFAULT 'US',
 avatar_shape TEXT NOT NULL CHECK(avatar_shape IN ('circle','square')) DEFAULT 'circle',
 avatar_color TEXT NOT NULL DEFAULT '#FF7A00',
 email_verified INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 oauth_provider TEXT,
 oauth_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 token_hash TEXT UNIQUE NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 ip TEXT,
 user_agent TEXT
);
CREATE TABLE IF NOT EXISTS login_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 ip TEXT NOT NULL,
 user_agent TEXT,
 device_label TEXT,
 success INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 raw_email_attempted TEXT
);
CREATE TABLE IF NOT EXISTS email_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 token_hash TEXT UNIQUE NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('verify','login_link','password_reset')),
 expires_at INTEGER NOT NULL,
 used INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
