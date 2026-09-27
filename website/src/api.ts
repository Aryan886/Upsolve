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
  User,
} from "@cp-notes/shared";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

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

const pendingRequests = new Set<AbortController>();
let accountGeneration = 0;

export function clearSessionData(): void {
  accountGeneration += 1;
  for (const controller of pendingRequests) controller.abort();
  pendingRequests.clear();
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<ApiSuccess<T>> {
  const generation = accountGeneration;
  const controller = new AbortController();
  pendingRequests.add(controller);
  const timeout = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 15_000);
  const signals = options.signal ? [controller.signal, options.signal] : [controller.signal];
  const signal = AbortSignal.any(signals);
  try {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, credentials: "same-origin", headers, signal });
    } catch {
      if (signal.aborted && signal.reason?.name !== "TimeoutError") throw new DOMException("Request cancelled", "AbortError");
      throw new ApiError("service_unavailable", "CP Notes could not be reached. Your changes are still here. Check the diary before retrying a save.");
    }
    if (generation !== accountGeneration || signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (response.status === 401 && path !== "/auth/login") {
      clearSessionData();
      window.dispatchEvent(new Event("cp-notes-session-expired"));
      throw new ApiError("session_expired", "Your session ended. Sign in again.");
    }
    if (response.status === 204) return { data: undefined as T };
    let payload: ApiSuccess<T> | ApiFailure;
    try { payload = await response.json() as ApiSuccess<T> | ApiFailure; }
    catch { throw new ApiError("invalid_response", "CP Notes is temporarily unavailable. Check the diary before retrying a save."); }
    if (generation !== accountGeneration || signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (!payload || typeof payload !== "object") throw new ApiError("invalid_response", "CP Notes returned an unreadable response.");
    if ("error" in payload && payload.error && typeof payload.error.message === "string") {
      throw new ApiError(payload.error.code, payload.error.message, payload.error.details);
    }
    if (!response.ok || !("data" in payload)) throw new ApiError("service_unavailable", "CP Notes is temporarily unavailable. Try again shortly.");
    return payload;
  } finally {
    window.clearTimeout(timeout);
    pendingRequests.delete(controller);
  }
}

export async function getCurrentUser(): Promise<User> {
  return (await request<User>("/auth/me")).data;
}

export async function login(email: string, password: string): Promise<User> {
  return (await request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })).data;
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
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
