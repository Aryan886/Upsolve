import type {
  ApiFailure,
  ApiSuccess,
  Editorial,
  FeedItem,
  Mistake,
  NoteRecord,
  NoteType,
  PageMeta,
  Pattern,
  Problem,
  RootCause,
  Snippet,
} from "@cp-notes/shared";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiSuccess<T>> {
  let response: Response;
  try {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("backend_unavailable", "Could not reach the CP Notes backend. Is it running?", error);
  }

  if (response.status === 204) return { data: undefined as T };
  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!response.ok || "error" in payload) {
    const failure = payload as ApiFailure;
    throw new ApiError(failure.error.code, failure.error.message, failure.error.details);
  }
  return payload;
}

export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}

export async function getPage<T>(path: string, signal?: AbortSignal): Promise<Paged<T>> {
  const response = await request<T[]>(path, signal ? { signal } : {});
  if (!response.meta) throw new ApiError("invalid_response", "The backend omitted pagination metadata");
  return { data: response.data, meta: response.meta };
}

export function getFeed(query: string, signal?: AbortSignal): Promise<Paged<FeedItem>> {
  return getPage(`/feed?${query}`, signal);
}

export function getPatterns(query: string, signal?: AbortSignal): Promise<Paged<Pattern>> {
  return getPage(`/patterns?${query}`, signal);
}

export function getMistakes(query: string, signal?: AbortSignal): Promise<Paged<Mistake>> {
  return getPage(`/mistakes?${query}`, signal);
}

export function getSnippets(query: string, signal?: AbortSignal): Promise<Paged<Snippet>> {
  return getPage(`/snippets?${query}`, signal);
}

export function getEditorial(query: string, signal?: AbortSignal): Promise<Paged<Editorial>> {
  return getPage(`/editorial?${query}`, signal);
}

export async function getProblems(query: string, signal?: AbortSignal): Promise<Problem[]> {
  return (await getPage<Problem>(`/problems?query=${encodeURIComponent(query)}&limit=8`, signal)).data;
}

export async function getMistakeStats(signal?: AbortSignal): Promise<Record<RootCause, number>> {
  return (await request<Record<RootCause, number>>("/mistakes/stats", signal ? { signal } : {})).data;
}

function typePath(type: NoteType): string {
  return type === "editorial" ? "editorial" : `${type}s`;
}

export async function patchNote(type: NoteType, id: number, body: unknown): Promise<NoteRecord> {
  return (
    await request<NoteRecord>(`/${typePath(type)}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  ).data;
}

export async function deleteNote(type: NoteType, id: number): Promise<void> {
  await request<void>(`/${typePath(type)}/${id}`, { method: "DELETE" });
}
