
          CREATE TABLE problems (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            platform TEXT NOT NULL CHECK (platform IN ('codeforces','codechef','atcoder','other')),
            rating INTEGER,
            contest_id TEXT,
            tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
            created_at TEXT NOT NULL
          );
          CREATE TABLE patterns (
            id INTEGER PRIMARY KEY,
            trigger TEXT NOT NULL,
            core_idea TEXT NOT NULL,
            complexity TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
            problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE mistakes (
            id INTEGER PRIMARY KEY,
            problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
            contest_id TEXT,
            root_cause TEXT NOT NULL CHECK (root_cause IN ('misread_constraint','missed_edge_case','wrong_approach','time_management','implementation_bug','other')),
            notes TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE snippets (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            language TEXT NOT NULL,
            code TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
            created_at TEXT NOT NULL
          );
          CREATE TABLE editorial_takeaways (
            id INTEGER PRIMARY KEY,
            problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
            contest_id TEXT,
            one_liner TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_problems_contest_id ON problems(contest_id);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at DESC);
          CREATE INDEX idx_patterns_problem_id ON patterns(problem_id);
          CREATE INDEX idx_mistakes_created_at ON mistakes(created_at DESC);
          CREATE INDEX idx_mistakes_problem_id ON mistakes(problem_id);
          CREATE INDEX idx_mistakes_root_date ON mistakes(root_cause, created_at DESC);
          CREATE INDEX idx_mistakes_contest_id ON mistakes(contest_id);
          CREATE INDEX idx_snippets_created_at ON snippets(created_at DESC);
          CREATE INDEX idx_editorial_created_at ON editorial_takeaways(created_at DESC);
          CREATE INDEX idx_editorial_problem_id ON editorial_takeaways(problem_id);
          CREATE INDEX idx_editorial_contest_id ON editorial_takeaways(contest_id);
          PRAGMA user_version = 1;
        