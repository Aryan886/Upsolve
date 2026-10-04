import Database from "better-sqlite3";
import {
  ROOT_CAUSES,
  INVITATION_INVALID_MESSAGE,
  BETA_ACCOUNT_UNAVAILABLE_MESSAGE,
  BETA_FULL_MESSAGE,
  BETA_UNAVAILABLE_MESSAGE,
  detectProblemPage,
  type User,
  type Editorial,
  type EditorialCreate,
  type EditorialPatch,
  type FeedItem,
  type Mistake,
  type MistakeCreate,
  type MistakePatch,
  type NoteType,
  type PageMeta,
  type Pattern,
  type PatternCreate,
  type PatternPatch,
  type Problem,
  type ProblemInput,
  type RootCause,
  type Snippet,
  type SnippetCreate,
  type SnippetPatch,
  normalizeProblemUrl,
} from "@cp-notes/shared";
import { AppError } from "./errors.js";

type SqlParams = Record<string, string | number | null>;
type Row = Record<string, unknown>;

export interface PageOptions {
  page: number;
  limit: number;
}

export interface SearchPageOptions extends PageOptions {
  query?: string | undefined;
}

export interface DatePageOptions extends PageOptions {
  from?: string | undefined;
  to?: string | undefined;
}

export interface BetaStatus {
  state: "not issued" | "open" | "expired" | "revoked" | "full";
  signupCount: number;
  maxSignups: number;
  remainingSignups: number;
  expiresAt: string | null;
}

const problemColumns = `
  p.id AS p_id,
  p.name AS p_name,
  p.url AS p_url,
  p.platform AS p_platform,
  p.rating AS p_rating,
  p.contest_id AS p_contest_id,
  p.tags AS p_tags,
  p.created_at AS p_created_at`;

function parseTags(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) {
      throw new Error("Expected an array of strings");
    }
    return parsed;
  } catch (error) {
    throw new AppError(500, "corrupt_data", "Stored tags could not be read", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function problemFromRow(row: Row, prefix = ""): Problem {
  return {
    id: Number(row[`${prefix}id`]),
    name: String(row[`${prefix}name`]),
    url: String(row[`${prefix}url`]),
    platform: String(row[`${prefix}platform`]) as Problem["platform"],
    rating: row[`${prefix}rating`] === null ? null : Number(row[`${prefix}rating`]),
    contestId: nullableString(row[`${prefix}contest_id`]),
    tags: parseTags(row[`${prefix}tags`]),
    createdAt: String(row[`${prefix}created_at`]),
  };
}

function joinedProblem(row: Row): Problem | null {
  return row.p_id === null || row.p_id === undefined ? null : problemFromRow(row, "p_");
}

function meta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
}

function likeQuery(query: string | undefined): string | undefined {
  const cleaned = query?.trim().toLocaleLowerCase();
  return cleaned ? `%${cleaned}%` : undefined;
}

export class NotesDatabase {
  private readonly db: Database.Database;

  constructor(path: string, options: { existingOnly?: boolean; legacyOwner?: { email: string; passwordHash: string } } = {}) {
    this.db = new Database(path, { fileMustExist: options.existingOnly ?? false });
    try {
      if (options.existingOnly && this.db.pragma("user_version", { simple: true }) === 0) throw new Error("Database is not initialized. Use the admin init command.");
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("busy_timeout = 5000");
      if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
      this.migrate(options.legacyOwner);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private migrate(legacyOwner?: { email: string; passwordHash: string }): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 4) {
      throw new AppError(500, "database_too_new", `Database schema version ${version} is not supported`);
    }
    if (version === 0) {
      this.db.transaction(() => {
        this.db.exec(`
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
        `);
      })();
    }
    if (version < 2) this.migrateOwnership(legacyOwner);
    if (version < 3) this.migrateInvitations();
    if (version < 4) this.migrateBetaSignup();
  }

  private migrateBetaSignup(): void {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE beta_signup (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          token_hash TEXT UNIQUE,
          max_signups INTEGER NOT NULL DEFAULT 30 CHECK (max_signups BETWEEN 1 AND 30),
          signup_count INTEGER NOT NULL DEFAULT 0 CHECK (signup_count BETWEEN 0 AND max_signups),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);
      this.db.pragma("user_version = 4");
    })();
  }

  private migrateInvitations(): void {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE invitations (
          email TEXT PRIMARY KEY NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);
      this.db.pragma("user_version = 3");
    })();
  }

  private migrateOwnership(owner?: { email: string; passwordHash: string }): void {
    const tables = ["problems", "patterns", "mistakes", "snippets", "editorial_takeaways"];
    const populated = tables.some((table) => Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count) > 0);
    if (populated && !owner) {
      throw new Error("Legacy notes need an explicit owner. Stop the app and run the admin init command; it backs up before migration.");
    }
    this.db.transaction(() => {
      this.db.exec(`
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
      `);
      const user = owner ? this.createUser(owner.email, owner.passwordHash) : null;
      for (const table of tables) {
        const original = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as Row;
        const columns = (this.db.pragma(`table_info(${table})`) as Row[]).map((column) => String(column.name)).join(", ");
        let sql = String(original.sql).replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_owned`);
        sql = sql.replace("id INTEGER PRIMARY KEY,", "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),");
        sql = sql.replace("url TEXT NOT NULL UNIQUE", "url TEXT NOT NULL");
        sql = sql.replace("'atcoder','other'", "'atcoder','leetcode','other'");
        sql = sql.replaceAll("REFERENCES problems(id)", "REFERENCES problems_owned(id)");
        if (table === "problems") sql = sql.replace(/\)\s*$/, ", UNIQUE(user_id, url))");
        this.db.exec(sql);
        if (user) this.db.prepare(`INSERT INTO ${table}_owned (${columns}, user_id) SELECT ${columns}, ? FROM ${table}`).run(user.id);
      }
      for (const table of [...tables].reverse()) this.db.exec(`DROP TABLE ${table}`);
      for (const table of tables) {
        this.db.exec(`ALTER TABLE ${table}_owned RENAME TO ${table}`);
        this.db.exec(`CREATE INDEX idx_${table}_user_date ON ${table}(user_id, created_at DESC, id DESC)`);
        if (table !== "problems" && table !== "snippets") {
          this.db.exec(`CREATE INDEX idx_${table}_user_problem ON ${table}(user_id, problem_id)`);
        }
      }
      this.db.exec("CREATE INDEX idx_mistakes_user_root_date ON mistakes(user_id, root_cause, created_at DESC, id DESC)");
      if ((this.db.pragma("foreign_key_check") as Row[]).length) throw new Error("Ownership migration failed foreign key validation");
      this.db.pragma("user_version = 2");
    })();
  }

  health(): void {
    this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
  }

  createUser(email: string, passwordHash: string): User {
    const normalized = email.trim().toLowerCase();
    if (this.getUserByEmail(normalized)) throw new AppError(409, "account_exists", "An account with this email already exists");
    const createdAt = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)").run(normalized, passwordHash, createdAt);
    return { id: Number(result.lastInsertRowid), email: normalized, createdAt };
  }

  getUserByEmail(email: string): (User & { passwordHash: string; active: boolean }) | null {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
    return row ? { id: Number(row.id), email: String(row.email), createdAt: String(row.created_at), passwordHash: String(row.password_hash), active: row.active === 1 } : null;
  }

  issueInvitation(email: string, tokenHash: string, expiresAt: string): { email: string; expiresAt: string } {
    const normalized = email.trim().toLowerCase();
    return this.db.transaction(() => {
      if (this.getUserByEmail(normalized)) {
        throw new AppError(409, "account_exists", "An account with this email already exists. Use reset or contact the operator instead.");
      }
      this.db.prepare(`INSERT INTO invitations (email, token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET token_hash = excluded.token_hash,
          created_at = excluded.created_at, expires_at = excluded.expires_at`)
        .run(normalized, tokenHash, new Date().toISOString(), expiresAt);
      return { email: normalized, expiresAt };
    }).immediate();
  }

  getInvitation(tokenHash: string): { email: string; expiresAt: string } | null {
    const row = this.db.prepare(`SELECT email, expires_at FROM invitations
      WHERE token_hash = ? AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM users WHERE users.email = invitations.email)`)
      .get(tokenHash, new Date().toISOString()) as Row | undefined;
    return row ? { email: String(row.email), expiresAt: String(row.expires_at) } : null;
  }

  revokeInvitation(email: string): boolean {
    return this.db.prepare("DELETE FROM invitations WHERE email = ?").run(email.trim().toLowerCase()).changes === 1;
  }

  acceptInvitation(tokenHash: string, passwordHash: string): { email: string } {
    const invalid = () => new AppError(400, "invitation_invalid", INVITATION_INVALID_MESSAGE);
    try {
      return this.db.transaction(() => {
        const invitation = this.getInvitation(tokenHash);
        if (!invitation) throw invalid();
        this.createUser(invitation.email, passwordHash);
        const result = this.db.prepare("DELETE FROM invitations WHERE email = ? AND token_hash = ?")
          .run(invitation.email, tokenHash);
        if (result.changes !== 1) throw invalid();
        return { email: invitation.email };
      }).immediate();
    } catch (error) {
      if (error instanceof AppError && error.code === "account_exists") throw invalid();
      if (error instanceof Database.SqliteError && error.code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes("users.email")) {
        throw invalid();
      }
      throw error;
    }
  }

  getBetaStatus(): BetaStatus {
    const row = this.db.prepare("SELECT token_hash, max_signups, signup_count, expires_at FROM beta_signup WHERE id = 1").get() as Row | undefined;
    if (!row) return { state: "not issued", signupCount: 0, maxSignups: 30, remainingSignups: 30, expiresAt: null };
    const signupCount = Number(row.signup_count);
    const maxSignups = Number(row.max_signups);
    const expiresAt = String(row.expires_at);
    let state: BetaStatus["state"] = "open";
    if (signupCount >= maxSignups) state = "full";
    else if (row.token_hash === null) state = "revoked";
    else if (expiresAt <= new Date().toISOString()) state = "expired";
    return { state, signupCount, maxSignups, remainingSignups: maxSignups - signupCount, expiresAt };
  }

  issueBetaSignup(tokenHash: string, expiresAt: string): BetaStatus {
    return this.db.transaction(() => {
      const status = this.getBetaStatus();
      if (status.remainingSignups === 0) throw new AppError(400, "beta_full", BETA_FULL_MESSAGE);
      this.db.prepare(`INSERT INTO beta_signup (id, token_hash, created_at, expires_at)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`)
        .run(tokenHash, new Date().toISOString(), expiresAt);
      return this.getBetaStatus();
    }).immediate();
  }

  getBetaSignup(tokenHash: string): { expiresAt: string; remainingSignups: number } | null {
    const row = this.db.prepare("SELECT expires_at, max_signups, signup_count FROM beta_signup WHERE id = 1 AND token_hash = ?")
      .get(tokenHash) as Row | undefined;
    if (!row || String(row.expires_at) <= new Date().toISOString()) return null;
    const remainingSignups = Number(row.max_signups) - Number(row.signup_count);
    if (remainingSignups === 0) throw new AppError(400, "beta_full", BETA_FULL_MESSAGE);
    return { expiresAt: String(row.expires_at), remainingSignups };
  }

  revokeBetaSignup(): boolean {
    return this.db.prepare("UPDATE beta_signup SET token_hash = NULL WHERE id = 1 AND token_hash IS NOT NULL").run().changes === 1;
  }

  acceptBetaSignup(tokenHash: string, email: string, passwordHash: string): { email: string } {
    try {
      return this.db.transaction(() => {
        if (!this.getBetaSignup(tokenHash)) throw new AppError(400, "beta_unavailable", BETA_UNAVAILABLE_MESSAGE);
        if (this.getUserByEmail(email)) throw new AppError(400, "beta_account_unavailable", BETA_ACCOUNT_UNAVAILABLE_MESSAGE);
        const user = this.createUser(email, passwordHash);
        const result = this.db.prepare(`UPDATE beta_signup SET signup_count = signup_count + 1
          WHERE id = 1 AND token_hash = ? AND expires_at > ? AND signup_count < max_signups`)
          .run(tokenHash, new Date().toISOString());
        if (result.changes !== 1) throw new AppError(400, "beta_unavailable", BETA_UNAVAILABLE_MESSAGE);
        return { email: user.email };
      }).immediate();
    } catch (error) {
      if (error instanceof AppError && error.code === "account_exists") {
        throw new AppError(400, "beta_account_unavailable", BETA_ACCOUNT_UNAVAILABLE_MESSAGE);
      }
      if (error instanceof Database.SqliteError && error.code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes("users.email")) {
        throw new AppError(400, "beta_account_unavailable", BETA_ACCOUNT_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }
  }

  setPassword(userId: number, passwordHash: string, expectedHash?: string): void {
    this.db.transaction(() => {
      const result = expectedHash
        ? this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ? AND active = 1").run(passwordHash, userId, expectedHash)
        : this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
      if (!result.changes) throw new AppError(401, "session_expired", "Account changed. Sign in again.");
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    })();
  }

  disableUser(userId: number): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(userId);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    })();
  }

  createSession(userId: number, expectedHash: string, tokenHash: string, client: "website" | "extension", expiresAt: string): void {
    this.db.transaction(() => {
      const user = this.db.prepare("SELECT 1 FROM users WHERE id = ? AND password_hash = ? AND active = 1").get(userId, expectedHash);
      if (!user) throw new AppError(401, "invalid_credentials", "Email or password is incorrect");
      this.db.prepare("INSERT INTO sessions (token_hash, user_id, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(tokenHash, userId, client, new Date().toISOString(), expiresAt);
    })();
  }

  getSession(tokenHash: string, client: "website" | "extension"): User | null {
    const row = this.db.prepare(`SELECT u.id, u.email, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.client = ? AND s.expires_at > ? AND u.active = 1`).get(tokenHash, client, new Date().toISOString()) as Row | undefined;
    return row ? { id: Number(row.id), email: String(row.email), createdAt: String(row.created_at) } : null;
  }

  revokeSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  pruneSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  }

  private requireProblem(userId: number, id: number): void {
    const found = this.db.prepare("SELECT 1 FROM problems WHERE user_id = ? AND id = ?").get(userId, id);
    if (!found) throw new AppError(404, "problem_not_found", `Problem ${id} does not exist`);
  }

  upsertProblem(userId: number, input: ProblemInput): Problem {
    const url = normalizeProblemUrl(input.url);
    const existing = this.db.prepare("SELECT * FROM problems WHERE user_id = ? AND url = ?").get(userId, url) as Row | undefined;
    if (!existing) {
      const createdAt = new Date().toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO problems (user_id, name, url, platform, rating, contest_id, tags, created_at)
           VALUES (@userId, @name, @url, @platform, @rating, @contestId, @tags, @createdAt)`,
        )
        .run({
          userId,
          name: input.name,
          url,
          platform: input.platform,
          rating: input.rating ?? null,
          contestId: input.contestId ?? null,
          tags: JSON.stringify(input.tags ?? []),
          createdAt,
        });
      return this.getProblem(userId, Number(result.lastInsertRowid));
    }

    const existingTags = parseTags(existing.tags);
    this.db
      .prepare(
        `UPDATE problems SET
          platform = CASE WHEN platform = 'other' AND @isLeetcode = 1 THEN 'leetcode' ELSE platform END,
          rating = COALESCE(rating, @rating),
          contest_id = COALESCE(contest_id, @contestId),
          tags = CASE WHEN json_array_length(tags) = 0 THEN @tags ELSE tags END
         WHERE user_id = @userId AND id = @id`,
      )
      .run({
        userId,
        isLeetcode: input.platform === "leetcode" && detectProblemPage(url)?.platform === "leetcode" ? 1 : 0,
        id: Number(existing.id),
        rating: input.rating ?? null,
        contestId: input.contestId ?? null,
        tags: JSON.stringify(existingTags.length === 0 ? (input.tags ?? []) : existingTags),
      });
    return this.getProblem(userId, Number(existing.id));
  }

  getProblem(userId: number, id: number): Problem {
    const row = this.db.prepare("SELECT * FROM problems WHERE user_id = ? AND id = ?").get(userId, id) as Row | undefined;
    if (!row) throw new AppError(404, "problem_not_found", `Problem ${id} does not exist`);
    return problemFromRow(row);
  }

  listProblems(userId: number, options: SearchPageOptions): { data: Problem[]; meta: PageMeta } {
    const query = likeQuery(options.query);
    const where = query
      ? `WHERE user_id = @userId AND (LOWER(name) LIKE @query OR LOWER(url) LIKE @query
         OR EXISTS (SELECT 1 FROM json_each(problems.tags) tag WHERE LOWER(tag.value) LIKE @query))`
      : "WHERE user_id = @userId";
    const params: SqlParams = { userId, limit: options.limit, offset: (options.page - 1) * options.limit };
    if (query) params.query = query;
    const rows = this.db
      .prepare(`SELECT * FROM problems ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Row[];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM problems ${where}`).get(params) as Row).count);
    return { data: rows.map((row) => problemFromRow(row)), meta: meta(options.page, options.limit, total) };
  }

  private resolveProblemId(userId: number, input: {
    problemId?: number | null | undefined;
    problem?: ProblemInput | undefined;
  }): number | null {
    if (input.problem) return this.upsertProblem(userId, input.problem).id;
    if (input.problemId !== undefined && input.problemId !== null) {
      this.requireProblem(userId, input.problemId);
      return input.problemId;
    }
    return null;
  }

  createPattern(userId: number, input: PatternCreate): Pattern {
    return this.db.transaction(() => {
      const problemId = this.resolveProblemId(userId, input);
      const result = this.db
        .prepare(
          `INSERT INTO patterns (user_id, trigger, core_idea, complexity, tags, problem_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, input.trigger, input.coreIdea, input.complexity, JSON.stringify(input.tags ?? []), problemId, new Date().toISOString());
      return this.getPattern(userId, Number(result.lastInsertRowid));
    })();
  }

  createMistake(userId: number, input: MistakeCreate): Mistake {
    return this.db.transaction(() => {
      const problemId = this.resolveProblemId(userId, input);
      const result = this.db
        .prepare(
          `INSERT INTO mistakes (user_id, problem_id, contest_id, root_cause, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, problemId, input.contestId ?? null, input.rootCause, input.notes, new Date().toISOString());
      return this.getMistake(userId, Number(result.lastInsertRowid));
    })();
  }

  createSnippet(userId: number, input: SnippetCreate): Snippet {
    const result = this.db
      .prepare(`INSERT INTO snippets (user_id, name, language, code, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userId, input.name, input.language, input.code, JSON.stringify(input.tags ?? []), new Date().toISOString());
    return this.getSnippet(userId, Number(result.lastInsertRowid));
  }

  createEditorial(userId: number, input: EditorialCreate): Editorial {
    return this.db.transaction(() => {
      const problemId = this.resolveProblemId(userId, input);
      const result = this.db
        .prepare(
          `INSERT INTO editorial_takeaways (user_id, problem_id, contest_id, one_liner, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(userId, problemId, input.contestId ?? null, input.oneLiner, new Date().toISOString());
      return this.getEditorial(userId, Number(result.lastInsertRowid));
    })();
  }

  getPattern(userId: number, id: number): Pattern {
    const row = this.db
      .prepare(`SELECT n.*, ${problemColumns} FROM patterns n LEFT JOIN problems p ON p.id = n.problem_id AND p.user_id = n.user_id WHERE n.user_id = ? AND n.id = ?`)
      .get(userId, id) as Row | undefined;
    if (!row) throw new AppError(404, "pattern_not_found", `Pattern ${id} does not exist`);
    return this.mapPattern(row);
  }

  getMistake(userId: number, id: number): Mistake {
    const row = this.db
      .prepare(`SELECT n.*, ${problemColumns} FROM mistakes n LEFT JOIN problems p ON p.id = n.problem_id AND p.user_id = n.user_id WHERE n.user_id = ? AND n.id = ?`)
      .get(userId, id) as Row | undefined;
    if (!row) throw new AppError(404, "mistake_not_found", `Mistake ${id} does not exist`);
    return this.mapMistake(row);
  }

  getSnippet(userId: number, id: number): Snippet {
    const row = this.db.prepare("SELECT * FROM snippets WHERE user_id = ? AND id = ?").get(userId, id) as Row | undefined;
    if (!row) throw new AppError(404, "snippet_not_found", `Snippet ${id} does not exist`);
    return this.mapSnippet(row);
  }

  getEditorial(userId: number, id: number): Editorial {
    const row = this.db
      .prepare(
        `SELECT n.*, ${problemColumns} FROM editorial_takeaways n LEFT JOIN problems p ON p.id = n.problem_id AND p.user_id = n.user_id WHERE n.user_id = ? AND n.id = ?`,
      )
      .get(userId, id) as Row | undefined;
    if (!row) throw new AppError(404, "editorial_not_found", `Editorial ${id} does not exist`);
    return this.mapEditorial(row);
  }

  private mapPattern(row: Row): Pattern {
    return {
      id: Number(row.id),
      trigger: String(row.trigger),
      coreIdea: String(row.core_idea),
      complexity: String(row.complexity),
      tags: parseTags(row.tags),
      problem: joinedProblem(row),
      createdAt: String(row.created_at),
    };
  }

  private mapMistake(row: Row): Mistake {
    return {
      id: Number(row.id),
      problem: joinedProblem(row),
      contestId: nullableString(row.contest_id),
      rootCause: String(row.root_cause) as RootCause,
      notes: String(row.notes),
      createdAt: String(row.created_at),
    };
  }

  private mapSnippet(row: Row): Snippet {
    return {
      id: Number(row.id),
      name: String(row.name),
      language: String(row.language),
      code: String(row.code),
      tags: parseTags(row.tags),
      createdAt: String(row.created_at),
    };
  }

  private mapEditorial(row: Row): Editorial {
    return {
      id: Number(row.id),
      problem: joinedProblem(row),
      contestId: nullableString(row.contest_id),
      oneLiner: String(row.one_liner),
      createdAt: String(row.created_at),
    };
  }

  private listJoined<T>(userId: number, config: {
    table: string;
    options: SearchPageOptions;
    searchSql: string;
    map: (row: Row) => T;
  }): { data: T[]; meta: PageMeta } {
    const query = likeQuery(config.options.query);
    const where = `WHERE n.user_id = @userId${query ? ` AND (${config.searchSql})` : ""}`;
    const params: SqlParams = {
      userId,
      limit: config.options.limit,
      offset: (config.options.page - 1) * config.options.limit,
    };
    if (query) params.query = query;
    const rows = this.db
      .prepare(
        `SELECT n.*, ${problemColumns} FROM ${config.table} n LEFT JOIN problems p ON p.id = n.problem_id AND p.user_id = n.user_id
         ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params) as Row[];
    const total = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM ${config.table} n LEFT JOIN problems p ON p.id = n.problem_id AND p.user_id = n.user_id ${where}`)
          .get(params) as Row
      ).count,
    );
    return { data: rows.map(config.map), meta: meta(config.options.page, config.options.limit, total) };
  }

  listPatterns(userId: number, options: SearchPageOptions): { data: Pattern[]; meta: PageMeta } {
    return this.listJoined(userId, {
      table: "patterns",
      options,
      searchSql: `LOWER(n.trigger) LIKE @query OR LOWER(n.core_idea) LIKE @query OR LOWER(n.complexity) LIKE @query
        OR LOWER(COALESCE(p.name, '')) LIKE @query
        OR EXISTS (SELECT 1 FROM json_each(n.tags) tag WHERE LOWER(tag.value) LIKE @query)`,
      map: (row) => this.mapPattern(row),
    });
  }

  listEditorial(userId: number, options: SearchPageOptions): { data: Editorial[]; meta: PageMeta } {
    return this.listJoined(userId, {
      table: "editorial_takeaways",
      options,
      searchSql: `LOWER(n.one_liner) LIKE @query OR LOWER(COALESCE(p.name, '')) LIKE @query
        OR LOWER(COALESCE(n.contest_id, '')) LIKE @query
        OR EXISTS (SELECT 1 FROM json_each(COALESCE(p.tags, '[]')) tag WHERE LOWER(tag.value) LIKE @query)`,
      map: (row) => this.mapEditorial(row),
    });
  }

  listSnippets(userId: number, options: SearchPageOptions & { language?: string | undefined }): { data: Snippet[]; meta: PageMeta } {
    const clauses: string[] = ["user_id = @userId"];
    const params: SqlParams = { userId, limit: options.limit, offset: (options.page - 1) * options.limit };
    const query = likeQuery(options.query);
    if (query) {
      clauses.push(
        `(LOWER(name) LIKE @query OR LOWER(code) LIKE @query OR EXISTS (SELECT 1 FROM json_each(tags) tag WHERE LOWER(tag.value) LIKE @query))`,
      );
      params.query = query;
    }
    if (options.language?.trim()) {
      clauses.push("LOWER(language) = @language");
      params.language = options.language.trim().toLocaleLowerCase();
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM snippets ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Row[];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM snippets ${where}`).get(params) as Row).count);
    return { data: rows.map((row) => this.mapSnippet(row)), meta: meta(options.page, options.limit, total) };
  }

  listMistakes(userId: number, options: DatePageOptions & { rootCause?: RootCause },
  ): { data: Mistake[]; meta: PageMeta } {
    const clauses: string[] = ["n.user_id = @userId"];
    const params: SqlParams = { userId, limit: options.limit, offset: (options.page - 1) * options.limit };
    if (options.rootCause) {
      clauses.push("n.root_cause = @rootCause");
      params.rootCause = options.rootCause;
    }
    if (options.from) {
      clauses.push("n.created_at >= @from");
      params.from = options.from;
    }
    if (options.to) {
      clauses.push("n.created_at <= @to");
      params.to = options.to;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT n.*, ${problemColumns} FROM mistakes n LEFT JOIN problems p ON p.id = n.problem_id AND p.user_id = n.user_id
         ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params) as Row[];
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS count FROM mistakes n ${where}`).get(params) as Row).count,
    );
    return { data: rows.map((row) => this.mapMistake(row)), meta: meta(options.page, options.limit, total) };
  }

  mistakeStats(userId: number): Record<RootCause, number> {
    const result = Object.fromEntries(ROOT_CAUSES.map((cause) => [cause, 0])) as Record<RootCause, number>;
    const rows = this.db.prepare("SELECT root_cause, COUNT(*) AS count FROM mistakes WHERE user_id = ? GROUP BY root_cause").all(userId) as Row[];
    for (const row of rows) result[String(row.root_cause) as RootCause] = Number(row.count);
    return result;
  }

  listFeed(userId: number, options: DatePageOptions & { types?: NoteType[] },
  ): { data: FeedItem[]; meta: PageMeta } {
    const typeClauses: string[] = [];
    const params: SqlParams = { userId, limit: options.limit, offset: (options.page - 1) * options.limit };
    if (options.types?.length) {
      options.types.forEach((type, index) => {
        params[`type${index}`] = type;
      });
      typeClauses.push(`type IN (${options.types.map((_, index) => `@type${index}`).join(",")})`);
    }
    if (options.from) {
      typeClauses.push("created_at >= @from");
      params.from = options.from;
    }
    if (options.to) {
      typeClauses.push("created_at <= @to");
      params.to = options.to;
    }
    const where = typeClauses.length ? `WHERE ${typeClauses.join(" AND ")}` : "";
    const union = `
      SELECT 'pattern' AS type, id, created_at FROM patterns WHERE user_id = @userId
      UNION ALL SELECT 'mistake', id, created_at FROM mistakes WHERE user_id = @userId
      UNION ALL SELECT 'snippet', id, created_at FROM snippets WHERE user_id = @userId
      UNION ALL SELECT 'editorial', id, created_at FROM editorial_takeaways WHERE user_id = @userId`;
    const rows = this.db
      .prepare(`SELECT * FROM (${union}) ${where} ORDER BY created_at DESC, type, id DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Row[];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM (${union}) ${where}`).get(params) as Row).count);
    const data = rows.map((row): FeedItem => {
      const id = Number(row.id);
      switch (row.type) {
        case "pattern":
          return { type: "pattern", record: this.getPattern(userId, id) };
        case "mistake":
          return { type: "mistake", record: this.getMistake(userId, id) };
        case "snippet":
          return { type: "snippet", record: this.getSnippet(userId, id) };
        case "editorial":
          return { type: "editorial", record: this.getEditorial(userId, id) };
        default:
          throw new AppError(500, "corrupt_data", `Unknown note type ${String(row.type)}`);
      }
    });
    return { data, meta: meta(options.page, options.limit, total) };
  }

  private updateRow(userId: number, table: string, id: number, values: Record<string, unknown>): void {
    const entries = Object.entries(values);
    const assignments = entries.map(([column], index) => `${column} = @value${index}`).join(", ");
    const params: Record<string, unknown> = { userId, id };
    entries.forEach(([, value], index) => {
      params[`value${index}`] = value;
    });
    const result = this.db.prepare(`UPDATE ${table} SET ${assignments} WHERE user_id = @userId AND id = @id`).run(params);
    if (result.changes === 0) throw new AppError(404, "note_not_found", `Entry ${id} does not exist`);
  }

  private validatePatchedProblem(userId: number, problemId: number | null | undefined): void {
    if (problemId !== undefined && problemId !== null) this.requireProblem(userId, problemId);
  }

  updatePattern(userId: number, id: number, patch: PatternPatch): Pattern {
    return this.db.transaction(() => {
      this.validatePatchedProblem(userId, patch.problemId);
      const values: Record<string, unknown> = {};
      if (patch.trigger !== undefined) values.trigger = patch.trigger;
      if (patch.coreIdea !== undefined) values.core_idea = patch.coreIdea;
      if (patch.complexity !== undefined) values.complexity = patch.complexity;
      if (patch.tags !== undefined) values.tags = JSON.stringify(patch.tags ?? []);
      if (patch.problemId !== undefined) values.problem_id = patch.problemId;
      this.updateRow(userId, "patterns", id, values);
      return this.getPattern(userId, id);
    })();
  }

  updateMistake(userId: number, id: number, patch: MistakePatch): Mistake {
    return this.db.transaction(() => {
      this.validatePatchedProblem(userId, patch.problemId);
      const values: Record<string, unknown> = {};
      if (patch.contestId !== undefined) values.contest_id = patch.contestId || null;
      if (patch.rootCause !== undefined) values.root_cause = patch.rootCause;
      if (patch.notes !== undefined) values.notes = patch.notes;
      if (patch.problemId !== undefined) values.problem_id = patch.problemId;
      this.updateRow(userId, "mistakes", id, values);
      return this.getMistake(userId, id);
    })();
  }

  updateSnippet(userId: number, id: number, patch: SnippetPatch): Snippet {
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.language !== undefined) values.language = patch.language;
    if (patch.code !== undefined) values.code = patch.code;
    if (patch.tags !== undefined) values.tags = JSON.stringify(patch.tags ?? []);
    this.updateRow(userId, "snippets", id, values);
    return this.getSnippet(userId, id);
  }

  updateEditorial(userId: number, id: number, patch: EditorialPatch): Editorial {
    return this.db.transaction(() => {
      this.validatePatchedProblem(userId, patch.problemId);
      const values: Record<string, unknown> = {};
      if (patch.contestId !== undefined) values.contest_id = patch.contestId || null;
      if (patch.oneLiner !== undefined) values.one_liner = patch.oneLiner;
      if (patch.problemId !== undefined) values.problem_id = patch.problemId;
      this.updateRow(userId, "editorial_takeaways", id, values);
      return this.getEditorial(userId, id);
    })();
  }

  deleteNote(userId: number, type: NoteType, id: number): void {
    const table = type === "editorial" ? "editorial_takeaways" : `${type}s`;
    const result = this.db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND id = ?`).run(userId, id);
    if (result.changes === 0) throw new AppError(404, "note_not_found", `Entry ${id} does not exist`);
  }
}
