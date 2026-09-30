CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client TEXT NOT NULL CHECK (client IN ('website','extension')),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE problems (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('codeforces','codechef','atcoder','leetcode','other')),
  rating INTEGER,
  contest_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  created_at TEXT NOT NULL,
  UNIQUE(user_id, url)
);
CREATE TABLE patterns (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  trigger TEXT NOT NULL,
  core_idea TEXT NOT NULL,
  complexity TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE mistakes (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  contest_id TEXT,
  root_cause TEXT NOT NULL CHECK (root_cause IN ('misread_constraint','missed_edge_case','wrong_approach','time_management','implementation_bug','other')),
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE snippets (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  created_at TEXT NOT NULL
);
CREATE TABLE editorial_takeaways (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  contest_id TEXT,
  one_liner TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_problems_user_date ON problems(user_id, created_at DESC, id DESC);
CREATE INDEX idx_patterns_user_date ON patterns(user_id, created_at DESC, id DESC);
CREATE INDEX idx_patterns_user_problem ON patterns(user_id, problem_id);
CREATE INDEX idx_mistakes_user_date ON mistakes(user_id, created_at DESC, id DESC);
CREATE INDEX idx_mistakes_user_problem ON mistakes(user_id, problem_id);
CREATE INDEX idx_mistakes_user_root_date ON mistakes(user_id, root_cause, created_at DESC, id DESC);
CREATE INDEX idx_snippets_user_date ON snippets(user_id, created_at DESC, id DESC);
CREATE INDEX idx_editorial_takeaways_user_date ON editorial_takeaways(user_id, created_at DESC, id DESC);
CREATE INDEX idx_editorial_takeaways_user_problem ON editorial_takeaways(user_id, problem_id);
PRAGMA user_version = 2;
