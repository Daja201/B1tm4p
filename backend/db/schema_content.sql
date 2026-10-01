CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_tag_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  header_title TEXT,
  body_text TEXT,
  body_type TEXT NOT NULL CHECK(body_type IN ('text','image','sound','video')),
  file_path TEXT,
  file_mime TEXT,
  created_at INTEGER NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_reply_id INTEGER,
  author_id INTEGER NOT NULL,
  header_title TEXT,
  body_text TEXT,
  body_type TEXT NOT NULL CHECK(body_type IN ('text','image','sound','video')),
  file_path TEXT,
  file_mime TEXT,
  created_at INTEGER NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('post','reply')),
  content_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_tag_id ON posts(tag_id);
CREATE INDEX IF NOT EXISTS idx_posts_master_tag_id ON posts(master_tag_id);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted);
CREATE INDEX IF NOT EXISTS idx_replies_post_id ON replies(post_id);
CREATE INDEX IF NOT EXISTS idx_replies_parent_reply_id ON replies(parent_reply_id);
CREATE INDEX IF NOT EXISTS idx_replies_author_id ON replies(author_id);
CREATE INDEX IF NOT EXISTS idx_replies_deleted ON replies(deleted);
CREATE INDEX IF NOT EXISTS idx_likes_content ON likes(content_type, content_id);
