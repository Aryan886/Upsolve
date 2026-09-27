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

function allowedOrigins(websiteOrigins: string[]): CorsOptions["origin"] {
  return (origin, callback) => {
    const allowed =
      origin === undefined || websiteOrigins.includes(origin) || origin.startsWith("chrome-extension://");
    callback(allowed ? null : new AppError(403, "origin_not_allowed", "This origin cannot access CP Notes"), allowed);
  };
}

export function createApp(options: CreateAppOptions): { app: express.Express; close: () => void } {
  const database = new NotesDatabase(options.databasePath);
  const app = express();
  const origins = options.websiteOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

  app.disable("x-powered-by");
  app.use(cors({ origin: allowedOrigins(origins) }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({ data: { status: "ok" } });
  });

  app.post("/problems", (request, response) => {
    const problem = database.upsertProblem(ProblemInputSchema.parse(request.body));
    response.status(201).json({ data: problem });
  });

  app.get("/problems", (request, response) => {
    const result = database.listProblems({ ...pageOptions(request), query: oneQueryValue(request.query.query) });
    response.json(result);
  });

  app.post("/patterns", (request, response) => {
    response.status(201).json({ data: database.createPattern(PatternCreateSchema.parse(request.body)) });
  });
  app.get("/patterns", (request, response) => {
    response.json(database.listPatterns({ ...pageOptions(request), query: oneQueryValue(request.query.query) }));
  });
  app.patch("/patterns/:id", (request, response) => {
    response.json({ data: database.updatePattern(parseId(request), PatternPatchSchema.parse(request.body)) });
  });
  app.delete("/patterns/:id", (request, response) => {
    database.deleteNote("pattern", parseId(request));
    response.status(204).end();
  });

  app.post("/mistakes", (request, response) => {
    response.status(201).json({ data: database.createMistake(MistakeCreateSchema.parse(request.body)) });
  });
  app.get("/mistakes", (request, response) => {
    const rootCauseValue = oneQueryValue(request.query.rootCause) ?? oneQueryValue(request.query.root_cause);
    const rootCause = rootCauseValue ? RootCauseSchema.parse(rootCauseValue) : undefined;
    response.json(database.listMistakes({ ...datePageOptions(request), ...(rootCause ? { rootCause } : {}) }));
  });
  app.get("/mistakes/stats", (_request, response) => {
    response.json({ data: database.mistakeStats() });
  });
  app.patch("/mistakes/:id", (request, response) => {
    response.json({ data: database.updateMistake(parseId(request), MistakePatchSchema.parse(request.body)) });
  });
  app.delete("/mistakes/:id", (request, response) => {
    database.deleteNote("mistake", parseId(request));
    response.status(204).end();
  });

  app.post("/snippets", (request, response) => {
    response.status(201).json({ data: database.createSnippet(SnippetCreateSchema.parse(request.body)) });
  });
  app.get("/snippets", (request, response) => {
    response.json(
      database.listSnippets({
        ...pageOptions(request),
        query: oneQueryValue(request.query.query),
        language: oneQueryValue(request.query.language),
      }),
    );
  });
  app.patch("/snippets/:id", (request, response) => {
    response.json({ data: database.updateSnippet(parseId(request), SnippetPatchSchema.parse(request.body)) });
  });
  app.delete("/snippets/:id", (request, response) => {
    database.deleteNote("snippet", parseId(request));
    response.status(204).end();
  });

  app.post("/editorial", (request, response) => {
    response.status(201).json({ data: database.createEditorial(EditorialCreateSchema.parse(request.body)) });
  });
  app.get("/editorial", (request, response) => {
    response.json(database.listEditorial({ ...pageOptions(request), query: oneQueryValue(request.query.query) }));
  });
  app.patch("/editorial/:id", (request, response) => {
    response.json({ data: database.updateEditorial(parseId(request), EditorialPatchSchema.parse(request.body)) });
  });
  app.delete("/editorial/:id", (request, response) => {
    database.deleteNote("editorial", parseId(request));
    response.status(204).end();
  });

  app.get("/feed", (request, response) => {
    const rawTypes = oneQueryValue(request.query.types);
    let types: NoteType[] | undefined;
    if (rawTypes) {
      const values = rawTypes.split(",").filter(Boolean);
      types = z.array(NoteTypeSchema).min(1).parse(values);
    }
    response.json(database.listFeed({ ...datePageOptions(request), ...(types ? { types } : {}) }));
  });

  app.use((_request, _response, next) => {
    next(new AppError(404, "route_not_found", "The requested endpoint does not exist"));
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
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
      if (error.status >= 500) console.error(`[${request.method} ${request.path}] ${error.code}:`, error);
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
      return;
    }
    console.error(`[${request.method} ${request.path}] Unexpected error:`, error);
    response.status(500).json({ error: { code: "internal_error", message: "An unexpected error occurred" } });
  });

  return { app, close: () => database.close() };
}

export const supportedNoteTypes = NOTE_TYPES;
