import Database from "better-sqlite3";
import {
  ROOT_CAUSES,
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

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1) {
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
  }

  private requireProblem(id: number): void {
    const found = this.db.prepare("SELECT 1 FROM problems WHERE id = ?").get(id);
    if (!found) throw new AppError(404, "problem_not_found", `Problem ${id} does not exist`);
  }

  upsertProblem(input: ProblemInput): Problem {
    const url = normalizeProblemUrl(input.url);
    const existing = this.db.prepare("SELECT * FROM problems WHERE url = ?").get(url) as Row | undefined;
    if (!existing) {
      const createdAt = new Date().toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO problems (name, url, platform, rating, contest_id, tags, created_at)
           VALUES (@name, @url, @platform, @rating, @contestId, @tags, @createdAt)`,
        )
        .run({
          name: input.name,
          url,
          platform: input.platform,
          rating: input.rating ?? null,
          contestId: input.contestId ?? null,
          tags: JSON.stringify(input.tags ?? []),
          createdAt,
        });
      return this.getProblem(Number(result.lastInsertRowid));
    }

    const existingTags = parseTags(existing.tags);
    this.db
      .prepare(
        `UPDATE problems SET
          rating = COALESCE(rating, @rating),
          contest_id = COALESCE(contest_id, @contestId),
          tags = CASE WHEN json_array_length(tags) = 0 THEN @tags ELSE tags END
         WHERE id = @id`,
      )
      .run({
        id: Number(existing.id),
        rating: input.rating ?? null,
        contestId: input.contestId ?? null,
        tags: JSON.stringify(existingTags.length === 0 ? (input.tags ?? []) : existingTags),
      });
    return this.getProblem(Number(existing.id));
  }

  getProblem(id: number): Problem {
    const row = this.db.prepare("SELECT * FROM problems WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new AppError(404, "problem_not_found", `Problem ${id} does not exist`);
    return problemFromRow(row);
  }

  listProblems(options: SearchPageOptions): { data: Problem[]; meta: PageMeta } {
    const query = likeQuery(options.query);
    const where = query
      ? `WHERE LOWER(name) LIKE @query OR LOWER(url) LIKE @query
         OR EXISTS (SELECT 1 FROM json_each(problems.tags) tag WHERE LOWER(tag.value) LIKE @query)`
      : "";
    const params: SqlParams = { limit: options.limit, offset: (options.page - 1) * options.limit };
    if (query) params.query = query;
    const rows = this.db
      .prepare(`SELECT * FROM problems ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Row[];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM problems ${where}`).get(params) as Row).count);
    return { data: rows.map((row) => problemFromRow(row)), meta: meta(options.page, options.limit, total) };
  }

  private resolveProblemId(input: {
    problemId?: number | null | undefined;
    problem?: ProblemInput | undefined;
  }): number | null {
    if (input.problem) return this.upsertProblem(input.problem).id;
    if (input.problemId !== undefined && input.problemId !== null) {
      this.requireProblem(input.problemId);
      return input.problemId;
    }
    return null;
  }

  createPattern(input: PatternCreate): Pattern {
    return this.db.transaction(() => {
      const problemId = this.resolveProblemId(input);
      const result = this.db
        .prepare(
          `INSERT INTO patterns (trigger, core_idea, complexity, tags, problem_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.trigger, input.coreIdea, input.complexity, JSON.stringify(input.tags ?? []), problemId, new Date().toISOString());
      return this.getPattern(Number(result.lastInsertRowid));
    })();
  }

  createMistake(input: MistakeCreate): Mistake {
    return this.db.transaction(() => {
      const problemId = this.resolveProblemId(input);
      const result = this.db
        .prepare(
          `INSERT INTO mistakes (problem_id, contest_id, root_cause, notes, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(problemId, input.contestId ?? null, input.rootCause, input.notes, new Date().toISOString());
      return this.getMistake(Number(result.lastInsertRowid));
    })();
  }

  createSnippet(input: SnippetCreate): Snippet {
    const result = this.db
      .prepare(`INSERT INTO snippets (name, language, code, tags, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(input.name, input.language, input.code, JSON.stringify(input.tags ?? []), new Date().toISOString());
    return this.getSnippet(Number(result.lastInsertRowid));
  }

  createEditorial(input: EditorialCreate): Editorial {
    return this.db.transaction(() => {
      const problemId = this.resolveProblemId(input);
      const result = this.db
        .prepare(
          `INSERT INTO editorial_takeaways (problem_id, contest_id, one_liner, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(problemId, input.contestId ?? null, input.oneLiner, new Date().toISOString());
      return this.getEditorial(Number(result.lastInsertRowid));
    })();
  }

  getPattern(id: number): Pattern {
    const row = this.db
      .prepare(`SELECT n.*, ${problemColumns} FROM patterns n LEFT JOIN problems p ON p.id = n.problem_id WHERE n.id = ?`)
      .get(id) as Row | undefined;
    if (!row) throw new AppError(404, "pattern_not_found", `Pattern ${id} does not exist`);
    return this.mapPattern(row);
  }

  getMistake(id: number): Mistake {
    const row = this.db
      .prepare(`SELECT n.*, ${problemColumns} FROM mistakes n LEFT JOIN problems p ON p.id = n.problem_id WHERE n.id = ?`)
      .get(id) as Row | undefined;
    if (!row) throw new AppError(404, "mistake_not_found", `Mistake ${id} does not exist`);
    return this.mapMistake(row);
  }

  getSnippet(id: number): Snippet {
    const row = this.db.prepare("SELECT * FROM snippets WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new AppError(404, "snippet_not_found", `Snippet ${id} does not exist`);
    return this.mapSnippet(row);
  }

  getEditorial(id: number): Editorial {
    const row = this.db
      .prepare(
        `SELECT n.*, ${problemColumns} FROM editorial_takeaways n LEFT JOIN problems p ON p.id = n.problem_id WHERE n.id = ?`,
      )
      .get(id) as Row | undefined;
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

  private listJoined<T>(config: {
    table: string;
    options: SearchPageOptions;
    searchSql: string;
    map: (row: Row) => T;
  }): { data: T[]; meta: PageMeta } {
    const query = likeQuery(config.options.query);
    const where = query ? `WHERE (${config.searchSql})` : "";
    const params: SqlParams = {
      limit: config.options.limit,
      offset: (config.options.page - 1) * config.options.limit,
    };
    if (query) params.query = query;
    const rows = this.db
      .prepare(
        `SELECT n.*, ${problemColumns} FROM ${config.table} n LEFT JOIN problems p ON p.id = n.problem_id
         ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params) as Row[];
    const total = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM ${config.table} n LEFT JOIN problems p ON p.id = n.problem_id ${where}`)
          .get(params) as Row
      ).count,
    );
    return { data: rows.map(config.map), meta: meta(config.options.page, config.options.limit, total) };
  }

  listPatterns(options: SearchPageOptions): { data: Pattern[]; meta: PageMeta } {
    return this.listJoined({
      table: "patterns",
      options,
      searchSql: `LOWER(n.trigger) LIKE @query OR LOWER(n.core_idea) LIKE @query OR LOWER(n.complexity) LIKE @query
        OR LOWER(COALESCE(p.name, '')) LIKE @query
        OR EXISTS (SELECT 1 FROM json_each(n.tags) tag WHERE LOWER(tag.value) LIKE @query)`,
      map: (row) => this.mapPattern(row),
    });
  }

  listEditorial(options: SearchPageOptions): { data: Editorial[]; meta: PageMeta } {
    return this.listJoined({
      table: "editorial_takeaways",
      options,
      searchSql: `LOWER(n.one_liner) LIKE @query OR LOWER(COALESCE(p.name, '')) LIKE @query
        OR LOWER(COALESCE(n.contest_id, '')) LIKE @query
        OR EXISTS (SELECT 1 FROM json_each(COALESCE(p.tags, '[]')) tag WHERE LOWER(tag.value) LIKE @query)`,
      map: (row) => this.mapEditorial(row),
    });
  }

  listSnippets(options: SearchPageOptions & { language?: string | undefined }): { data: Snippet[]; meta: PageMeta } {
    const clauses: string[] = [];
    const params: SqlParams = { limit: options.limit, offset: (options.page - 1) * options.limit };
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

  listMistakes(
    options: DatePageOptions & { rootCause?: RootCause },
  ): { data: Mistake[]; meta: PageMeta } {
    const clauses: string[] = [];
    const params: SqlParams = { limit: options.limit, offset: (options.page - 1) * options.limit };
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
        `SELECT n.*, ${problemColumns} FROM mistakes n LEFT JOIN problems p ON p.id = n.problem_id
         ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params) as Row[];
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS count FROM mistakes n ${where}`).get(params) as Row).count,
    );
    return { data: rows.map((row) => this.mapMistake(row)), meta: meta(options.page, options.limit, total) };
  }

  mistakeStats(): Record<RootCause, number> {
    const result = Object.fromEntries(ROOT_CAUSES.map((cause) => [cause, 0])) as Record<RootCause, number>;
    const rows = this.db.prepare("SELECT root_cause, COUNT(*) AS count FROM mistakes GROUP BY root_cause").all() as Row[];
    for (const row of rows) result[String(row.root_cause) as RootCause] = Number(row.count);
    return result;
  }

  listFeed(
    options: DatePageOptions & { types?: NoteType[] },
  ): { data: FeedItem[]; meta: PageMeta } {
    const typeClauses: string[] = [];
    const params: SqlParams = { limit: options.limit, offset: (options.page - 1) * options.limit };
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
      SELECT 'pattern' AS type, id, created_at FROM patterns
      UNION ALL SELECT 'mistake', id, created_at FROM mistakes
      UNION ALL SELECT 'snippet', id, created_at FROM snippets
      UNION ALL SELECT 'editorial', id, created_at FROM editorial_takeaways`;
    const rows = this.db
      .prepare(`SELECT * FROM (${union}) ${where} ORDER BY created_at DESC, type, id DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Row[];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM (${union}) ${where}`).get(params) as Row).count);
    const data = rows.map((row): FeedItem => {
      const id = Number(row.id);
      switch (row.type) {
        case "pattern":
          return { type: "pattern", record: this.getPattern(id) };
        case "mistake":
          return { type: "mistake", record: this.getMistake(id) };
        case "snippet":
          return { type: "snippet", record: this.getSnippet(id) };
        case "editorial":
          return { type: "editorial", record: this.getEditorial(id) };
        default:
          throw new AppError(500, "corrupt_data", `Unknown note type ${String(row.type)}`);
      }
    });
    return { data, meta: meta(options.page, options.limit, total) };
  }

  private updateRow(table: string, id: number, values: Record<string, unknown>): void {
    const entries = Object.entries(values);
    const assignments = entries.map(([column], index) => `${column} = @value${index}`).join(", ");
    const params: Record<string, unknown> = { id };
    entries.forEach(([, value], index) => {
      params[`value${index}`] = value;
    });
    const result = this.db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = @id`).run(params);
    if (result.changes === 0) throw new AppError(404, "note_not_found", `Entry ${id} does not exist`);
  }

  private validatePatchedProblem(problemId: number | null | undefined): void {
    if (problemId !== undefined && problemId !== null) this.requireProblem(problemId);
  }

  updatePattern(id: number, patch: PatternPatch): Pattern {
    return this.db.transaction(() => {
      this.validatePatchedProblem(patch.problemId);
      const values: Record<string, unknown> = {};
      if (patch.trigger !== undefined) values.trigger = patch.trigger;
      if (patch.coreIdea !== undefined) values.core_idea = patch.coreIdea;
      if (patch.complexity !== undefined) values.complexity = patch.complexity;
      if (patch.tags !== undefined) values.tags = JSON.stringify(patch.tags ?? []);
      if (patch.problemId !== undefined) values.problem_id = patch.problemId;
      this.updateRow("patterns", id, values);
      return this.getPattern(id);
    })();
  }

  updateMistake(id: number, patch: MistakePatch): Mistake {
    return this.db.transaction(() => {
      this.validatePatchedProblem(patch.problemId);
      const values: Record<string, unknown> = {};
      if (patch.contestId !== undefined) values.contest_id = patch.contestId || null;
      if (patch.rootCause !== undefined) values.root_cause = patch.rootCause;
      if (patch.notes !== undefined) values.notes = patch.notes;
      if (patch.problemId !== undefined) values.problem_id = patch.problemId;
      this.updateRow("mistakes", id, values);
      return this.getMistake(id);
    })();
  }

  updateSnippet(id: number, patch: SnippetPatch): Snippet {
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.language !== undefined) values.language = patch.language;
    if (patch.code !== undefined) values.code = patch.code;
    if (patch.tags !== undefined) values.tags = JSON.stringify(patch.tags ?? []);
    this.updateRow("snippets", id, values);
    return this.getSnippet(id);
  }

  updateEditorial(id: number, patch: EditorialPatch): Editorial {
    return this.db.transaction(() => {
      this.validatePatchedProblem(patch.problemId);
      const values: Record<string, unknown> = {};
      if (patch.contestId !== undefined) values.contest_id = patch.contestId || null;
      if (patch.oneLiner !== undefined) values.one_liner = patch.oneLiner;
      if (patch.problemId !== undefined) values.problem_id = patch.problemId;
      this.updateRow("editorial_takeaways", id, values);
      return this.getEditorial(id);
    })();
  }

  deleteNote(type: NoteType, id: number): void {
    const table = type === "editorial" ? "editorial_takeaways" : `${type}s`;
    const result = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (result.changes === 0) throw new AppError(404, "note_not_found", `Entry ${id} does not exist`);
  }
}
