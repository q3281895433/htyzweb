import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  member_type TEXT NOT NULL CHECK (member_type IN ('current_student','graduate')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  email_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','archived')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES staff_accounts(id),
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moments_public_idx ON moments(status, published_at DESC);
CREATE INDEX IF NOT EXISTS moments_user_idx ON moments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moment_images (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wall_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','archived')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES staff_accounts(id),
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wall_posts_public_idx ON wall_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS wall_posts_user_idx ON wall_posts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wall_images (
  id TEXT PRIMARY KEY,
  wall_post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wall_polls (
  id TEXT PRIMARY KEY,
  wall_post_id TEXT NOT NULL UNIQUE REFERENCES wall_posts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wall_poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES wall_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE(poll_id, position)
);
CREATE INDEX IF NOT EXISTS wall_poll_options_poll_idx ON wall_poll_options(poll_id, position);

CREATE TABLE IF NOT EXISTS wall_poll_votes (
  poll_id TEXT NOT NULL REFERENCES wall_polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES wall_poll_options(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS wall_poll_votes_option_idx ON wall_poll_votes(poll_id, option_id);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('campus_admin','alumni_admin','moderator','super_admin')),
  status TEXT NOT NULL DEFAULT 'pending_activation' CHECK (status IN ('pending_activation','active','suspended')),
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user','staff')),
  principal_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_principal_idx ON auth_sessions(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user','staff')),
  principal_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password','activate_staff')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_tokens_lookup_idx ON email_tokens(token_hash, purpose, consumed_at);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('campus_life','writing','photo_story','graduate_note')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','archived')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES staff_accounts(id),
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contributions_public_idx ON contributions(status, published_at DESC);
CREATE INDEX IF NOT EXISTS contributions_user_idx ON contributions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contribution_images (
  id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','archived')),
  created_by TEXT NOT NULL REFERENCES staff_accounts(id),
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_public_idx ON news(status, published_at DESC);

CREATE TABLE IF NOT EXISTS news_images (
  id TEXT PRIMARY KEY,
  news_id TEXT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_images_news_idx ON news_images(news_id, created_at ASC);

CREATE TABLE IF NOT EXISTS post_videos (
  id TEXT PRIMARY KEY,
  post_type TEXT NOT NULL CHECK (post_type IN ('moment','wall','contribution','news')),
  post_id TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(post_type, post_id)
);
CREATE INDEX IF NOT EXISTS post_videos_post_idx ON post_videos(post_type, post_id);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES staff_accounts(id),
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES staff_accounts(id)
);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_inbox_idx ON direct_messages(recipient_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','archived')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES staff_accounts(id),
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_public_idx ON questions(status, published_at DESC);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','archived')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES staff_accounts(id),
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS answers_question_idx ON answers(question_id, status, published_at);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_type TEXT NOT NULL CHECK (post_type IN ('moment','wall','contribution','question','answer','news')),
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),
  parent_comment_id TEXT REFERENCES post_comments(id),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','archived')),
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS post_comments_public_idx ON post_comments(post_type, post_id, status, published_at, id);
CREATE INDEX IF NOT EXISTS post_comments_user_idx ON post_comments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_type TEXT NOT NULL CHECK (post_type IN ('moment','wall','contribution','question','answer','news')),
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_type, post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_likes_post_idx ON post_likes(post_type, post_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('like','comment')),
  post_type TEXT NOT NULL,
  post_id TEXT NOT NULL,
  comment_id TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),
  target_path TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(recipient_id, read_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('feature','experience','join_us','other')),
  body TEXT NOT NULL,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  applicant_type TEXT NOT NULL CHECK (applicant_type IN ('current_student','graduate')),
  details_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  consent_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES staff_accounts(id),
  review_note TEXT,
  decided_at TEXT,
  purge_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_applications_open_idx ON staff_applications(user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moderation_actions_target_idx ON moderation_actions(target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','staff','system')),
  actor_id TEXT,
  event_name TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);
`

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o750 })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.exec(schema)
  ensureColumn(db, 'users', 'username', 'TEXT')
  ensureColumn(db, 'users', 'bio', 'TEXT')
  ensureColumn(db, 'users', 'avatar_storage_name', 'TEXT')
  ensureColumn(db, 'users', 'avatar_mime_type', 'TEXT')
  ensureColumn(db, 'users', 'avatar_byte_size', 'INTEGER')
  ensureColumn(db, 'users', 'grade', 'TEXT')
  ensureColumn(db, 'staff_accounts', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'post_comments', 'parent_comment_id', 'TEXT REFERENCES post_comments(id)')
  db.exec('CREATE INDEX IF NOT EXISTS post_comments_parent_idx ON post_comments(parent_comment_id)')
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users(username COLLATE NOCASE) WHERE username IS NOT NULL")
  const publishedAt = nowIso()
  db.transaction(() => {
    for (const table of ['moments', 'wall_posts', 'contributions', 'questions', 'answers']) {
      db.prepare(`UPDATE ${table} SET status = 'approved', published_at = COALESCE(published_at, created_at), updated_at = ? WHERE status = 'pending'`).run(publishedAt)
    }
  })()
  return db
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function nowIso() {
  return new Date().toISOString()
}

export function addTime({ minutes = 0, hours = 0, days = 0 }) {
  const ms = ((days * 24 + hours) * 60 + minutes) * 60 * 1000
  return new Date(Date.now() + ms).toISOString()
}

export function purgeExpired(db) {
  const now = nowIso()
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now)
  db.prepare('DELETE FROM email_tokens WHERE expires_at <= ? OR consumed_at IS NOT NULL').run(now)
  db.prepare("DELETE FROM staff_applications WHERE status IN ('approved','rejected','withdrawn') AND purge_after IS NOT NULL AND purge_after <= ?").run(now)
}
