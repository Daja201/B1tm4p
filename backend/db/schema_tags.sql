PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS master_tags (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT UNIQUE NOT NULL,
 slug TEXT UNIQUE NOT NULL,
 header_image_path TEXT,
 description TEXT,
 created_by INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 master_tag_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 slug TEXT NOT NULL,
 created_by INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(master_tag_id, slug)
);
CREATE TABLE IF NOT EXISTS tag_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_type TEXT NOT NULL CHECK(request_type IN ('master_tag','tag')),
 proposed_name TEXT NOT NULL,
 parent_master_tag_id INTEGER,
 requested_by INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
 reviewed_by INTEGER,
 review_note TEXT,
 created_at INTEGER NOT NULL,
 reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tags_master ON tags(master_tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_requests_status ON tag_requests(status);
