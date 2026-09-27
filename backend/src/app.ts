import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAuth } from "./auth.js";
import cors, { type CorsOptions } from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, z } from "zod";
import {
  EditorialCreateSchema,
  EditorialPatchSchema,
  MistakeCreateSchema,
  MistakePatchSchema,
  NOTE_TYPES,
  NoteTypeSchema,
  PatternCreateSchema,
  PatternPatchSchema,
  ProblemInputSchema,
  RootCauseSchema,
  SnippetCreateSchema,
  SnippetPatchSchema,
  type NoteType,
} from "@cp-notes/shared";
import { NotesDatabase, type DatePageOptions, type PageOptions } from "./database.js";
import { AppError } from "./errors.js";

export interface CreateAppOptions {
  databasePath: string;
  websiteOrigins?: string[];
  extensionOrigins?: string[];
  localDevelopment?: boolean;
  sessionDays?: number;
  existingOnly?: boolean;
  websiteDirectory?: string;
}

function oneQueryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: unknown, fallback: number, maximum?: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    throw new AppError(400, "invalid_query", `Expected an integer from 1 to ${maximum ?? "any positive value"}`);
  }
  return parsed;
}

function pageOptions(request: Request): PageOptions {
  return {
    page: positiveInteger(request.query.page, 1),
    limit: positiveInteger(request.query.limit, 20, 100),
  };
}

function parseId(request: Request): number {
  return positiveInteger(request.params.id, 0);
}

function parseDate(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, "invalid_date", `${label} must be an ISO date or timestamp`);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new AppError(400, "invalid_date", `${label} must be a valid ISO date or timestamp`);
  return new Date(timestamp).toISOString();
}

function datePageOptions(request: Request): DatePageOptions {
  const pagination = pageOptions(request);
  const from = parseDate(request.query.from, "from");
  const to = parseDate(request.query.to, "to");
  if (from && to && from > to) throw new AppError(400, "invalid_date_range", "from must be before or equal to to");
  return {
    ...pagination,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function allowedOrigins(origins: string[]): CorsOptions["origin"] {
  return (origin, callback) => {
    const allowed =
      origin === undefined || origins.includes(origin);
    callback(allowed ? null : new AppError(403, "origin_not_allowed", "This origin cannot access CP Notes"), allowed);
  };
}

export function createApp(options: CreateAppOptions): { app: express.Express; close: () => void; database: NotesDatabase } {
  const database = new NotesDatabase(options.databasePath, { existingOnly: options.existingOnly ?? false });
  const app = express();
  const origins = options.websiteOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

  if (options.websiteDirectory && !existsSync(join(options.websiteDirectory, "index.html"))) {
    database.close();
    throw new Error("Built website is missing. Build the release before starting the app.");
  }
  const extensionOrigins = options.extensionOrigins ?? [];
  const auth = createAuth(database, { websiteOrigins: origins, extensionOrigins, localDevelopment: options.localDevelopment ?? false, sessionDays: options.sessionDays ?? 30 });
  const api = express.Router();
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set("X-Content-Type-Options", "nosniff");
    response.set("Referrer-Policy", "no-referrer");
    response.set("X-Frame-Options", "DENY");
    response.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  api.use(cors({ origin: allowedOrigins([...origins, ...extensionOrigins]), credentials: true }));
  api.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    database.health();
    response.set("Cache-Control", "no-store").json({ data: { status: "ok" } });
  });

  api.use("/auth", auth.router);
  api.use((request, response, next) => {
    response.locals.userId = auth.session(request).user.id;
    next();
  });

  api.post("/problems", (request, response) => {
    const problem = database.upsertProblem(response.locals.userId, ProblemInputSchema.parse(request.body));
    response.status(201).json({ data: problem });
  });

  api.get("/problems", (request, response) => {
    const result = database.listProblems(response.locals.userId, { ...pageOptions(request), query: oneQueryValue(request.query.query) });
    response.json(result);
  });

  api.post("/patterns", (request, response) => {
    response.status(201).json({ data: database.createPattern(response.locals.userId, PatternCreateSchema.parse(request.body)) });
  });
  api.get("/patterns", (request, response) => {
    response.json(database.listPatterns(response.locals.userId, { ...pageOptions(request), query: oneQueryValue(request.query.query) }));
  });
  api.patch("/patterns/:id", (request, response) => {
    response.json({ data: database.updatePattern(response.locals.userId, parseId(request), PatternPatchSchema.parse(request.body)) });
  });
  api.delete("/patterns/:id", (request, response) => {
    database.deleteNote(response.locals.userId, "pattern", parseId(request));
    response.status(204).end();
  });

  api.post("/mistakes", (request, response) => {
    response.status(201).json({ data: database.createMistake(response.locals.userId, MistakeCreateSchema.parse(request.body)) });
  });
  api.get("/mistakes", (request, response) => {
    const rootCauseValue = oneQueryValue(request.query.rootCause) ?? oneQueryValue(request.query.root_cause);
    const rootCause = rootCauseValue ? RootCauseSchema.parse(rootCauseValue) : undefined;
    response.json(database.listMistakes(response.locals.userId, { ...datePageOptions(request), ...(rootCause ? { rootCause } : {}) }));
  });
  api.get("/mistakes/stats", (_request, response) => {
    response.json({ data: database.mistakeStats(response.locals.userId) });
  });
  api.patch("/mistakes/:id", (request, response) => {
    response.json({ data: database.updateMistake(response.locals.userId, parseId(request), MistakePatchSchema.parse(request.body)) });
  });
  api.delete("/mistakes/:id", (request, response) => {
    database.deleteNote(response.locals.userId, "mistake", parseId(request));
    response.status(204).end();
  });

  api.post("/snippets", (request, response) => {
    response.status(201).json({ data: database.createSnippet(response.locals.userId, SnippetCreateSchema.parse(request.body)) });
  });
  api.get("/snippets", (request, response) => {
    response.json(
      database.listSnippets(response.locals.userId, {
        ...pageOptions(request),
        query: oneQueryValue(request.query.query),
        language: oneQueryValue(request.query.language),
      }),
    );
  });
  api.patch("/snippets/:id", (request, response) => {
    response.json({ data: database.updateSnippet(response.locals.userId, parseId(request), SnippetPatchSchema.parse(request.body)) });
  });
  api.delete("/snippets/:id", (request, response) => {
    database.deleteNote(response.locals.userId, "snippet", parseId(request));
    response.status(204).end();
  });

  api.post("/editorial", (request, response) => {
    response.status(201).json({ data: database.createEditorial(response.locals.userId, EditorialCreateSchema.parse(request.body)) });
  });
  api.get("/editorial", (request, response) => {
    response.json(database.listEditorial(response.locals.userId, { ...pageOptions(request), query: oneQueryValue(request.query.query) }));
  });
  api.patch("/editorial/:id", (request, response) => {
    response.json({ data: database.updateEditorial(response.locals.userId, parseId(request), EditorialPatchSchema.parse(request.body)) });
  });
  api.delete("/editorial/:id", (request, response) => {
    database.deleteNote(response.locals.userId, "editorial", parseId(request));
    response.status(204).end();
  });

  api.get("/feed", (request, response) => {
    const rawTypes = oneQueryValue(request.query.types);
    let types: NoteType[] | undefined;
    if (rawTypes) {
      const values = rawTypes.split(",").filter(Boolean);
      types = z.array(NoteTypeSchema).min(1).parse(values);
    }
    response.json(database.listFeed(response.locals.userId, { ...datePageOptions(request), ...(types ? { types } : {}) }));
  });

  api.use((_request, _response, next) => next(new AppError(404, "route_not_found", "The requested endpoint does not exist")));
  app.use("/api", api);
  if (options.websiteDirectory) {
    app.use(express.static(options.websiteDirectory, { dotfiles: "deny", index: false }));
    app.get("/", (_request, response) => response.sendFile(join(options.websiteDirectory!, "index.html")));
  }

  app.use((_request, _response, next) => {
    next(new AppError(404, "route_not_found", "The requested endpoint does not exist"));
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
      response.status(413).json({ error: { code: "body_too_large", message: "The entry is too large" } });
      return;
    }
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json({ error: { code: "invalid_json", message: "The request body is not valid JSON" } });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        error: { code: "validation_error", message: "The request is invalid", details: error.issues },
      });
      return;
    }
    if (error instanceof AppError) {
      if (error.status >= 500) console.error(`[${request.method}] ${error.code}`);
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
      return;
    }
    console.error(`[${request.method}] Unexpected server error`, error instanceof Error ? error.name : "Unknown error");
    response.status(500).json({ error: { code: "internal_error", message: "An unexpected error occurred" } });
  });

  database.pruneSessions();
  const cleanup = setInterval(() => {
    try { database.pruneSessions(); } catch (error) { console.error("Session cleanup failed", error instanceof Error ? error.name : "Unknown error"); }
  }, 60 * 60_000);
  cleanup.unref();
  return { app, database, close: () => { clearInterval(cleanup); database.close(); } };
}

export const supportedNoteTypes = NOTE_TYPES;
